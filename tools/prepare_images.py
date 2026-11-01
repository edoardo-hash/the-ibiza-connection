#!/usr/bin/env python3
"""
Art-directed crops for the editorial parts of the site.

Downloads the original photographs for a handful of chosen villas and writes
the exact sizes the templates ask for:

    python3 tools/prepare_images.py

Outputs live in assets/img/ and are committed with the site.
"""

from __future__ import annotations

import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"
DATA = json.loads((ROOT / "data" / "villas.json").read_text(encoding="utf-8"))
BY_SLUG = {v["slug"]: v for v in DATA}
CACHE = ROOT / ".image-cache"

# slug, photo index, output name, width, height, focal point (x, y)
CROPS = [
    ("villa-katherine", 0, "hero", 2400, 1400, (0.5, 0.55)),
    ("villa-katherine", 2, "destination-south-west", 2000, 1200, (0.5, 0.5)),
    ("villa-abigail", 0, "destination-ibiza-town", 2000, 1200, (0.5, 0.5)),
    ("villa-mariola", 1, "destination-east", 2000, 1200, (0.5, 0.5)),
    ("vista-conta", 0, "destination-west", 2000, 1200, (0.5, 0.5)),
    ("villa-amaya", 1, "destination-north", 2000, 1200, (0.5, 0.5)),
    ("villa-katherine", 0, "hero-mobile", 1100, 1500, (0.5, 0.55)),
    ("villa-katherine", 0, "og", 1200, 630, (0.5, 0.5)),
    ("villa-katherine", 2, "region-south-west", 1200, 1500, (0.5, 0.5)),
    ("villa-abigail", 0, "region-ibiza-town", 1200, 1500, (0.5, 0.55)),
    ("villa-mariola", 1, "region-east", 1200, 1500, (0.5, 0.5)),
    ("vista-conta", 0, "region-west", 1200, 1500, (0.5, 0.5)),
    ("can-cecilia", 1, "region-north", 1200, 1500, (0.5, 0.55)),
    ("can-alivia", 0, "journal-north", 1600, 1067, (0.5, 0.5)),
    ("villa-talamanca-views", 0, "journal-town", 1600, 1067, (0.5, 0.5)),
    ("villa-abigail", 0, "cta", 2200, 1200, (0.5, 0.5)),
    ("villa-talamanca-views", 0, "experiences", 2000, 1200, (0.5, 0.5)),
    ("villa-mariola", 2, "car", 1800, 1200, (0.5, 0.5)),
    ("villa-mariola", 5, "concierge", 1800, 1200, (0.5, 0.5)),
    ("villa-nia", 1, "owners", 1800, 1200, (0.5, 0.5)),
    ("can-alivia", 2, "about", 1800, 1200, (0.5, 0.5)),
    ("villa-talamanca-views", 1, "contact", 1800, 1200, (0.5, 0.5)),
]


def download(url: str) -> bytes:
    safe = urllib.parse.quote(url, safe=":/,?=&%+~#")
    request = urllib.request.Request(safe, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def crop(image: Image.Image, width: int, height: int, focal: tuple[float, float]) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    target = width / height
    source = image.width / image.height
    if source > target:
        new_w = round(image.height * target)
        left = round((image.width - new_w) * focal[0])
        box = (left, 0, left + new_w, image.height)
    else:
        new_h = round(image.width / target)
        top = round((image.height - new_h) * focal[1])
        box = (0, top, image.width, top + new_h)
    image = image.crop(box)
    if image.width < width:
        return image.resize((width, height), Image.LANCZOS)
    return image.resize((width, height), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    failures = 0
    for slug, index, name, width, height, focal in CROPS:
        villa = BY_SLUG.get(slug)
        if not villa:
            print(f"! missing villa {slug}")
            failures += 1
            continue
        url = villa["photos"][index]
        cache_file = CACHE / f"{slug}-{index}.jpg"
        if cache_file.exists():
            raw = cache_file.read_bytes()
        else:
            try:
                raw = download(url)
            except Exception as exc:  # noqa: BLE001
                print(f"! {slug} {index}: {exc}")
                failures += 1
                continue
            cache_file.write_bytes(raw)
        image = Image.open(io.BytesIO(raw))
        out = crop(image, width, height, focal)
        # A little warmth and contrast so editorial images sit with the palette.
        out = ImageEnhance.Color(out).enhance(1.03)
        out = ImageEnhance.Contrast(out).enhance(1.02)
        path = OUT / f"{name}.webp"
        out.save(path, "WEBP", quality=82, method=5)
        print(f"✓ {name:22s} {width}×{height}  {path.stat().st_size/1024:.0f} kB")
    if failures:
        sys.exit(f"{failures} image(s) failed")


if __name__ == "__main__":
    main()
