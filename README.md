# The Ibiza Connection

A complete website for **The Ibiza Connection** — the independent villa agency in
Santa Eulària des Riu, Ibiza — rebuilt from the old site and wired directly to the
Invenio Homes Data Export API.

**Live:** <https://theibizaconnection.vercel.app/>  
**Vercel project:** `theibizaconnection` (team: edo's projects)  
**Availability API:** production and preview environment variables are configured.

The collection, prices and availability are real: the site is generated from the API,
with photography mirrored locally so pages stay fast and work offline.

![The Ibiza Connection — home](screenshots/home-hero.jpg)

| The collection | A villa |
|---|---|
| ![Villas](screenshots/villas.jpg) | ![Villa Katherine](screenshots/villa.jpg) |

| Destinations | On the water |
|---|---|
| ![Destinations](screenshots/destinations.jpg) | ![Boat days](screenshots/boat.jpg) |

| Mobile | Menu |
|---|---|
| ![Mobile home](screenshots/mobile-home.jpg) | ![Mobile menu](screenshots/mobile-menu.jpg) |

## What's inside

- **98 static pages**: home, 77 villa pages, 5 destination guides, journal, experiences
  (boats, cars, concierge), about, owners, contact, privacy, terms and a 404.
- **Real inventory** from `api.inveniohomes.com`: names, descriptions, photographs,
  amenities, capacity, licences and rates.
- **Live availability**: search with dates and the listing filters itself against the
  Invenio calendar (44 of 77 villas available for a typical June week, in our tests).
  Individual villa pages quote the exact stay price.
- **Best-of-both editing**: copy lives in `content/*.json`; villa data is refreshed from
  the API, never hand-edited.
- **Fast by default**: no framework, no runtime dependencies, one CSS file, one 30 KB
  JS file, self-hosted variable fonts, locally optimised WebP photography.
- **Deploy anywhere**: Netlify, Vercel, S3, nginx. The availability endpoint is included
  for all three (Node server, Vercel function, Netlify function).

## Quick start

Requirements: **Python 3.10+** (Pillow for photography) and **Node 20+** for the dev
server and availability proxy. No `npm install` is needed.

```bash
# 1. credentials
cp .env.example .env        # then fill in INVENIO_API_KEY and INVENIO_BP_UUID

# 2. villa data + photography  (≈462 images, 3 sizes each)
python3 tools/fetch_invenio.py

# 3. editorial crops (hero, destinations, journal, boats)
python3 tools/prepare_images.py

# 4. generate the site
python3 build.py

# 5. serve it with the availability API
node dev-server.mjs
```

Open **<http://127.0.0.1:4173/>**. If that port is busy the server automatically
moves to the next free one and prints the URL. For a static preview without the
availability API:

```bash
python3 -m http.server 4321 --directory dist
```

## The data pipeline

`tools/fetch_invenio.py` calls the Invenio **Data Export API V3.0**:

| Endpoint | Used for |
|---|---|
| `POST /plapi/getdata/api_villa_list` | villa data (public fields only) |
| `POST /plapi/getdata/api_villa_list_lr` | which villas are published (whatever the "API" switch) |
| `POST /plapi/getdata/api_villa_price_full` | seasonal nightly rates for every villa |
| `POST /plapi/getdata/api_villa_availability` | live availability and quotes (server-side only) |

**Which villas are listed:** every villa in the destination that is **licensed** (licence
field of 4+ characters, the portal's rule) and either **published** or **unpublished in the
last 7 days** (`--recent-unpublished-days`, from the long-rental list's `unpublished_date`),
whether its back-office "API" switch is on or off and whether it is DCC. Villa data comes from `api_villa_list`,
which carries only public fields (public alias, approximate GPS, licensed room counts);
the long-rental list is used only for the published flag, because it also holds real
names, exact GPS and owner contacts. IMpulse asks for at most 1–2 full long-rental pulls a
day (~50 MB): reuse a saved copy while developing with `--lr-file path/to/lr.json`.

This needs an API key with access to `api_villa_list_lr`. With a key that has none, the
script falls back to `api_villa_list` alone, which then lists only the villas with the API
switch on.

It writes:

```
data/villas.json    public, normalised records (only the published destination)
data/prices.json    nightly rate rows, keyed by villa
data/meta.json      fetch timestamp, counts, API host
assets/villas/      6 photographs per villa × 3 responsive sizes (WebP)
```

Photography is downloaded to `assets/villas/<slug>/01-{400,800,1400}.webp` and served
locally — no hotlinking to the Invenio CDN, no dependency on their file naming.

### Refresh the collection

**Automatic:** `.github/workflows/refresh-villas.yml` runs every morning at 05:00 UTC
(06:00 Madrid in winter). It reads the published list from the netcup mirror
(`INVENIO_LR_BASE_URL=https://data.invenio.tools`, the ETL's 23:00 pull, so no extra load on
IMpulse), refreshes data, prices and photos, checks the build and pushes only if something
changed; the push deploys. It stops without writing anything if the published list can't be
read or the villa count moves by more than 30 % (`--max-change`), and GitHub emails the
failed run. Run it by hand from the Actions tab ("Run workflow"). Needs the repository
secrets `INVENIO_API_KEY` and `INVENIO_BP_UUID`.

**By hand:**

```bash
python3 tools/fetch_invenio.py            # data + new photography
python3 tools/fetch_invenio.py --no-images
python3 tools/fetch_invenio.py --images 8 # more photos per villa
python3 build.py
```

Existing photographs are skipped, so repeat runs are fast. Descriptions are cleaned of
licence-number boilerplate, audience tags are split from amenities, and GPS strings are
validated (some API records contain impossible coordinates).

### Scope: Ibiza only

The account carries both Ibiza and Mykonos villas. `INVENIO_DESTINATION=Ibiza` in
`.env` publishes only Ibiza. Set it to `Mykonos` (or remove the filter in
`tools/fetch_invenio.py`) to build a Mykonos collection — the templates are
destination-agnostic apart from the region names in `content/destinations.json`.

### Prices and markup

The API returns **net** rates: the Invenio net price (owner + 10 %), or on **DCC**
(`direct_client_contract`) villas the owner's own price. `data/` keeps them as they come.

Every price on the site is the net rate **+ `pricing.markup_percent`** (5 %, in
`content/settings.json`), rounded half up to the euro. **DCC villas are never marked
up**: the client contracts with the owner and sees the owner's price. `build.py` applies
this once when it loads the data, so cards, villa pages, rate tables, filters and
structured data agree, and writes `lib/pricing.mjs` so live quotes
(`lib/availability.mjs`) use the same percentage and the same DCC rule. Change the
percentage in `settings.json` only, then rebuild.

## Editing the site

Everything visible is generated from `content/`:

| File | What it controls |
|---|---|
| `content/settings.json` | brand, contact details, navigation, footer, pricing note |
| `content/home.json` | hero, intro, featured villas, regions, story, experiences, journal, CTA |
| `content/destinations.json` | the five region guides and their highlights |
| `content/journal.json` | three long-form island stories |
| `content/pages/*.json` | about, owners, experiences, boat rental, car hire, concierge, contact, privacy, terms |

The page renderer supports section types `split`, `cards`, `steps`, `quote`, `list`,
`gallery`, `fleet`, `faq`, `prose` and `cta` — see `content/pages/boat-rental.json`.

After any change:

```bash
python3 build.py
```

The build is atomic: it renders into `.build/`, swaps it with `dist/`, and the running
server never serves a half-written page. A full rebuild takes about a second (excluding
photography).

### Search: location and "nearby"

Location is two menus, **Municipality** (the portal's five districts) and **Area** (that
municipality's areas, IMpulse names); picking an area sets its municipality. URL:
`/villas/?district=<district>&area=<area>` (older `?where=` / `?region=` links still work).
When a municipality/area search finds **5 villas or fewer** (after the other filters and
availability), the list is topped up with the **closest villas outside it** by approximate
GPS until **8** are shown, under a note and with a "Nearby · area · km" badge
(`NEARBY_TRIGGER` / `MIN_RESULTS` in `assets/js/site.js`).

**Budget for the stay, from – to** (`pmin` / `pmax`, as on the portal): with dates, the
price of the whole stay; before dates are picked, the cheapest week. Price on request never
matches a budget.

**Instant date search:** no live call. `fetch_invenio.py` saves the confirmed bookings from
the netcup mirror's nightly `api_villa_calendar` (`data/busy.json`; under offer / requested /
cancelled don't block, portal rule); `build.py` writes one fingerprinted file
(`/assets/data/stays.<hash>.json`: per card, booked ranges, nightly client rates, minimum
nights, short-stay rule) that the villa list loads when dates are picked. Free = no booking
overlapping the stay and minimum nights met (unless short stays). The stay price is
estimated from the nightly rates (checked against IMpulse for 3–10 Jul 2027: 201 of 203
free villas found, all prices within 2 %). The villa page still checks live with IMpulse.
If the file can't be loaded, the old live search (~20 s) runs instead.

**Price match guarantee** (`price_match` in `content/settings.json`): band under the home
search, note on the villa list, line in every booking box; "Send us the link" opens the
enquiry form pre-worded (`/contact/?match=1&villa=…`).

**Two villas together** (the portal's villa-groups logic, 2 villas / 5 km): when a search
with bedrooms "from" finds no single villa (in the chosen place), up to 6 pairs are shown —
two villas within 5 km of each other, each too small alone, together covering the bedrooms
(and guests); same other filters; closest first, then fewest spare bedrooms, then cheapest;
a villa in at most 2 pairs; up to 20 % over the maximum budget. Distances come from the
EXACT GPS in the long-rental list, worked out by `fetch_invenio.py` (`near` in
`data/villas.json`, rounded up to 0.5 km); exact positions are never written anywhere.

### Hiding a villa

To take a villa off the site by hand, add it to `hidden_villas` in `content/settings.json`
(its IMpulse uuid, name and why). It stays hidden whatever the daily refresh brings back.
Currently: Can Best (Edo, 2 Nov 2026).

## Live availability

The browser never sees the API key. Two endpoints are provided:

- `POST /api/availability` with `{ "from": "2027-06-05", "to": "2027-06-12" }`
  returns the Ibiza villas available for that range (used by the collection filters).
- `POST /api/availability` with `{ "uuid": "…", "from": "…", "to": "…" }`
  returns the exact price for one villa (used by the villa page).

The serverless versions are included:

- **Vercel** — `api/availability.js` is picked up automatically; add
  `INVENIO_API_KEY` and `INVENIO_BP_UUID` in *Project → Settings → Environment*.
- **Netlify** — `netlify/functions/availability.mjs`, redirected from
  `/api/availability` in `netlify.toml`; add the same variables in
  *Site settings → Environment variables*.

If the API is unreachable — or the site is opened as plain static files — the UI falls
back gracefully: all villas stay visible and the note invites the visitor to send dates
by email or WhatsApp. No errors, no empty page.

Results are cached for ten minutes per date range, and the local server rate-limits
requests per IP. With a full-access key the bulk answer covers every villa the key can see
(~27 MB, ~20 s), so the first search for a date range is slow and later ones are instant;
the function allows 45 s for it (`vercel.json` gives it 60). Only licensed villas are ever
returned, and only id, price, minimum nights and cleaning — never names.

## Deployment

**Netlify**

```bash
netlify deploy --prod
```

`netlify.toml` sets `python3 build.py`, publishes `dist/`, adds long-lived cache headers
for `/assets/*` and the availability redirect.

**Vercel**

The site is deployed at <https://theibizaconnection.vercel.app/> from the GitHub repo
`edoardo-hash/the-ibiza-connection`. Every push to `main` deploys to production;
other branches get preview deployments. A manual deploy from a checkout still works:

```bash
vercel --prod
```

`vercel.json` sets the build command, output directory, trailing slashes and asset
caching. The availability function lives at `api/availability/index.js` — the folder
form matters because `trailingSlash: true` rewrites `/api/availability` to
`/api/availability/`. The project framework must stay **Other** (not Node); otherwise
Vercel tries to treat the dev server as the root entrypoint.

**Any static host**

Upload `dist/` after `python3 build.py`. Set `SITE_URL` to your production origin before
building so canonical URLs, Open Graph tags and `sitemap.xml` are absolute:

```bash
SITE_URL=https://theibizaconnection.net python3 build.py
```

## Structure

```
build.py                 static site generator (≈2,000 lines, no deps)
dev-server.mjs          dev server: static files + availability proxy
lib/availability.mjs     shared Invenio availability logic
api/availability.js      Vercel function
netlify/functions/…      Netlify function
content/                 all editable copy
data/                    API snapshot (villas, prices, meta)
tools/
  fetch_invenio.py       API → data + photography
  prepare_images.py      art-directed hero/destination/journal crops
assets/
  css/site.css           design system and all components
  js/site.js             menu, filters, availability, lightbox, favourites
  fonts/                 self-hosted Cormorant Garamond + Jost (variable)
  img/                   editorial crops
  villas/                462 villa photographs × 3 sizes
dist/                    generated site (git-ignored)
screenshots/             review captures
```

## Design notes

- **Type** — Cormorant Garamond for display, Jost for text, both self-hosted as
  variable WOFF2 with `font-display: swap`.
- **Palette** — bone `#F6F1E7`, ink `#16140F`, clay `#A2623C`, sea `#1D2A26`.
- **Layout** — editorial grid, full-bleed photography, generous white space, thin rules,
  sharp cards and pill buttons. The old site's gold-and-black template is gone; the
  brand name and contact details remain.
- **Motion** — CSS reveal-on-scroll, hero drift, image zooms and a lightbox, all
  respecting `prefers-reduced-motion`.
- **Accessibility** — skip link, one `h1` per page, visible focus states, labelled
  forms, keyboard lightbox and menu, 44 px targets, alt text on every image.

## Photography

- Every villa photograph comes from the Invenio API (the owners' own photography).
- Boat photography comes from the old The Ibiza Connection website, recovered from the
  live archive and re-cropped.
- Editorial crops in `assets/img/` are generated from those originals by
  `tools/prepare_images.py`; nothing is stock or AI-generated.

## Known caveats

- The contact form composes an email (`mailto:`) so the site needs no backend. To use a
  form service instead, post the same fields to your endpoint and show the existing
  success message — the form markup and validation are in `build_contact()` and
  `assets/js/site.js`.
- Live availability needs the API credentials; static hosting without a function will
  show the graceful fallback described above.
- Maps use OpenStreetMap embeds — no Google Maps key, no tracking cookie.
- The old site's "best price guaranteed" claim is carried over; verify it still matches
  your commercial policy.
- Legal pages are a solid, honest starting point but should be reviewed by a Spanish
  lawyer before launch.
- `dist/` is ~136 MB, almost entirely photography. If your host charges for bandwidth,
  trim `assets/villas/` (three sizes per photo) or reduce `--images`.

## Licence

Site code © The Ibiza Connection. Photography © the villa owners / The Ibiza
Connection. Do not reuse the photography outside this website without permission.

## Licence check (official register)

Every refresh (`tools/fetch_invenio.py`, so daily and for every newly published villa)
checks each villa's tourist licence against the Consell d'Eivissa register stored in
`data/register/habitatges-turistics.csv`. The 4 digits are the licence: `ETV1276E` is
correct when 1276 is in the register.

| Status | Meaning | On the site |
|---|---|---|
| `verified` | number in the register, written the same way | listed |
| `format_differs` | number correct, prefix/suffix differ from the register (flagged — fix in IMpulse) | listed, with the register's spelling |
| `other_register` | AG (agroturismo) or HAC licence, not in this list (flagged) | listed |
| `not_in_register` / `no_number` | the 4 digits aren't in the register / can't be read | hidden until a HAM confirms |

Results are stored in `data/licence-check.json` (`python3 tools/licence_check.py --report`
prints them). To put a hidden villa back, add its IMpulse uuid to
`content/settings.json → licence_confirmed`; `licence_policy: "flag"` lists failures anyway.
Refresh the register with a new download from the Consell:
`python3 tools/licence_check.py --import ~/Downloads/List-habitatges-turistics_-DDMMYYYY.xls`.

Bedrooms, bathrooms and guests are the licensed numbers (the rooms that can legally be rented),
for display and search; the real counts from IMpulse are kept as `real_bedrooms`/`real_bathrooms`. The licence is shown on every villa card and villa page.

## The area (what's nearby)

Villa pages show distances to the airport and Ibiza Town, the nearest beach, village and
supermarket, and the three nearest restaurants and places worth seeing — the same data as the
Invenio portal. `data/area/area-road.json` (road km, OSRM) and `area-info.json` come from the
portal repo (`src/data/`); villas missing there are computed in a straight line from their exact
GPS by `fetch_invenio.py` into `area-computed.json`. Only names and kilometres are stored.

## AI concierge

A chat button on every page ("Ask our concierge") answers visitors with Claude, using only what
the site shows: `build.py` writes `lib/chat-data.json` (client prices, booked dates, rooms,
licences, what's nearby — no net prices, owners or positions). `lib/chat.mjs` gives Claude two
tools (`search_villas`, `villa_details`) so availability and prices are computed, not guessed.
It never books or promises anything: bookings, payments, discounts, events and complaints go to
WhatsApp, email or the contact form.

Set `ANTHROPIC_API_KEY` in Vercel (Production) to switch it on; without it the button stays
hidden. `CHAT_MODEL` overrides the model (default `claude-sonnet-4-5`). 30 messages per visitor
per 10 minutes.

## Dated searches: confirmed live

With dates, the villa list first narrows on the calendar file (confirmed bookings, minimum nights
and the strict changeover day — e.g. "Strictly Saturday-Saturday" villas only match Saturday to
Saturday, as on the portal, except last-minute stays and stays of twice the minimum). Every villa
then SHOWN is confirmed live with IMpulse (the villa page's single quote, 6 at a time, one retry):
a villa that isn't available drops out, the others show the confirmed price for the stay. Bedroom
searches and the "two villas within 5 km" pairs use the licensed (legal) bedrooms. Pairs are offered,
as on the portal, when no single villa fits, when fewer than 3 do, or for 10+ bedrooms or 20+ guests.
With dates, cards show the price for the stay instead of the weekly "from" price. When the dates
aren't Saturday to Saturday and fewer than 8 villas match, a "Villas available Saturday to
Saturday" section (smaller thumbnails, up to 8) offers villas free for the closest Saturdays, with
the same filters, each confirmed live; one click searches those dates.
