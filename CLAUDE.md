# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Rebuild in progress — read this first

The application described below is **v1, which is being replaced**. Its data froze in January 2023 because the ingest URL went dead and the failure was logged rather than enforced. See `docs/05-v1-audit-findings.md` for the eleven findings and `docs/40-mvp-plan.md` for the target architecture and task list.

**Planning documents live in `docs/`.** Requirements are `docs/12-PRD-v1.0.md` (FR-xxx IDs); the active plan is `docs/40-mvp-plan.md`; decisions and their reversal conditions are `docs/14-decision-log.md`. Every task carries a requirement ID — keep that trace intact in commit messages.

### Invariants for the rebuild

These encode audit findings. Breaking one silently reproduces a v1 failure.

1. **Ingest never writes `lat`/`lng`.** Coordinates come only from `geocode.js` via the `geocode_cache` table, joined on normalized address. v1 lost every accumulated coordinate on each import because `INSERT OR REPLACE` deletes and reinserts rows (AUD F4). **Since SE-101 this is enforced by the database**, not by convention: triggers `IFC-1a` (a position must match a `geocode_cache` row for that normalized address), `IFC-1b` (a set coordinate may never be nulled) and `IFC-1c` (no statement writes both identity and position columns) abort the write. See `migrations/005_ifc1_boundary.sql`.
2. **Never use `INSERT OR REPLACE`.** Use `INSERT ... ON CONFLICT DO UPDATE` with an explicit column list.
3. **Schema changes are numbered migrations, never inline DDL.** Add a file to `migrations/` as `NNN_lower_snake_case.sql` and run `npm run migrate` (`npm run migrate:status` to inspect). An applied migration is history: its checksum is recorded and editing it makes the runner refuse to start. `src/db.js` no longer carries a `SCHEMA` constant.
4. **Ingest aborts; it does not warn.** A non-`text/csv` content type, a payload starting with `<!DOCTYPE`, or a post-filter row count below 3,000 must throw and exit non-zero, leaving prior data and its as-of date untouched. This is AUD F1/F2, the defining v1 failure.
5. **No external calls at request time.** No Google Places, no Puppeteer, no scraping. A request touches SQLite only.
6. **Unknown inspection dispositions fail the build.** Do not default them to a passing signal. The complete mapping is in `docs/40-mvp-plan.md` §5.

### Authoritative data sources

Verified 21 Aug 2026, HTTP 200 `text/csv`. Palm Beach County is **District 2, county code 60** (District 2 = Broward, Martin, Palm Beach):

- Inspections: `https://www2.myfloridalicense.com/sto/file_download/extracts/2fdinspi.csv`
- Active licenses: `https://www2.myfloridalicense.com/sto/file_download/extracts/hrfood2.csv`

Do **not** use `www.myfloridalicense.com/dbpr/hr/inspections/...` — that host serves a WordPress page which v1 saved as `.csv`.

### Working practice

Use plan mode for anything touching ingest or scoring. Run `/code-review` before committing. Write the test that fails on HTML input before writing the ingest.

---

## What this is *(v1 — being replaced)*

Safe Eats USA is a Node/Express restaurant discovery app that overlays Google Maps place search with Florida health-inspection data. Users search for restaurants; the backend cross-references each Google Places result against a local SQLite database of Florida health inspection records and returns a color-coded health status (Satisfactory/Warning/Fail/Unknown) alongside the map data.

## Commands

- `npm install` — install dependencies
- `npm start` — run the server (`node server.js`, defaults to port 3000, override with `PORT`)
- `npm run download-data` — fetch the latest Florida DBPR statewide inspection CSVs into `data/` (`scripts/download-fl-data.js`)
- `npm run import-db` — parse all CSVs in `data/` and upsert them into the `restaurants` table of `pbp_restaurants.db` (`scripts/import-to-db.js`)
- `npm run build-db` — headless-crawl Palm Beach Post's per-county inspection pages with Puppeteer and rebuild `pbp_restaurants.db` from scratch (`scripts/build-pbp-database.js`); this is also triggered live via `POST /admin/rebuild-db`
- No lint command is configured. `npm test` is a placeholder (no tests exist).
- Other one-off scripts in `scripts/` are run directly with `node scripts/<name>.js` (not wired into package.json): `init-fdacs-db.js` (creates the `food_entities` table), `migrate-db.js` (adds missing columns to `restaurants`), `bulk-geocode.js`, `download-licenses.js`, `crawl-portal.js`, and various `check-*`/`debug-*`/`inspect-data.js`/`test-*.js` helpers for inspecting DB state.

