import { checkAvailability } from "../../lib/availability.mjs";

/**
 * Netlify function, exposed at /api/availability by the redirect in netlify.toml.
 * Set INVENIO_API_KEY and INVENIO_BP_UUID in Site settings → Environment.
 */
export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  let input = {};
  try {
    input = await request.json();
  } catch {
    input = {};
  }

  const result = await checkAvailability(input);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
