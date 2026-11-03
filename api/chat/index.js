import { chat, chatEnabled } from "../../lib/chat.mjs";

/** Vercel Node function: the AI concierge. Needs ANTHROPIC_API_KEY (and optionally CHAT_MODEL). */
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") {
    response.status(200).json({ enabled: chatEnabled() });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Use POST." });
    return;
  }
  let input = request.body || {};
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  const ip = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const result = await chat(input, { ip });
  response.status(result.status).json(result.body);
}
