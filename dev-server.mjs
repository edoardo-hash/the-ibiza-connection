import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { checkAvailability } from "./lib/availability.mjs";
import { chat, chatEnabled } from "./lib/chat.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const START_PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
let port = START_PORT;

// Minimal .env loader — no dependency, no surprise precedence.
async function loadEnv() {
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* .env is optional in production */
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const RATE = new Map();
const RATE_WINDOW = 60_000;
const RATE_LIMIT = 40;

function rateLimited(ip) {
  const now = Date.now();
  const hit = RATE.get(ip);
  if (!hit || now - hit.start > RATE_WINDOW) {
    RATE.set(ip, { start: now, count: 1 });
    return false;
  }
  hit.count += 1;
  return hit.count > RATE_LIMIT;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  const candidates = [];
  if (pathname.endsWith("/")) candidates.push(path.join(DIST, pathname, "index.html"));
  else {
    candidates.push(path.join(DIST, pathname));
    if (!path.posix.extname(pathname)) candidates.push(path.join(DIST, pathname, "index.html"));
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(DIST + path.sep) && resolved !== DIST) continue;
    try {
      const info = await stat(resolved);
      if (!info.isFile()) continue;
      const ext = path.extname(resolved).toLowerCase();
      const headers = {
        "Content-Type": MIME[ext] || "application/octet-stream",
        ...SECURITY_HEADERS,
      };
      const immutable = resolved.includes(`${path.sep}assets${path.sep}`);
      headers["Cache-Control"] = immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate";
      const content = await readFile(resolved);
      if (ext === ".html") {
        headers["Cache-Control"] = "no-cache";
      }
      const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      if (acceptsGzip && [".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".xml"].includes(ext)) {
        headers["Content-Encoding"] = "gzip";
        headers["Vary"] = "Accept-Encoding";
        res.writeHead(200, headers);
        const gzip = createGzip({ level: 6 });
        gzip.pipe(res);
        gzip.end(content);
      } else {
        headers["Content-Length"] = content.length;
        res.writeHead(200, headers);
        res.end(content);
      }
      return;
    } catch {
      /* try next candidate */
    }
  }

  const notFound = path.join(DIST, "404.html");
  try {
    const content = await readFile(notFound);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      apiConfigured: Boolean(process.env.INVENIO_API_KEY && process.env.INVENIO_BP_UUID),
    });
    return;
  }

  if (url.pathname === "/api/chat" || url.pathname === "/api/chat/") {
    if (req.method === "GET") {
      sendJson(res, 200, { enabled: chatEnabled() });
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) req.destroy();
    });
    req.on("end", async () => {
      let input = {};
      try { input = JSON.parse(raw || "{}"); } catch { /* empty */ }
      const result = await chat(input, { ip: req.socket.remoteAddress || "" });
      sendJson(res, result.status, result.body);
    });
    return;
  }

  if (url.pathname === "/api/availability" || url.pathname === "/api/availability/") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { Allow: "POST, OPTIONS", ...SECURITY_HEADERS }).end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Use POST." });
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) req.destroy();
    });
    req.on("end", async () => {
      let input;
      try {
        input = JSON.parse(raw || "{}");
      } catch {
        sendJson(res, 400, { ok: false, error: "Invalid JSON." });
        return;
      }
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited(ip)) {
        sendJson(res, 429, { ok: false, error: "Too many requests — please try again shortly." });
        return;
      }
      const result = await checkAvailability(input);
      sendJson(res, result.status, result.body);
    });
    req.on("error", () => sendJson(res, 400, { ok: false, error: "Request error." }));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", ...SECURITY_HEADERS }).end();
    return;
  }

  await serveStatic(req, res, url);
});

await loadEnv();

if (!process.env.INVENIO_API_KEY) {
  console.warn("! INVENIO_API_KEY is not set — live availability will answer 503.");
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && port < START_PORT + 20) {
    port += 1;
    console.warn(`! Port ${port - 1} is busy — trying ${port}.`);
    server.listen(port, HOST);
    return;
  }
  throw error;
});

server.listen(port, HOST, () => {
  console.log(`\n  The Ibiza Connection`);
  console.log(`  http://${HOST}:${port}\n`);
  console.log(`  Availability API: ${process.env.INVENIO_API_KEY ? "configured" : "not configured"}`);
});
