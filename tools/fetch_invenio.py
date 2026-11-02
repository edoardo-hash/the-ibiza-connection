#!/usr/bin/env python3
"""
Fetch the villa collection from the Invenio Homes Data Export API.

    python3 tools/fetch_invenio.py                 # data + photography
    python3 tools/fetch_invenio.py --no-images     # data only
    python3 tools/fetch_invenio.py --images 8      # photos per villa

Writes:
    data/villas.json   public, normalised villa records: every published, licensed villa
                       in the destination, whether or not its "API" switch is on, DCC or not
    data/prices.json   seasonal nightly rates, keyed by villa
    data/meta.json     fetch timestamp, counts, API host
    assets/villas/<slug>/*.webp   local, responsive photography

Credentials are read from .env (see .env.example) or the environment. They are
never written into the generated site.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = ROOT / "assets" / "villas"

# --------------------------------------------------------------------------- #
#  Small helpers
# --------------------------------------------------------------------------- #


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = value.replace("’", "'").replace("´", "'").replace("`", "'")
    value = value.replace("&", " and ")
    value = re.sub(r"['\"]", "", value)
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return re.sub(r"-{2,}", "-", value)


def as_int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def clean_text(value) -> str:
    if not value:
        return ""
    text = str(value)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_description(value) -> str:
    """Remove licence/registration boilerplate that the API appends to copy."""
    text = clean_text(value)
    kept = []
    for line in text.split("\n"):
        low = line.lower()
        if any(
            token in low
            for token in (
                "license number",
                "licence number",
                "tourist licence",
                "tourist license",
                "c.r.u",
                "esfctu",
            )
        ):
            continue
        kept.append(line)
    text = "\n".join(kept)
    # Some owners write markdown (**bold**); the site shows plain text.
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.S).replace("**", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_tag(value: str) -> str:
    tag = re.sub(r"\s+", " ", str(value or "")).strip(" ,.;")
    return tag[:1].upper() + tag[1:] if tag else ""


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def api_headers() -> dict:
    key = os.environ.get("INVENIO_API_KEY", "").strip()
    bp = os.environ.get("INVENIO_BP_UUID", "").strip()
    if not key or not bp:
        sys.exit(
            "Missing API credentials. Copy .env.example to .env and set\n"
            "INVENIO_API_KEY and INVENIO_BP_UUID."
        )
    return {
        "Content-Type": "application/json",
        "api-key": key,
        "bp_uuid": bp,
        "Accept": "application/json",
        "User-Agent": "theibizaconnection-site/1.0",
    }


def api_post(path: str, payload, retries: int = 4):
    base = os.environ.get("INVENIO_BASE_URL", "https://api.inveniohomes.com").rstrip("/")
    url = f"{base}{path}"
    body = json.dumps(payload).encode("utf-8")
    last_error = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, data=body, headers=api_headers(), method="POST")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
            return json.loads(raw.decode("utf-8")), len(raw)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            wait = min(2 ** attempt, 20)
            print(f"  ! {path} attempt {attempt} failed ({exc}); retrying in {wait}s")
            time.sleep(wait)
    raise SystemExit(f"Could not reach {url}: {last_error}")


def api_form(endpoint: str, param: list, timeout: int = 600):
    """POST in the form the full-list endpoints expect: body param=<JSON array>.
    Returns (rows, payload_size). Rows are [] when the key has no access to the endpoint."""
    base = os.environ.get("INVENIO_BASE_URL", "https://api.inveniohomes.com").rstrip("/")
    headers = {k: v for k, v in api_headers().items() if k != "Content-Type"}
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    body = urllib.parse.urlencode({"param": json.dumps(param)}).encode("utf-8")
    request = urllib.request.Request(f"{base}/plapi/getdata/{endpoint}", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    data = json.loads(raw.decode("utf-8"))
    rows = []
    if isinstance(data, list) and data and isinstance(data[0], dict) and "result" in data[0]:
        rows = data[0].get("result") or []
    elif isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = next((v for v in data.values() if isinstance(v, list)), [])
    return [r for r in rows if isinstance(r, dict)], len(raw)


def is_licensed(value) -> bool:
    """Same rule as the Invenio portal: a licence is a licence field of 4+ characters."""
    return len(str(value or "").strip()) >= 4


def yes(value) -> bool:
    """The long-rental list says "Yes"/"No" (or 1/0); the other endpoints say "1"/"0"."""
    return str(value if value is not None else "").strip().lower() in ("1", "yes", "true")


# --------------------------------------------------------------------------- #
#  Content curation
# --------------------------------------------------------------------------- #

# Internal / audience tags that are not amenities.
AUDIENCE_TAGS = {
    "couples", "families", "friends", "retreats", "weddings", "events",
    "filming", "honeymoon", "neighbours", "private",
}

FEATURE_GROUPS = [
    ("Outside", [
        "Swimming Pool", "Infinity pool", "Heated Pool (additional charges may apply)",
        "Outdoor Jacuzzi", "Outdoor Kitchen", "Outdoor Bar", "Al Fresco Dining", "BBQ",
        "Terraces", "Roof Terrace", "Garden", "Lawn Area", "Outdoor Play Area",
        "Outdoor Music System", "Sunloungers", "Sea Access", "Private Parking",
    ]),
    ("Inside", [
        "Wifi", "Air Conditioning", "Air Con - Bedrooms Only", "Central Heating",
        "Underfloor Heating", "Fully fitted kitchen", "Fireplace", "Smart TV",
        "TV - Satellite", "Music System", "Office Space", "Gym/Fitness Equipment",
        "Cinema Room", "Games Room", "Spa", "Sauna", "Jacuzzi", "Washing machine",
        "Dishwasher", "Safe", "Safety Box",
    ]),
    ("Setting", [
        "Sea View", "Sunset View", "Country View", "Town View", "Mountain View",
        "Beachfront", "Beach Access", "Gated", "Fenced", "Alarm", "CCTV",
        "House Manager", "Concierge", "Staff Included", "Hire Car Recommended",
    ]),
]

ICON_BY_FEATURE = {
    "Swimming Pool": "pool",
    "Infinity pool": "pool",
    "Heated Pool (additional charges may apply)": "pool",
    "Outdoor Jacuzzi": "waves",
    "Sea View": "waves",
    "Sunset View": "sun",
    "Wifi": "wifi",
    "Air Conditioning": "wind",
    "Air Con - Bedrooms Only": "wind",
    "Gym/Fitness Equipment": "dumbbell",
    "Fully fitted kitchen": "utensils",
    "BBQ": "flame",
    "Al Fresco Dining": "utensils",
    "Private Parking": "car",
    "Hire Car Recommended": "car",
    "Garden": "leaf",
    "Lawn Area": "leaf",
    "Terraces": "sun",
    "Roof Terrace": "sun",
    "Safety Box": "lock",
    "Alarm": "shield",
    "CCTV": "shield",
    "House Manager": "concierge",
    "Music System": "music",
    "Smart TV": "tv",
    "TV - Satellite": "tv",
    "Fireplace": "flame",
    "Gated": "shield",
    "Fenced": "shield",
}

REGIONS = {
    "San Jose de Sa Talaia": {
        "slug": "south-west",
        "name": "South West",
        "short": "Es Cubells, Cala Jondal & the sunset coast",
    },
    "Ibiza": {
        "slug": "ibiza-town",
        "name": "Ibiza Town & Centre",
        "short": "The old town, Talamanca & Cap Martinet",
    },
    "Santa Eulalia del Rio": {
        "slug": "east",
        "name": "East",
        "short": "Santa Eulalia, Cala Llonga & Es Canar",
    },
    "San Antonio de Portmany": {
        "slug": "west",
        "name": "West",
        "short": "San Antonio, Cala Bassa & Cala Conta",
    },
    "San Juan de Labritja": {
        "slug": "north",
        "name": "North",
        "short": "San Juan, Portinatx & the bohemian coast",
    },
}

# Nice-to-have: areas we want to spell consistently on the site.
AREA_LABELS = {
    "S'argamassa": "S'Argamassa",
    "Playa d´en Bossa": "Playa d'en Bossa",
    "Puig den Valls": "Puig d'en Valls",
    "San Jordi": "Sant Jordi",
    "San Jose": "Sant Josep",
    "San Agustin": "Sant Agustí",
    "San Antonio": "Sant Antoni",
    "San Matteo": "Sant Mateu",
    "San Rafael": "Sant Rafel",
    "San Lorenzo": "Sant Llorenç",
    "San Juan": "Sant Joan",
    "Santa Eulalia": "Santa Eulària",
    "Jesus": "Jesús",
    "Es Canar": "Es Canar",
}


def group_features(features: list[str]) -> tuple[list[str], list[dict], list[str]]:
    """Return (amenities, grouped amenities, audience tags)."""
    seen, amenities, audience = set(), [], []
    for raw in features:
        tag = clean_tag(raw)
        if not tag:
            continue
        key = tag.lower().rstrip()
        if key in seen:
            continue
        seen.add(key)
        if key in AUDIENCE_TAGS:
            audience.append(tag)
        else:
            amenities.append(tag)

    known = {f.lower() for _, group in FEATURE_GROUPS for f in group}
    groups = []
    for title, wanted in FEATURE_GROUPS:
        items = [a for a in amenities if a.lower() in {w.lower() for w in wanted}]
        if items:
            groups.append({"title": title, "items": items})
    rest = [a for a in amenities if a.lower() not in known]
    if rest:
        groups.append({"title": "Also included", "items": rest})
    return amenities, groups, audience


def parse_gps(value: str) -> tuple[float | None, float | None]:
    if not value:
        return None, None
    parts = re.split(r"[,;]", str(value))
    if len(parts) < 2:
        return None, None
    try:
        lat, lng = float(parts[0].strip()), float(parts[1].strip())
    except ValueError:
        return None, None
    # Ibiza sits roughly 38.5–39.2 N, 1.1–1.7 E. Anything else is bad data.
    if not (38.4 <= lat <= 39.3 and 1.0 <= lng <= 1.8):
        return None, None
    return round(lat, 5), round(lng, 5)


# --------------------------------------------------------------------------- #
#  Photography
# --------------------------------------------------------------------------- #


def fetch_bytes(url: str, retries: int = 3) -> bytes | None:
    safe = urllib.parse.quote(url, safe=":/,?=&%+~#")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(safe, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 - network is best effort
            if attempt == retries:
                print(f"    x {url[-60:]} ({exc})")
                return None
            time.sleep(attempt)
    return None


def average_colour(image) -> str:
    small = image.convert("RGB").resize((1, 1))
    r, g, b = small.getpixel((0, 0))
    return f"#{r:02x}{g:02x}{b:02x}"


def save_photo(raw: bytes, slug: str, index: int) -> dict | None:
    try:
        from PIL import Image, ImageOps
    except ImportError:
        sys.exit("Pillow is required for photography: python3 -m pip install pillow")

    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception:
        return None
    if min(image.size) < 480:
        return None

    folder = IMAGES / slug
    folder.mkdir(parents=True, exist_ok=True)
    colour = average_colour(image)
    outputs = {}
    for suffix, width, quality in (("1400", 1400, 80), ("800", 800, 78), ("400", 400, 72)):
        copy = image.copy()
        if copy.width > width:
            height = round(copy.height * width / copy.width)
            copy = copy.resize((width, height), Image.LANCZOS)
        path = folder / f"{index:02d}-{width}.webp"
        copy.save(path, "WEBP", quality=quality, method=5)
        outputs[suffix] = path
    width = min(image.width, 1400)
    height = round(image.height * width / image.width)
    return {
        "base": f"villas/{slug}/{index:02d}",
        "width": width,
        "height": height,
        "colour": colour,
    }


def download_photos(villas: list[dict], per_villa: int) -> None:
    jobs = []
    for villa in villas:
        # Spread the selection through the gallery: cover, middle, end.
        photos = villa["photos"]
        picked = photos[:per_villa]
        villa["photo_meta"] = []
        for index, url in enumerate(picked, start=1):
            jobs.append((villa, index, url))

    print(f"  downloading {len(jobs)} photographs ({per_villa}/villa, 3 sizes each)")
    done = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {}
        for villa, index, url in jobs:
            target = IMAGES / villa["slug"] / f"{index:02d}-1400.webp"
            if target.exists() and target.stat().st_size > 5000:
                # Already downloaded: rebuild the metadata from the file itself.
                try:
                    from PIL import Image

                    with Image.open(target) as existing:
                        width, height = existing.size
                        colour = average_colour(existing)
                    villa["photo_meta"].append(
                        {"base": f"villas/{villa['slug']}/{index:02d}", "width": width, "height": height, "colour": colour}
                    )
                except Exception:
                    pass
                done += 1
                continue
            futures[pool.submit(lambda u=url, v=villa, i=index: (v, i, fetch_bytes(u)))] = (villa, index)

        for future in as_completed(futures):
            villa, index = futures[future]
            try:
                _, _, raw = future.result()
            except Exception:
                continue
            if not raw:
                continue
            meta = save_photo(raw, villa["slug"], index)
            if meta:
                villa["photo_meta"].append(meta)
            done += 1
            if done % 25 == 0:
                print(f"    {done}/{len(jobs)} photographs")


# --------------------------------------------------------------------------- #
#  Price normalisation
# --------------------------------------------------------------------------- #


def build_prices(raw: dict, villa_map: dict) -> dict:
    rows_by_uuid = {}
    for entry in raw.get("price_data", []):
        if not isinstance(entry, dict):
            continue
        for uuid, rows in entry.items():
            if uuid in ("price_last_updated_by", "price_last_updated_on"):
                continue
            uuid = str(uuid).strip().lower()
            if uuid not in villa_map:
                continue
            clean = []
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                amount = row.get("amount")
                try:
                    amount = int(round(float(amount)))
                except (TypeError, ValueError):
                    continue
                if amount <= 0:
                    continue
                clean.append({
                    "from": row.get("start_date"),
                    "to": row.get("end_date"),
                    "night": amount,
                    "min_nights": as_int(row.get("minimum_nights"), 0),
                    "checkin": (row.get("allowed_checkin_days") or "").strip(),
                    "currency": row.get("currency_code") or "EUR",
                    "unit": (row.get("unit") or "Night").strip(),
                })
            clean.sort(key=lambda r: (r["from"] or "", r["to"] or ""))
            if clean:
                rows_by_uuid[uuid] = clean
    return rows_by_uuid


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Invenio villas and photography")
    parser.add_argument("--no-images", action="store_true", help="skip photography")
    parser.add_argument("--images", type=int, default=6, help="photos per villa (default 6)")
    parser.add_argument("--only", default="", help="comma separated villa names (debug)")
    parser.add_argument("--lr-file", default="", help="reuse a saved api_villa_list_lr response instead of pulling it "
                        "again (IMpulse asks for at most 1-2 full pulls a day)")
    args = parser.parse_args()

    load_env()
    destination = os.environ.get("INVENIO_DESTINATION", "Ibiza").strip() or "Ibiza"
    DATA.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)

    print(f"→ villa list  ({os.environ.get('INVENIO_BASE_URL', 'https://api.inveniohomes.com')})")
    raw, size = api_post("/plapi/getdata/api_villa_list", {})
    all_villas = raw.get("villas") if isinstance(raw, dict) else raw
    if not all_villas:
        sys.exit("The API returned no villas.")
    print(f"  {len(all_villas)} villas / {size / 1024:.0f} kB")

    in_destination = lambda v: str(v.get("destination", "")).strip().lower() == destination.lower()
    candidates = [v for v in all_villas if in_destination(v) and is_licensed(v.get("license"))]

    # Which villas are published. api_villa_list has no published flag; the long-rental
    # list (api_villa_list_lr) has it for every villa, whatever the back-office "API"
    # switch says. Villa data itself still comes from api_villa_list above: it carries
    # only public fields (public alias, approximate GPS, licensed room counts), whereas
    # the long-rental list also holds real names, exact GPS and owner contacts.
    # IMpulse asks for at most 1-2 full pulls of the long-rental list per day.
    print("→ published status (api_villa_list_lr)")
    try:
        if args.lr_file:
            raw_lr = Path(args.lr_file).read_bytes()
            data_lr = json.loads(raw_lr)
            lr_rows = (data_lr[0].get("result") if isinstance(data_lr, list) and data_lr else data_lr) or []
            lr_size = len(raw_lr)
        else:
            lr_rows, lr_size = api_form("api_villa_list_lr", [{"long_rental_check_skip": "1"}])
    except Exception as exc:  # noqa: BLE001
        lr_rows, lr_size = [], 0
        print(f"  ! could not read api_villa_list_lr ({exc})")
    status = {
        str(r.get("bp_uuid") or "").strip().lower(): (yes(r.get("published_status")), yes(r.get("api_information")))
        for r in lr_rows
        if isinstance(r, dict)
    }
    if status:
        selected = [v for v in candidates if status.get(str(v.get("v_uuid") or "").lower(), (False, False))[0]]
        for v in selected:
            v["_api_switch_on"] = status[str(v["v_uuid"]).lower()][1]
        off = sum(1 for v in selected if not v["_api_switch_on"])
        print(f"  {len(lr_rows)} villas / {lr_size / 1024:.0f} kB → {len(selected)} published, licensed {destination} villas "
              f"({off} with the API switch off)")
    else:
        # Without the long-rental list, api_villa_list only returns published villas
        # with the API switch on (true of the old partner key), so use it as it is.
        selected = candidates
        print("  ! api_villa_list_lr returned nothing for this API key: listing only the villas in api_villa_list.\n"
              "    Use a key with access to api_villa_list_lr to include villas with the API switch off.")
    if not selected:
        sys.exit(f"No villas found for destination '{destination}'.")
    if args.only:
        wanted = {x.strip().lower() for x in args.only.split(",") if x.strip()}
        selected = [v for v in selected if str(v.get("villa_name", "")).lower() in wanted]

    print(f"→ prices for {len(selected)} {destination} villas")
    # api_villa_price_full covers every villa (api_villa_price only the API-on ones).
    # Amounts are nightly net rates: Invenio net (owner + 10 %), or the owner's own
    # amount on DCC villas. The site's markup is applied at build time (build.py).
    price_rows, price_size = api_form("api_villa_price_full", [{}])
    price_raw = {"price_data": price_rows}
    print(f"  {price_size / 1024:.0f} kB")

    seen_slugs: dict[str, int] = {}
    villa_uuid_map: dict[str, dict] = {}
    villas = []
    for item in selected:
        name = clean_text(item.get("villa_name")) or "Villa"
        slug = slugify(name)
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 1

        uuid = str(item.get("v_uuid") or "").strip()
        district = clean_text(item.get("district"))
        region = REGIONS.get(district, REGIONS["Ibiza"])
        area = clean_text(item.get("areaname"))
        area_label = AREA_LABELS.get(area, area)
        lat, lng = parse_gps(item.get("gps"))
        features = [clean_tag(f) for f in (item.get("features") or []) if str(f).strip()]
        amenities, amenity_groups, audience = group_features(features)
        photos = [u for u in (item.get("photos") or []) if isinstance(u, str) and u.startswith("http")]
        description = clean_description(item.get("description"))
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", description) if p.strip()]

        price_from = as_int(item.get("minimum_price"), 0)
        price_to = as_int(item.get("maximum_price"), 0)
        record = {
            "slug": slug,
            "name": name,
            "tagline": clean_text(item.get("tagline")),
            "summary": (paragraphs[0][:220].rsplit(" ", 1)[0] + "…") if paragraphs and len(paragraphs[0]) > 220 else (paragraphs[0] if paragraphs else ""),
            "description": paragraphs,
            "area": area_label,
            "area_key": area,
            "region": region["slug"],
            "region_name": region["name"],
            "district": district,
            "country": clean_text(item.get("country")) or "Spain",
            "bedrooms": as_int(item.get("bedrooms")),
            "bathrooms": as_int(item.get("bathrooms")),
            "sleeps": as_int(item.get("sleeps")),
            "price_from": price_from if price_from >= 500 else 0,
            "price_to": price_to if price_to >= 500 else 0,
            "price_on_request": price_from < 500,
            "min_nights": as_int(item.get("minimum_nights"), 7) or 7,
            "short_stays": str(item.get("allow_shortstays") or "0") == "1",
            "cleaning": clean_text(item.get("cleaning")),
            "cleaning_charge": as_int(item.get("cleaning_charge"), 0),
            "check_in": clean_text(item.get("check_in")),
            "check_out": clean_text(item.get("check_out")),
            "check_in_days": clean_text(item.get("allowed_checkin_days")),
            "license": clean_text(item.get("license")),
            # DCC: the client contracts with the owner directly; prices are shown
            # exactly as the owner sets them, with no markup (see build.py).
            "dcc": yes(item.get("direct_client_contract")),
            # Back-office "API" switch. Informational only: every published, licensed
            # villa is listed whatever this says.
            "api_switch_on": bool(item.get("_api_switch_on", True)),
            "amenities": amenities,
            "amenity_groups": amenity_groups,
            "audience": audience,
            "photos": photos,
            "lat": lat,
            "lng": lng,
            "v_id": item.get("v_id"),
            "v_uuid": uuid,
        }
        villa_uuid_map[uuid.lower()] = record
        villas.append(record)

    # Prices → starting rates and seasonal calendar (only for published villas)
    prices = build_prices(price_raw, villa_uuid_map)
    for villa in villas:
        rows = prices.get(villa["v_uuid"].lower(), [])
        nightly = [r["night"] for r in rows if r["night"] > 0]
        if nightly:
            villa["nightly_from"] = min(nightly)
            villa["nightly_to"] = max(nightly)
        else:
            villa["nightly_from"] = 0
            villa["nightly_to"] = 0
        villa["rate_rows"] = len(rows)
        # A villa without weekly min/max: derive them from the nightly rates, as IMpulse
        # does for the API list (minimum_price = lowest nightly rate x 7).
        if not villa["price_from"] and villa["nightly_from"] and villa["nightly_from"] * 7 >= 500:
            villa["price_from"] = villa["nightly_from"] * 7
            villa["price_to"] = max(villa["price_to"], villa["nightly_to"] * 7)
            villa["price_on_request"] = False

    # Curated ordering: best-value / most complete villas lead the collection.
    villas.sort(key=lambda v: (0 if v["photos"] else 1, v["price_from"] <= 0, -v["sleeps"], v["name"].lower()))

    if not args.no_images:
        print(f"→ photography into assets/villas/")
        download_photos(villas, max(1, args.images))
        for villa in villas:
            meta = sorted(villa.pop("photo_meta", []), key=lambda m: m["base"])
            villa["images"] = meta or [
                {
                    "base": None,
                    "url": url,
                    "width": 1400,
                    "height": 933,
                    "colour": "#d8d1c4",
                }
                for url in villa["photos"][: max(1, args.images)]
            ]
    else:
        for villa in villas:
            villa["images"] = [
                {"base": None, "url": url, "width": 1400, "height": 933, "colour": "#d8d1c4"}
                for url in villa["photos"][: max(1, args.images)]
            ]

    # Trim payloads that are only needed internally.
    for villa in villas:
        if villa["images"] and villa["images"][0].get("base"):
            first = villa["images"][0]
            villa["image"] = f"/assets/{first['base']}-800.webp"
            villa["image_large"] = f"/assets/{first['base']}-1400.webp"
            villa["image_colour"] = first["colour"]
        else:
            villa["image"] = villa["images"][0]["url"] if villa["images"] else ""
            villa["image_large"] = villa["image"]
            villa["image_colour"] = "#d8d1c4"

    public_prices = {}
    for villa in villas:
        rows = prices.get(villa["v_uuid"].lower(), [])
        if rows:
            public_prices[villa["slug"]] = [
                {
                    "from": r["from"],
                    "to": r["to"],
                    "night": r["night"],
                    "min_nights": r["min_nights"],
                    "checkin": r["checkin"],
                }
                for r in rows
            ]

    meta = {
        "fetched_at": iso_now(),
        "destination": destination,
        "api_host": urllib.parse.urlparse(os.environ.get("INVENIO_BASE_URL", "https://api.inveniohomes.com")).netloc,
        "available_in_account": len(all_villas),
        "published": len(villas),
        "api_switch_on": sum(1 for v in villas if v["api_switch_on"]),
        "dcc": sum(1 for v in villas if v["dcc"]),
        "regions": len({v["region"] for v in villas}),
        "areas": len({v["area_key"] for v in villas}),
        "photos": sum(len(v["images"]) for v in villas),
        "min_price": min([v["price_from"] for v in villas if v["price_from"]] or [0]),
        "max_price": max([v["price_to"] for v in villas] or [0]),
        "max_sleeps": max([v["sleeps"] for v in villas] or [0]),
    }

    (DATA / "villas.json").write_text(json.dumps(villas, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "prices.json").write_text(json.dumps(public_prices, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n✓ {len(villas)} villas → data/villas.json")
    print(f"✓ {len(public_prices)} price sheets → data/prices.json")
    print(f"✓ {meta['photos']} photographs → assets/villas/")
    print(f"  {meta['areas']} areas · {meta['regions']} regions · sleeps up to {meta['max_sleeps']}")


if __name__ == "__main__":
    main()
