// Control panel: "Sign in with Google" (OAuth 2.0 authorization code flow, server side).
// GET /api/admin/google/           -> redirect to Google
// GET /api/admin/google/?code=...  -> Google redirects back here; check the account, set the session cookie
// Only addresses on the allowlist (ADMIN_GOOGLE_EMAILS or ADMIN_USERS) get in.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAllowed, sessionCookie } from "../../lib/cms/auth.js";

const STATE_COOKIE = "tic_oauth";
const ORIGIN = (process.env.ADMIN_ORIGIN || "https://theibizaconnection.net").replace(/\/$/, "");
const REDIRECT_URI = `${ORIGIN}/api/admin/google/`;

const cookieOf = (req, name) =>
  String(req.headers.cookie || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1) || "";

const stateCookie = (value, maxAge) =>
  `${STATE_COOKIE}=${value}; Path=/api/admin/google/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function back(res, error, cookies = []) {
  const to = error ? `/admin/?login_error=${encodeURIComponent(error)}` : "/admin/";
  res.setHeader("Set-Cookie", [stateCookie("", 0), ...cookies]);
  res.setHeader("Location", to);
  return res.status(302).end();
}

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "GET") return res.status(405).end();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back(res, "Google sign-in is not set up yet. Use your password.");

  const { code, state, error } = req.query;

  // Step 1: send the browser to Google.
  if (!code && !error) {
    const st = randomBytes(24).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email",
      state: st,
      nonce,
      prompt: "select_account",
    }).toString();
    res.setHeader("Set-Cookie", stateCookie(`${st}.${nonce}`, 600));
    res.setHeader("Location", url.toString());
    return res.status(302).end();
  }

  // Step 2: Google sent the browser back.
  if (error) return back(res, "Google sign-in was cancelled.");
  const [expectedState, nonce] = cookieOf(req, STATE_COOKIE).split(".");
  if (!same(state, expectedState)) return back(res, "Sign-in expired. Please try again.");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || "no id_token");

    // The ID token comes straight from Google's token endpoint over TLS, so its claims can be read directly
    // (OpenID Connect Core 3.1.3.7). We still check audience, issuer, expiry, nonce and verified email.
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
    const email = String(claims.email || "").toLowerCase();
    if (claims.aud !== clientId) throw new Error("wrong audience");
    if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) throw new Error("wrong issuer");
    if (Number(claims.exp) < Date.now() / 1000) throw new Error("token expired");
    if (!same(claims.nonce, nonce)) throw new Error("nonce mismatch");
    if (claims.email_verified !== true) return back(res, "This Google account's email is not verified.");
    if (!isAllowed(email)) return back(res, `${email} does not have access to the control panel.`);

    return back(res, null, [sessionCookie(email)]);
  } catch (err) {
    console.error("admin google sign-in failed:", err.message);
    return back(res, "Google sign-in failed. Please try again.");
  }
}
