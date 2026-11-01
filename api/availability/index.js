import { checkAvailability } from "../../lib/availability.mjs";

/**
 * Vercel Node function: POST /api/availability
 * Set INVENIO_API_KEY and INVENIO_BP_UUID in the project's environment.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Use POST." });
    return;
  }

  const input =
    typeof request.body === "string"
      ? (() => {
          try {
            return JSON.parse(request.body);
          } catch {
            return {};
          }
        })()
      : request.body || {};

  const result = await checkAvailability(input);
  response.status(result.status).setHeader("Cache-Control", "no-store").json(result.body);
}
