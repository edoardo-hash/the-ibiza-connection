// Control panel API: /api/admin/?action=login|logout|me|status|chat|publish|discard
import { checkPassword, sessionCookie, clearCookie, currentUser, throttled, DISPLAY } from "../../lib/cms/auth.js";
import { status, publish, discard, undoDraftLast, undoPublished, DRAFT } from "../../lib/cms/github.js";
import { chat } from "../../lib/cms/editor.js";

const PREVIEW_URL = process.env.CMS_PREVIEW_URL || `https://theibizaconnection-git-${DRAFT}-edos-projects-ab12d8b9.vercel.app`;

const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const action = String(req.query.action || "");
  const body = typeof req.body === "object" && req.body ? req.body : {};

  if (req.method === "POST" && !sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    if (action === "login" && req.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0];
      if (throttled(ip) || throttled(email)) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
      if (!checkPassword(email, body.password)) return res.status(401).json({ error: "Wrong email or password." });
      res.setHeader("Set-Cookie", sessionCookie(email));
      return res.status(200).json({ user: { email, name: DISPLAY[email] || email } });
    }
    if (action === "logout") {
      res.setHeader("Set-Cookie", clearCookie());
      return res.status(200).json({ ok: true });
    }

    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Please log in." });

    if (action === "me") return res.status(200).json({ user, previewUrl: PREVIEW_URL });
    if (action === "status") return res.status(200).json({ ...(await status()), previewUrl: PREVIEW_URL });

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (action === "chat") {
      const history = Array.isArray(body.messages) ? body.messages : [];
      const images = Array.isArray(body.images) ? body.images : [];
      const result = await chat(user, history, images);
      return res.status(200).json(result);
    }
    if (action === "publish") return res.status(200).json(await publish(user.name));
    if (action === "discard") return res.status(200).json(await discard());
    if (action === "undo-draft") return res.status(200).json(await undoDraftLast());
    if (action === "undo") return res.status(200).json(await undoPublished(String(body.sha || ""), user));

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error(`admin ${action} failed:`, err.message);
    if (/photo/.test(err.message)) return res.status(400).json({ error: err.message });
    const config = /not configured/.test(err.message);
    return res.status(config ? 503 : 500).json({
      error: config ? `The control panel is not fully set up yet (${err.message}).` : "Something went wrong. Please try again in a minute.",
      detail: err.message,
    });
  }
}
