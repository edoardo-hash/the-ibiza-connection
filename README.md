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

**Which villas are listed:** every villa in the destination that is **published** and
**licensed** (licence field of 4+ characters, the portal's rule), whether its back-office
"API" switch is on or off and whether it is DCC. Villa data comes from `api_villa_list`,
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
