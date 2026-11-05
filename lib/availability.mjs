/**
 * Shared Invenio availability check.
 *
 * Used by the local Node server (server.mjs), the Vercel function
 * (api/availability.js) and the Netlify function
 * (netlify/functions/availability.mjs). Keeping the logic here means all three
 * behave identically, and the API key never reaches the browser.
 */

import { MARKUP_PERCENT } from "./pricing.mjs";
import { NIGHT_RATES } from "./night-rates.mjs";

const API_VERSION = "3";

/**
 * Client price for a net amount from the API: net + MARKUP_PERCENT (generated
 * from content/settings.json by build.py). DCC villas are never marked up —
 * the client pays the owner's own price.
 */
export const clientPrice = (net, dcc) => {
  const amount = Number(net) || 0;
  if (!amount || dcc) return Math.round(amount);
  return Math.round(amount * (1 + MARKUP_PERCENT / 100));
};
const yes = (value) => ["1", "yes", "true"].includes(String(value ?? "").trim().toLowerCase());
const isDcc = (villa) => yes(villa?.direct_client_contract);
// Same rule as the site and the Invenio portal: licensed = licence field of 4+ characters.
// The API key also sees unlicensed villas; they must never reach this public endpoint.
const isLicensed = (villa) => String(villa?.license ?? "").trim().length >= 4;

const cache = new Map();
const TTL = 1000 * 60 * 10;

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));

const nightsBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

const DAY = 86400000;
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

/**
 * Gaps between price periods (Edo, 5 Nov 2026): IMpulse answers "on request" (price 0) for a stay that
 * crosses nights with no price. When every such night sits in a gap of 1 or 2 nights between two periods,
 * the night takes the rate of the period before; a gap of 3 nights or more stays on request.
 * Returns the net for the stay, or 0 when it can't be priced this way. Same rule as Oracle and the agent bots.
 */
export function gapFilledNet(uuid, from, to) {
  const rows = NIGHT_RATES[String(uuid || "").toLowerCase()];
  if (!rows || !rows.length) return 0;
  const periods = rows.map(([a, b, night]) => [dayNum(a), dayNum(b), Number(night) || 0]).sort((x, y) => x[0] - y[0]);
  let total = 0, filled = 0;
  for (let d = dayNum(from); d < dayNum(to); d++) {
    const own = periods.find(([a, b]) => a <= d && d <= b);
    if (own) {
      if (!(own[2] > 0)) return 0;
      total += own[2];
      continue;
    }
    const prev = periods.filter(([, b]) => b < d).pop();
    const next = periods.find(([a]) => a > d);
    if (!prev || !next || !(prev[2] > 0) || next[0] - prev[1] - 1 >= 3) return 0;
    total += prev[2];
    filled++;
  }
  return filled ? total : 0;
}

export async function checkAvailability(input, env = process.env) {
  const { uuid, from, to } = input || {};
  const bulk = !uuid;

  if (!bulk && !isUuid(uuid)) {
    return { status: 400, body: { ok: false, error: "Invalid villa reference." } };
  }
  if (!isDate(from) || !isDate(to)) {
    return { status: 400, body: { ok: false, error: "Please choose an arrival and departure date." } };
  }

  const nights = nightsBetween(from, to);
  if (!Number.isFinite(nights) || nights < 1) {
    return { status: 400, body: { ok: false, error: "The departure date needs to be after the arrival date." } };
  }
  if (nights > 60) {
    return { status: 400, body: { ok: false, error: "For stays longer than 60 nights, please write to us directly." } };
  }

  const destination = (env.INVENIO_DESTINATION || "Ibiza").trim() || "Ibiza";
  const key = bulk
    ? `${API_VERSION}:bulk:${destination}:${from}:${to}`
    : `${API_VERSION}:${uuid}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return { status: 200, body: hit.body };
  }

  const apiKey = (env.INVENIO_API_KEY || "").trim();
  const bpUuid = (env.INVENIO_BP_UUID || "").trim();
  const base = (env.INVENIO_BASE_URL || "https://api.inveniohomes.com").replace(/\/$/, "");

  if (!apiKey || !bpUuid) {
    return { status: 503, body: { ok: false, error: "Availability is not configured on this server." } };
  }

  const payload = JSON.stringify(
    bulk
      ? [{ from_date: from, to_date: to, destination_name: destination }]
      : [{ from_date: from, to_date: to, v_uuid: uuid }]
  );
  const body = new URLSearchParams({ param: payload });

  let response;
  try {
    response = await fetch(`${base}/plapi/getdata/api_villa_availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "api-key": apiKey,
        bp_uuid: bpUuid,
        Accept: "application/json",
        "User-Agent": "theibizaconnection-site/1.0",
      },
      body,
      // The bulk answer covers every villa the key can see (~27 MB, ~20 s with the
      // full-access key); a single-villa quote is small and fast.
      signal: AbortSignal.timeout(bulk ? 45000 : 25000),
    });
  } catch (error) {
    return {
      status: 502,
      body: { ok: false, error: "We could not reach the booking system. Please send us your dates." },
    };
  }

  if (!response.ok) {
    return {
      status: 502,
      body: { ok: false, error: "The booking system did not answer. Please send us your dates." },
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { status: 502, body: { ok: false, error: "Unexpected answer from the booking system." } };
  }

  const villas = Array.isArray(data?.villas) ? data.villas : [];

  if (bulk) {
    const list = villas
      .filter((villa) => String(villa?.destination || "").toLowerCase() === destination.toLowerCase())
      .filter(isLicensed)
      .map((villa) => {
        const net = (Number(villa.price) || 0) || gapFilledNet(villa.v_uuid, from, to);
        return {
        uuid: String(villa.v_uuid || ""),
        price: clientPrice(net, isDcc(villa)),
        priceOnRequest: net === 0,
        minNights: Number(villa.minimum_nights) || 0,
        cleaning: Number(villa.cleaning_charge) || 0,
        };
      })
      .filter((villa) => villa.uuid);
    const result = {
      ok: true,
      available: true,
      bulk: true,
      destination,
      nights,
      count: list.length,
      currency: "EUR",
      villas: list,
    };
    cache.set(key, { at: Date.now(), body: result });
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    return { status: 200, body: result };
  }

  const match = villas.find(
    (villa) => String(villa?.v_uuid || "").toLowerCase() === uuid.toLowerCase() && isLicensed(villa)
  );

  let result;
  if (!match) {
    result = {
      ok: true,
      available: false,
      nights,
      message:
        "Those dates do not work with the current calendar — often one night either side will. Send us your dates and we will check by hand.",
    };
  } else {
    const price = clientPrice((Number(match.price) || 0) || gapFilledNet(match.v_uuid, from, to), isDcc(match));
    result = {
      ok: true,
      available: true,
      nights,
      cleanings: Number(match.cleaning_charge) || 0,
      minNights: Number(match.minimum_nights) || 0,
      currency: "EUR",
      price,
      priceOnRequest: price === 0,
      message:
        price === 0
          ? "Those dates look possible, but the price is on request. Write to us and we will send a quote."
          : "",
    };
  }

  const bodyOut = result;
  cache.set(key, { at: Date.now(), body: bodyOut });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return { status: 200, body: bodyOut };
}
