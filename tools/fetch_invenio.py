#!/usr/bin/env python3
"""
Fetch the villa collection from the Invenio Homes Data Export API.

    python3 tools/fetch_invenio.py                 # data + photography
    python3 tools/fetch_invenio.py --no-images     # data only
    python3 tools/fetch_invenio.py --images 8      # photos per villa

Writes:
    data/villas.json   public, normalised villa records: every published, licensed villa
                       in the destination, whether or not its "API" switch is on, DCC or not,
                       plus the licensed ones unpublished in the last 7 days
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import licence_check  # noqa: E402

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


def api_form(endpoint: str, param: list, timeout: int = 600, base: str | None = None):
    """POST in the form the full-list endpoints expect: body param=<JSON array>.
    Returns (rows, payload_size). Rows are [] when the key has no access to the endpoint."""
    base = (base or os.environ.get("INVENIO_BASE_URL", "https://api.inveniohomes.com")).rstrip("/")
    headers = {k: v for k, v in api_headers().items() if k != "Content-Type"}
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    body = urllib.parse.urlencode({"param": json.dumps(param)}).encode("utf-8")
    request = urllib.request.Request(f"{base}/plapi/getdata/{endpoint}", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        mirror = response.headers.get("X-Mirror")
        if mirror:
            print(f"  mirror: {mirror}, fetched at {response.headers.get('X-Mirror-Fetched-At', '?')}")
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
        "slug": "san-jose",
        "name": "San José",
        "short": "Es Cubells, Cala Jondal & the sunset coast",
    },
    "Ibiza": {
        "slug": "ibiza",
        "name": "Ibiza",
        "short": "The old town, Talamanca & Cap Martinet",
    },
    "Santa Eulalia del Rio": {
        "slug": "santa-eulalia",
        "name": "Santa Eulalia",
        "short": "Santa Eulalia, Cala Llonga & Es Canar",
    },
    "San Antonio de Portmany": {
        "slug": "san-antonio",
        "name": "San Antonio",
        "short": "San Antonio, Cala Bassa & Cala Conta",
    },
    "San Juan de Labritja": {
        "slug": "san-juan",
        "name": "San Juan",
        "short": "San Juan, Portinatx & the bohemian coast",
    },
}

# Area names are kept exactly as IMpulse and the Invenio portal spell them (Edo, 2 Nov 2026).
AREA_LABELS: dict[str, str] = {}


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
    parser.add_argument("--recent-unpublished-days", type=int, default=7,
                        help="also list villas unpublished within this many days (Edo, 2 Nov 2026: 7); 0 = published only")
    parser.add_argument("--max-change", type=float, default=0.3,
                        help="stop if the number of villas changes by more than this share vs data/villas.json "
                             "(default 0.3 = 30%%); 0 = no check")
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
            lr_rows, lr_size = [], 0
            # INVENIO_LR_BASE_URL: the netcup mirror (https://data.invenio.tools) serves the full list
            # from the ETL's nightly 23:00 pull, so reading it costs IMpulse nothing. IMpulse is only
            # asked directly when the mirror isn't set or fails.
            mirror = os.environ.get("INVENIO_LR_BASE_URL", "").strip()
            if mirror:
                try:
                    lr_rows, lr_size = api_form("api_villa_list_lr", [{"long_rental_check_skip": "1"}], base=mirror)
                except Exception as exc:  # noqa: BLE001
                    print(f"  ! mirror {mirror} failed ({exc}); asking IMpulse directly")
            if not lr_rows:
                lr_rows, lr_size = api_form("api_villa_list_lr", [{"long_rental_check_skip": "1"}])
    except Exception as exc:  # noqa: BLE001
        lr_rows, lr_size = [], 0
        print(f"  ! could not read api_villa_list_lr ({exc})")
    # Villas unpublished in the last N days stay listed too (Edo, 2 Nov 2026): a villa is often
    # unpublished for a few days (e.g. a calendar to confirm) and is still bookable.
    today = datetime.now(timezone.utc).date()

    def unpublished_on(row):
        try:
            return datetime.strptime(str(row.get("unpublished_date") or "")[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    status = {}
    # Exact positions, for the "two villas nearby" pairs only (portal rule: exact GPS, server-side).
    # They stay in memory: only the rounded distance between two villas is written (see below).
    exact_gps: dict[str, tuple[float, float]] = {}
    for r in lr_rows:
        if isinstance(r, dict):
            lat, lng = parse_gps(r.get("actual_gps"))
            if lat is not None:
                exact_gps[str(r.get("bp_uuid") or "").strip().lower()] = (lat, lng)
    for r in lr_rows:
        if not isinstance(r, dict):
            continue
        published = yes(r.get("published_status"))
        since = None if published else unpublished_on(r)
        recent = since is not None and 0 <= (today - since).days <= args.recent_unpublished_days
        status[str(r.get("bp_uuid") or "").strip().lower()] = {
            "listed": published or (args.recent_unpublished_days > 0 and recent),
            "published": published,
            "unpublished_on": since.isoformat() if since and recent else None,
            "api": yes(r.get("api_information")),
        }
    if status:
        selected = [v for v in candidates if status.get(str(v.get("v_uuid") or "").lower(), {}).get("listed")]
        for v in selected:
            st = status[str(v["v_uuid"]).lower()]
            v["_api_switch_on"] = st["api"]
            v["_unpublished_on"] = st["unpublished_on"]
        off = sum(1 for v in selected if not v["_api_switch_on"])
        recent_n = sum(1 for v in selected if v["_unpublished_on"])
        print(f"  {len(lr_rows)} villas / {lr_size / 1024:.0f} kB → {len(selected)} licensed {destination} villas: "
              f"{len(selected) - recent_n} published + {recent_n} unpublished in the last "
              f"{args.recent_unpublished_days} days ({off} with the API switch off)")
    else:
        # Without the long-rental list there is no published flag. A full-access key's
        # api_villa_list also holds hundreds of unpublished villas, so never fall back to it.
        sys.exit("api_villa_list_lr returned nothing (mirror and IMpulse): cannot tell which villas are published.\n"
                 "Nothing was written. Check the key's access to api_villa_list_lr and the netcup mirror.")
    if not selected:
        sys.exit(f"No villas found for destination '{destination}'.")
    previous_file = DATA / "villas.json"
    if args.max_change and previous_file.exists() and not args.only:
        before = len(json.loads(previous_file.read_text(encoding="utf-8")))
        if before and abs(len(selected) - before) / before > args.max_change:
            sys.exit(f"Villa count would change from {before} to {len(selected)} (more than {args.max_change:.0%}). "
                     "Nothing was written. Check the data, then rerun with --max-change 0 to accept it.")
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
            # Set when the villa is listed because it was unpublished recently (YYYY-MM-DD).
            "unpublished_on": item.get("_unpublished_on"),
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

    # Room counts and licence check (Edo, 3 Nov 2026).
    # Bedrooms and bathrooms: the REAL counts from IMpulse (api_villa_list only carries the
    # licensed ones), as on the Invenio portal. Guests stay the licensed number.
    lr_by_uuid = {str(r.get("bp_uuid") or "").strip().lower(): r for r in lr_rows if isinstance(r, dict)}
    for villa in villas:
        lr = lr_by_uuid.get(villa["v_uuid"].lower(), {})
        villa["licensed_bedrooms"], villa["licensed_bathrooms"] = villa["bedrooms"], villa["bathrooms"]
        villa["bedrooms"] = as_int(lr.get("bedrooms")) or villa["bedrooms"]
        villa["bathrooms"] = as_int(lr.get("bathrooms")) or villa["bathrooms"]
    # Every listed villa (so every newly published one) is checked against the official
    # register in data/register/ on each refresh. Failures stay off the site until the HAM
    # confirms the licence (content/settings.json "licence_confirmed", by IMpulse uuid).
    settings = json.loads((ROOT / "content" / "settings.json").read_text(encoding="utf-8"))
    report = licence_check.check_villas(villas, lr_by_uuid, settings.get("licence_confirmed") or {})
    if report:
        policy = settings.get("licence_policy", "hide")
        if policy == "hide" and not args.only:
            villas = [v for v in villas if v["licence_check"]["ok"]]
        report["policy"] = policy
        (DATA / "licence-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  licence check (register of {report['register_as_of']}): {report['counts']}")
        if report["hidden"]:
            print(f"  ! {'hidden' if policy == 'hide' else 'FAILED (still listed)'} until a HAM confirms: "
                  + ", ".join(report["hidden"]))
        print(f"  {len(report['flagged'])} more flagged for review → data/licence-check.json")

    # "The area" (Edo, 3 Nov 2026, as on the Invenio portal): road distances come from the portal's
    # data/area/area-road.json (OSRM, by uuid). Villas missing there get them computed here in a
    # straight line from the exact GPS, with the portal's rules (lib/area-compute.ts). Only place
    # names and kilometres are stored; the villa's position never is.
    area_dir = DATA / "area"
    try:
        road = json.loads((area_dir / "area-road.json").read_text(encoding="utf-8"))["villas"]
        older = json.loads((area_dir / "area-info.json").read_text(encoding="utf-8"))["villas"]
        places = json.loads((area_dir / "area-places.json").read_text(encoding="utf-8"))
    except (OSError, KeyError, ValueError):
        road, older, places = {}, {}, None
    computed = {}
    if places:
        def hav(a, b):
            la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
            h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
            return 2 * 6371 * math.asin(math.sqrt(h))

        def pt(x):
            return (x["lat"], x["lng"])

        def nearest(items, p):
            best = min(items, key=lambda x: hav(p, pt(x)), default=None)
            return {"name": best["name"], "km": round(hav(p, pt(best)), 1)} if best else None

        def as_place(x, d):
            return {k: v for k, v in {"name": x["name"], "km": round(d, 1), "kind": x.get("kind"),
                                      "category": x.get("category"), "note": x.get("note")}.items() if v}

        for villa in villas:
            uuid = villa["v_uuid"].lower()
            p = exact_gps.get(uuid)
            if uuid in road or uuid in older or not p or not (38.8 < p[0] < 39.15 and 1.15 < p[1] < 1.65):
                continue
            ranked = sorted(((x, hav(p, pt(x))) for x in places["places"]), key=lambda t: t[1])
            restaurants = [as_place(x, d) for x, d in ranked if x.get("kind") in ("restaurant", "beach_club")][:3]
            sights, seen = [], []
            for x, d in ranked:
                if x.get("kind") != "sight":
                    continue
                tokens = {t.strip().lower() for t in re.split(r"[,/]", x.get("category") or "") if t.strip()}
                if any(tokens & s for s in seen):
                    continue
                sights.append(as_place(x, d))
                seen.append(tokens)
                if len(sights) == 3:
                    break
            computed[uuid] = {
                "airportKm": round(hav(p, pt(places["airport"])), 1), "airportMin": None,
                "townKm": round(hav(p, pt(places["town"])), 1),
                "beach": nearest(places["beaches"], p), "supermarket": nearest(places["supermarkets"], p),
                "nearTown": nearest(places["towns"], p), "road": False,
                "restaurants": restaurants, "sights": sights,
            }
        (area_dir / "area-computed.json").write_text(
            json.dumps({"updated": iso_now(), "villas": computed}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        print(f"  area: {sum(1 for v in villas if v['v_uuid'].lower() in road)} by road, "
              f"{len(computed)} computed in a straight line")

    # "Two villas nearby" (Edo, 3 Nov 2026, portal villa-groups logic with 2 villas / 5 km): for
    # each villa, the other listed villas within PAIR_MAX_KM by EXACT GPS (straight line). Only
    # the distance rounded UP to the next half kilometre is stored; exact positions never are.
    # Villas without an exact position are left out, as on the portal.
    pair_max_km = 5.0

    def km_between(a, b):
        dy = (b[0] - a[0]) * 111.32
        dx = (b[1] - a[1]) * 111.32 * math.cos(math.radians((a[0] + b[0]) / 2))
        return math.hypot(dx, dy)

    located = [(v, exact_gps.get(v["v_uuid"].lower())) for v in villas]
    located = [(v, pt) for v, pt in located if pt]
    for villa in villas:
        villa["near"] = []
    for i, (va, pa) in enumerate(located):
        for vb, pb in located[i + 1:]:
            d = km_between(pa, pb)
            if d <= pair_max_km:
                rounded = max(0.5, math.ceil(d * 2) / 2)
                va["near"].append([vb["slug"], rounded])
                vb["near"].append([va["slug"], rounded])
    for villa in villas:
        villa["near"].sort(key=lambda x: (x[1], x[0]))
    print(f"  pairs: {len(located)} villas with an exact position, "
          f"{sum(len(v['near']) for v in villas) // 2} pairs within {pair_max_km:g} km")

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
        "recently_unpublished": sum(1 for v in villas if v.get("unpublished_on")),
        "dcc": sum(1 for v in villas if v["dcc"]),
        "regions": len({v["region"] for v in villas}),
        "areas": len({v["area_key"] for v in villas}),
        "photos": sum(len(v["images"]) for v in villas),
        "min_price": min([v["price_from"] for v in villas if v["price_from"]] or [0]),
        "max_price": max([v["price_to"] for v in villas] or [0]),
        "max_sleeps": max([v["sleeps"] for v in villas] or [0]),
        "licence_check": report.get("counts", {}) if report else {},
        "licence_hidden": len(report.get("hidden", [])) if report else 0,
    }

    # Booked dates for the instant date search (Edo, 3 Nov 2026). Read from the netcup mirror's
    # nightly copy of api_villa_calendar (no IMpulse load); IMpulse directly only if that fails.
    # Only "Confirmed" blocks count (portal rule: under offer / requested don't block until paid);
    # cancelled ones are ignored. The villa page still checks availability live before booking.
    busy: dict[str, list[list[str]]] = {}
    try:
        cal_rows = []
        mirror = os.environ.get("INVENIO_LR_BASE_URL", "").strip()
        for base in ([mirror] if mirror else []) + [None]:
            try:
                cal_rows, cal_size = api_form("api_villa_calendar", [{"v_uuid": ""}], base=base)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! calendar from {base or 'IMpulse'} failed ({exc})")
            if cal_rows:
                break
        listed = {v["v_uuid"].lower() for v in villas}
        today_iso = datetime.now(timezone.utc).date().isoformat()
        for r in cal_rows:
            uuid = str(r.get("v_uuid") or "").strip().lower()
            if uuid not in listed or str(r.get("status") or "").strip().lower() != "confirmed":
                continue
            ci, co = str(r.get("checkin") or "")[:10], str(r.get("checkout") or "")[:10]
            if len(ci) == 10 and len(co) == 10 and co > today_iso and co > ci:
                busy.setdefault(uuid, []).append([ci, co])
        for ranges in busy.values():
            ranges.sort()
        print(f"  calendar: {sum(len(x) for x in busy.values())} confirmed bookings on {len(busy)} villas")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! calendar skipped ({exc}); date searches fall back to live availability")
    if busy or not (DATA / "busy.json").exists():
        (DATA / "busy.json").write_text(json.dumps({"fetched_at": iso_now(), "busy": busy}, separators=(",", ":")), encoding="utf-8")

    (DATA / "villas.json").write_text(json.dumps(villas, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "prices.json").write_text(json.dumps(public_prices, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n✓ {len(villas)} villas → data/villas.json")
    print(f"✓ {len(public_prices)} price sheets → data/prices.json")
    print(f"✓ {meta['photos']} photographs → assets/villas/")
    print(f"  {meta['areas']} areas · {meta['regions']} regions · sleeps up to {meta['max_sleeps']}")


if __name__ == "__main__":
    main()