## Architecture

**Data sources → adapters → SQLite → server → frontend**

- `pbp_restaurants.db` (at repo root) is the single SQLite datastore, holding two tables:
  - `restaurants` — Florida DBPR (Division of Business & Professional Regulation) inspection records for restaurants, keyed by license/permit id, with `county`/`name`/`address`/`status`/`last_inspection_date`/`latitude`/`longitude`. Populated either from CSVs in `data/` via `import-to-db.js`, or scraped from the Palm Beach Post inspection portal via `build-pbp-database.js`. Schema has grown incrementally — `migrate-db.js` and inline `ALTER TABLE` calls in `build-pbp-database.js`/`import-to-db.js` patch older DB files to add newer columns.
  - `food_entities` — FDACS (Dept. of Agriculture & Consumer Services) records for grocery/convenience stores, created by `init-fdacs-db.js` and populated live by the `florida-fdacs` adapter as a fallback data source.
- `adapters/` wraps each external data source behind a `getFullRecord`/`searchPlaces` style interface consumed by `server.js`:
  - `google-maps.js` — Google Places API (New) for place search/details; requires `GOOGLE_MAPS_API_KEY`. Also parses `addressComponents` to derive city/state/county, which is critical because the DBPR/FDACS lookups key on county/city.
  - `florida-dbpr.js` — looks up a business first in the local `restaurants` table (Fuse.js fuzzy match on name/address/county), and if missing falls back to live-scraping the Palm Beach Post site (regex-parsed HTML, no headless browser).
  - `florida-fdacs.js` — same local-first/live-fallback pattern but for `food_entities`, using Puppeteer to drive the FDACS ASP.NET search/detail pages (since that site needs JS/postback interaction); any live-scraped result is saved back into `food_entities` so future lookups hit the local DB.
  - `yelp.js` — optional Yelp Fusion reviews/search, gated on `YELP_API_KEY`; not wired into any `server.js` route currently.
- `server.js` ties it together:
  - `GET /map` — proxies Google Places search/details, and for search results additionally does an inline SQLite lookup against `restaurants` (exact match, then fuzzy `LIKE` fallback) to attach `healthStatus`/`lastInspectionDate` pins without a full adapter round-trip.
  - `GET /health` — full lookup for a single business: tries `florida-dbpr` first, falls back to `florida-fdacs` if not found (covers restaurants vs. grocery/convenience stores).
  - `GET /api/database/search` and `GET /api/database/all` — search/list directly across `restaurants` UNION `food_entities` for the local database browser UI.
  - `POST /api/database/update-location` — persists geocoded lat/lng back into whichever table (`restaurants` or `food_entities`) a record came from.
  - `POST /admin/rebuild-db` — spawns `scripts/build-pbp-database.js` as a child process to re-crawl and rebuild the DB in the background.
- `public/` is static vanilla-JS/HTML frontend served by Express: `index.html` (main map/search UI), `all-restaurants.html`/`restaurant-list.html` (database browser views backed by the `/api/database/*` routes).
- `inspect.csv` at the repo root appears to be a working/scratch export, not part of the load pipeline (`data/` is the directory scripts actually read from).

## Environment

A `.env` file is required at the repo root (loaded via `dotenv` in `server.js`). Variable names referenced in code:
- `PORT` — server port (optional, defaults to 3000)
- `GOOGLE_MAPS_API_KEY` — required for `/map`, `/health`, and the `/config` endpoint that exposes it to the frontend
- `YELP_API_KEY` — optional, only used by the unused `adapters/yelp.js`

Do not read or print the contents of `.env`.
