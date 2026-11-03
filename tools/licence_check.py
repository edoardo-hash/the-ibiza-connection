#!/usr/bin/env python3
"""Cross-check villa tourist licences against the official Ibiza register.

The register is the Consell d'Eivissa list of tourist homes ("Llistat habitatges
turístics"), downloaded as an .xls that is really an HTML table. Drop a fresh
download anywhere and run

    python3 tools/licence_check.py --import ~/Downloads/List-habitatges-turistics_-DDMMYYYY.xls

to refresh data/register/habitatges-turistics.csv (only the public columns we need:
no operator names, phones or e-mails). fetch_invenio.py runs check_villas() on every
refresh, so each newly published villa is checked the day it appears.

Rule (Edo, 3 Nov 2026): the 4 digits are the licence. ETV1276E is correct when 1276 is
in the register. If the number is right but the prefix or suffix entered in IMpulse differs
from the register (ET vs ETV, a missing "E", "EIF"…), the villa stays listed and is flagged.
Separators and zero-padding don't count ("ETV-1276-E" = "ETV1276E").

Statuses
  verified        the number is in the register, written the same way
  format_differs  the number is in the register, prefix/suffix differ → flagged, fix in IMpulse
  (AG agroturismo, HAC hotel-apartment and other kinds are checked in their own Consell lists —
   turisme rural, establiments hotelers, apartaments — stored next to the tourist-home list)
  not_in_register the 4 digits are not in the register → failure
  no_number       no 4-digit licence number can be read → failure
Failures are kept off the site until a HAM confirms the licence
(content/settings.json → licence_confirmed; licence_policy "flag" lists them anyway).
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTER_DIR = ROOT / "data" / "register"
REGISTER_CSV = REGISTER_DIR / "habitatges-turistics.csv"
# The Consell publishes one list per kind of accommodation; each is stored as its own CSV.
REGISTER_KINDS = {
    "habitatges turístics": "habitatges-turistics",   # ET, ETV, VT, VTV (tourist homes)
    "turisme rural": "turisme-rural",                 # AG (agroturismo), HR, HRU
    "establiments hotelers": "establiments-hotelers", # H, HPM, HA, HAC, TI…
    "apartaments": "apartaments",                     # A, APM
}
REPORT = ROOT / "data" / "licence-check.json"

FAIL = {"not_in_register", "no_number"}
COLUMNS = ["number", "licence", "register", "name", "subtype", "places", "rooms", "cadastre", "municipality"]

# Cadastral municipality codes (province 07 + INE municipality) → register spelling.
CADASTRE_MUNICIPALITY = {
    "07026": "EIVISSA",
    "07046": "SANT ANTONI DE PORTMANY",
    "07048": "SANT JOSEP DE SA TALAIA",
    "07050": "SANT JOAN DE LABRITJA",
    "07054": "SANTA EULARIA DES RIU",
}
# Site districts → municipalities they cover (the "Ibiza" district spans three).
REGION_MUNICIPALITIES = {
    "ibiza": {"EIVISSA", "SANT JOSEP DE SA TALAIA", "SANTA EULARIA DES RIU"},
    "san-antonio": {"SANT ANTONI DE PORTMANY"},
    "san-jose": {"SANT JOSEP DE SA TALAIA"},
    "santa-eulalia": {"SANTA EULARIA DES RIU"},
    "san-juan": {"SANT JOAN DE LABRITJA"},
}
HOUSING_PREFIXES = {"ET", "ETV", "VT", "VTV"}
# Licence letters of the other Consell lists; anything else (including typos such as "ETC" or
# "ETE") is treated as a tourist-home licence, where only the number counts.
OTHER_KIND_PREFIXES = {"AG", "HR", "HRU", "H", "HA", "HAC", "HC", "HPM", "HS", "TI", "A", "APM", "CH", "HOS", "AT"}


def licence_number(text) -> int | None:
    m = re.search(r"(\d{3,5})", str(text or ""))
    return int(m.group(1)) if m else None


def licence_prefix(text) -> str:
    m = re.match(r"[#\s]*([A-Za-z]+)", str(text or ""))
    return m.group(1).upper() if m else ""


def digits(text) -> str:
    """The licence digits without leading zeros: 'ETV-0216-EIF' → '216'."""
    m = re.search(r"(\d{3,5})", str(text or ""))
    return m.group(1).lstrip("0") if m else "\0"


def parcel(ref) -> str:
    """First 14 characters of a cadastral reference: the parcel. '' for placeholders."""
    ref = re.sub(r"[^0-9A-Z]", "", str(ref or "").upper())
    return ref[:14] if len(ref) >= 14 and re.search(r"\d{5}", ref) else ""


def cadastre_municipality(ref) -> str:
    p = parcel(ref)
    return CADASTRE_MUNICIPALITY.get(p[:5], "") if re.match(r"07\d{3}[A-Z]", p) else ""


# --- register -------------------------------------------------------------------------

def parse_register_file(path: Path) -> list[dict]:
    raw = Path(path).read_bytes()
    for encoding in ("utf-8", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I)
    if not rows:
        sys.exit(f"{path}: no table rows found (expected the HTML-table .xls from the Consell)")

    def cells(row):
        return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S | re.I)]

    head_at = next((i for i, r in enumerate(rows[:5]) if any("Inscrip" in c for c in cells(r))), None)
    if head_at is None:
        sys.exit(f"{path}: header row with 'Número Inscripció' not found")
    head = cells(rows[head_at])
    title = (cells(rows[0]) or [""])[0] if head_at > 0 else ""
    kind = next((slug for key, slug in REGISTER_KINDS.items() if key in title.lower()), None)
    if kind is None:
        first = cells(rows[head_at + 1]) if len(rows) > head_at + 1 else []
        kind = next((slug for key, slug in REGISTER_KINDS.items() if first and key in first[0].lower()), "habitatges-turistics")

    def col(*names, required=True):
        for i, h in enumerate(head):
            if any(n.lower() in h.lower() for n in names):
                return i
        if required:
            sys.exit(f"{path}: column {names[0]!r} not found in {head}")
        return None

    i_num, i_sub, i_places = col("Inscrip"), col("Sub-tipus"), col("Total Places")
    i_rooms = col("Total Habitacions", "Total Apartaments", required=False)
    i_cad, i_mun = col("cadastral", required=False), col("Municipi")
    i_name = col("Nom Comercial", required=False)
    get = lambda c, i: c[i] if i is not None and i < len(c) else ""
    out = []
    for r in rows[head_at + 1:]:
        c = cells(r)
        if len(c) <= max(i_num, i_mun):
            continue
        n = licence_number(c[i_num])
        if n is None:
            continue
        out.append({
            "number": n,
            "licence": c[i_num].lstrip("#"),
            "register": kind,
            "name": get(c, i_name),
            "subtype": c[i_sub],
            "places": c[i_places],
            "rooms": get(c, i_rooms),
            "cadastre": get(c, i_cad),
            "municipality": c[i_mun],
        })
    return out


def import_register(path: Path) -> Path:
    rows = parse_register_file(path)
    kind = rows[0]["register"] if rows else ""
    minimum = 1000 if kind == "habitatges-turistics" else 20
    if len(rows) < minimum:
        sys.exit(f"{path}: only {len(rows)} licences — that doesn't look like the full list")
    REGISTER_DIR.mkdir(parents=True, exist_ok=True)
    m = re.search(r"(\d{2})(\d{2})(\d{4})", Path(path).name)
    as_of = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else date.today().isoformat()
    out = REGISTER_DIR / f"{kind}.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        fh.write(f"# Consell d'Eivissa register ({kind}), as of {as_of}; source file {Path(path).name}\n")
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"Register {kind}: {len(rows)} licences as of {as_of} → {out.relative_to(ROOT)}")
    return out


def load_register() -> tuple[list[dict], str]:
    rows, dates = [], []
    for path in sorted(REGISTER_DIR.glob("*.csv")):
        with path.open(encoding="utf-8") as fh:
            first = fh.readline()
            m = re.search(r"as of (\d{4}-\d{2}-\d{2})", first)
            if m:
                dates.append(m.group(1))
            for r in csv.DictReader(fh):
                r["number"] = int(r["number"])
                r["register"] = r.get("register") or path.stem
                rows.append(r)
    return rows, (min(dates) if dates else "")


# --- check ----------------------------------------------------------------------------

def four_digits(text) -> int | None:
    """The licence number: the digit group, leading zeros ignored, if it has at most 4
    significant digits ('ETV-1276-E' → 1276, 'VTV-02166' → 2166, '2014047792' → None)."""
    groups = [g for g in re.findall(r"\d+", str(text or "")) if len(g) >= 3]  # 'E2' suffixes aside
    if len(groups) != 1:
        return None
    sig = groups[0].lstrip("0")
    return int(sig) if 1 <= len(sig) <= 4 else None


def shape(text) -> str:
    """Letters + number, no separators or padding: '#ETV-01276-E' → 'ETV1276E'."""
    t = re.sub(r"[^0-9A-Z]", "", str(text or "").upper())
    return re.sub(r"0*(\d+)", lambda m: m.group(1), t)


def check_villa(villa: dict, by_number: dict) -> dict:
    lic = villa.get("license") or ""
    parts = [p.strip() for p in re.split(r"\s+(?:and|y|&)\s+|\s*[,;]\s*|\s*/\s*(?=[A-Za-z])", lic) if p.strip()]
    if len(parts) > 1:  # e.g. "ETV-1257-E and ET-0851-E": two houses, two licences
        subs = [check_villa({**villa, "license": p, "sleeps": 0}, by_number) for p in parts]
        worst = next((r for r in subs if not r["ok"]), None) or next((r for r in subs if r["issues"]), subs[0])
        return {**worst, "licence": lic, "ok": all(r["ok"] for r in subs),
                "register_licence": " + ".join(r["register_licence"] or "—" for r in subs),
                "register_places": sum(r["register_places"] or 0 for r in subs) or None,
                "issues": [i for r in subs for i in r["issues"]]
                + ([f"Shown for {villa['sleeps']} guests; the register allows "
                    f"{sum(r['register_places'] or 0 for r in subs)} places"]
                   if all(r["register_places"] for r in subs)
                   and villa.get("sleeps", 0) > sum(r["register_places"] for r in subs) else [])}
    num, prefix = four_digits(lic), licence_prefix(lic)
    hits = by_number.get(num, []) if num is not None else []
    # Tourist homes: the prefix doesn't matter (ET/ETV/VT/VTV share the numbering rule). Other kinds
    # (AG agroturismo, HAC hotel-apartment…) only match a licence of the same letters in their own list.
    if prefix not in OTHER_KIND_PREFIXES:
        hits = [h for h in hits if h.get("register", "habitatges-turistics") == "habitatges-turistics"]
    else:
        hits = [h for h in hits if licence_prefix(h["licence"]) == prefix]
    exact = [h for h in hits if shape(h["licence"]) == shape(lic)]
    match = (exact or hits or [None])[0]
    issues: list[str] = []
    if num is None:
        status = "no_number"
        issues.append(f"'{lic}' has no readable 4-digit licence number")
    elif not hits:
        status = "not_in_register"
        issues.append(f"{num:04d} ('{lic}') is not in the register")
    elif exact:
        status = "verified"
    else:
        status = "format_differs"
        issues.append(f"Number {num:04d} is correct, but IMpulse has '{lic}' and the register has "
                      + " / ".join(h["licence"] for h in hits))
    places = int(match["places"]) if match and len(exact or hits) == 1 and str(match.get("places", "")).isdigit() else None
    if places and villa.get("sleeps", 0) > places:
        issues.append(f"Shown for {villa['sleeps']} guests; the register allows {places} places")
    return {
        "status": status,
        "ok": status not in FAIL,
        "licence": lic,
        "register_licence": " / ".join(h["licence"] for h in (exact or hits)) or None,
        "register_places": places,
        "register_municipality": match["municipality"] if match else None,
        "register": match.get("register") if match else None,
        "register_name": match.get("name") if match else None,
        "issues": issues,
    }


def check_villas(villas: list[dict], lr_by_uuid: dict, confirmed: dict | None = None) -> dict:
    """Annotate villas in place (villa["licence_check"]) and return the report."""
    rows, as_of = load_register()
    if not rows:
        print("  licence check: no register in data/register/ — skipped")
        return {}
    by_number = defaultdict(list)
    for r in rows:
        by_number[r["number"]].append(r)
    confirmed = {k.lower(): v for k, v in (confirmed or {}).items()}
    report = {"register_as_of": as_of, "checked_on": date.today().isoformat(), "villas": {}}
    for v in villas:
        uuid = str(v.get("v_uuid") or "").lower()
        res = check_villa(v, by_number)
        if not res["ok"] and uuid in confirmed:
            res["ok"] = True
            res["confirmed_by_ham"] = confirmed[uuid]
        v["licence_check"] = res
        report["villas"][uuid] = {"name": v.get("name"), "slug": v.get("slug"), **res}
    # Several listed units on one licence (e.g. a hotel-apartment licence split into two villas):
    # their guests together must fit the licence's places.
    shared = defaultdict(list)
    for v in villas:
        res = v["licence_check"]
        if res.get("register_licence") and res.get("register_places"):
            shared[res["register_licence"]].append(v)
    for lic, group in shared.items():
        if len(group) > 1:
            total = sum(v.get("sleeps", 0) for v in group)
            places = group[0]["licence_check"]["register_places"]
            if total > places:
                names = " + ".join(v.get("name", "") for v in group)
                for v in group:
                    msg = f"{names} share licence {lic}: {total} guests shown together, the register allows {places} places"
                    v["licence_check"]["issues"].append(msg)
                    report["villas"][str(v.get("v_uuid") or "").lower()]["issues"] = v["licence_check"]["issues"]
    counts: dict[str, int] = defaultdict(int)
    for r in report["villas"].values():
        counts[r["status"]] += 1
    report["counts"] = dict(sorted(counts.items()))
    report["hidden"] = sorted(r["name"] for r in report["villas"].values() if not r["ok"])
    report["flagged"] = sorted(r["name"] for r in report["villas"].values() if r["issues"] and r["ok"])
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--import", dest="import_file", help="refresh the stored register from a Consell .xls download")
    ap.add_argument("--report", action="store_true", help="print the last check (data/licence-check.json)")
    args = ap.parse_args()
    if args.import_file:
        import_register(Path(args.import_file).expanduser())
    if args.report or not args.import_file:
        if not REPORT.exists():
            sys.exit("No report yet: run tools/fetch_invenio.py")
        rep = json.loads(REPORT.read_text(encoding="utf-8"))
        print(f"Register as of {rep['register_as_of']}, checked {rep['checked_on']}: {rep['counts']}")
        for r in sorted(rep["villas"].values(), key=lambda r: (r["ok"], r["status"], r["name"])):
            if r["issues"]:
                print(f"  {'HIDDEN ' if not r['ok'] else ''}{r['name']} [{r['status']}] — " + "; ".join(r["issues"]))


if __name__ == "__main__":
    main()
