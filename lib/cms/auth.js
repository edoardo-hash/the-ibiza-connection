// Control-panel login: email + password (scrypt hashes in ADMIN_USERS), signed HttpOnly session cookie.
import { scryptSync, timingSafeEqual, createHmac, randomBytes } from "node:crypto";

const COOKIE = "tic_admin";
const TTL_S = 12 * 60 * 60;

function users() {
  try {
    return JSON.parse(process.env.ADMIN_USERS || "{}");
  } catch {
    return {};
  }
}
const secret = () => {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET is not configured");
  return s;
};
const b64u = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function checkPassword(email, password) {
  const entry = users()[String(email || "").trim().toLowerCase()];
  if (!entry || typeof password !== "string") {
    scryptSync("x", "timing-equaliser", 32);
    return false;
  }
  const [, saltB64, hashB64] = entry.split("$");
  const expected = Buffer.from(hashB64, "base64");
  const got = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, got);
}

export const DISPLAY = {
  "natalia@inveniohomes.com": "Natalia",
  "edoardo@inveniohomes.com": "Edo",
};

export function sessionCookie(email) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const payload = `${b64u(email)}.${exp}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_S}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function currentUser(req) {
  const raw = String(req.headers.cookie || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [emailB64, exp, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!emailB64 || !exp || !mac) return null;
  let expected;
  try {
    expected = sign(`${emailB64}.${exp}`);
  } catch {
    return null;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const email = Buffer.from(emailB64, "base64url").toString();
  if (!users()[email]) return null; // removed users lose access immediately
  return { email, name: DISPLAY[email] || email.split("@")[0] };
}

// Naive per-instance throttle for login attempts.
const attempts = new Map();
export function throttled(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  attempts.set(key, list);
  return list.length > 8;
}
