# Safe Eats

Florida health-inspection results for licensed food service establishments in
Palm Beach County, on a map. The data comes from the state's own published
extracts, and the product shows only what those records support.

**Status:** v2 rebuild, Stage 2. Tasks 7–11 of `docs/40-mvp-plan.md` are done;
task 12 (deploy and scheduled refresh) is not. Not yet released — the accuracy
gate has not been verified. See [Where it stands](#where-it-stands).

```bash
npm install
npm run migrate     # apply migrations to safe-eats.db
npm run ingest      # fetch and load the two DBPR extracts
npm run geocode     # resolve addresses via the Census geocoder
npm start           # http://localhost:3000
```

---

## Why this exists twice

Version 1 of this project froze in January 2023 and nobody noticed for three
years. Its download URL went dead and started returning a WordPress page; the
code detected that, called `console.warn`, and saved the HTML as `.csv` anyway.
The import step then skipped the unparseable file and exited zero. The pipeline
reported success every run while serving data from 2022.

That is finding F1 in `docs/05-v1-audit-findings.md`, and it is the reason the
rebuild is shaped the way it is. **The failure was not that the URL died — URLs
die. The failure was that a broken run was indistinguishable from a working
one.** Most of what looks like over-engineering below is that lesson.

Ten other findings came out of the same audit: coordinates destroyed on every
import by `INSERT OR REPLACE`, restaurant names matched to Google Places results
at request time, an N+1 query fan-out per viewport. The v2 architecture removes
the conditions for each rather than fixing them in place.

---

## Invariants

These are not style preferences. Each one encodes a specific v1 failure, and
breaking one silently reproduces it. The full statement is in `CLAUDE.md`.

1. **Ingest never writes `lat`/`lng`.** Coordinates come only from `geocode.js`,
   through `geocode_cache`, joined on normalised address. Since migration 005
   this is enforced by database triggers (`IFC-1a/b/c`), not by convention.
2. **Never `INSERT OR REPLACE`.** It deletes and reinserts the row, taking every
   accumulated coordinate with it. Use `ON CONFLICT DO UPDATE` with an explicit
   column list.
3. **Schema changes are numbered migrations**, never inline DDL. An applied
   migration is history: its checksum is recorded and editing it stops the runner.
4. **Ingest aborts; it does not warn.** Wrong content type, an HTML payload, or
   too few rows must throw and exit non-zero, leaving the previous data and its
   as-of date untouched.
5. **No external calls at request time.** A request touches SQLite and nothing
   else. No Places, no geocoder, no scraping.
6. **An unknown inspection disposition fails the build.** It is never defaulted
   to a passing signal.

There is a corollary the basemap taught us the hard way (DEC-013): **a check
that cannot fail on the actual failure mode is not a check.** CARTO began
serving tiles watermarked "API KEY REQUIRED" — HTTP 200, valid PNG, correct
geometry, right size. Everything except the pixels was fine.

---

## Data sources

Published by the Florida Department of Business & Professional Regulation.
District 2 covers Broward, Martin and Palm Beach; we keep county code 60.

| Source | URL |
|---|---|
| Inspections | `https://www2.myfloridalicense.com/sto/file_download/extracts/2fdinspi.csv` |
| Active licences | `https://www2.myfloridalicense.com/sto/file_download/extracts/hrfood2.csv` |

Do **not** use `www.myfloridalicense.com/dbpr/hr/inspections/…`. That host
serves a WordPress page, and saving it as `.csv` is exactly what v1 did.

`npm run verify:sources` probes every documented source and diffs its column
header against the pinned layout in `docs/source-layouts.json`. This is the
check that would have caught the v1 failure three years early.

### The inspection window

The inspection extract is **fiscal-year-to-date and accumulating** — it starts
on 1 July and grows, rather than sliding. This was established by observation,
not assumption: `npm run probe:window` re-fetches the extract and compares it
against what is loaded, and DEC-010 records the two readings that settled it.

The practical consequence is that most establishments have no published
inspection yet, and the map says so in grey. That is a true statement about the
state's records, not a poor result, and the UI is written to make sure nobody
reads it as one.

---

## Architecture

```
  DBPR extracts                build time                      runtime
  ─────────────                ──────────                      ───────
  hrfood2.csv   ─┐
  (licences)     ├─► ingest.js ─► SQLite ─► geocode.js ─► Express ─► Leaflet map
  2fdinspi.csv  ─┘   validate     safe-eats.db   Census      3 routes   + detail panel
  (inspections)      + filter                    + paid
                                                  fallback
```

| Path | Purpose |
|---|---|
| `src/ingest.js` | Fetch, validate, filter to county 60, load establishments and inspections |
| `src/validate.js` | The abort gate — content type, HTML payload, size and row floors |
| `src/signal.js` | Disposition → safety signal. Throws on anything unmapped |
| `src/geocode.js` | Census geocoder, then an optional paid fallback for what it misses |
| `src/display.js` | The displayed population, shared by the API and the accuracy gate |
| `src/server.js` | Three read routes; touches SQLite only |
| `src/migrate.js` | Numbered migration runner with checksums |
| `migrations/` | `001`–`005`, including the IFC-1 trigger boundary |

### API

| Route | Returns |
|---|---|
| `GET /api/establishments?bbox=w,s,e,n` | Pins in the viewport, via the R\*Tree index |
| `GET /api/establishments/:id` | One establishment, its visit history and violation tiers |
| `GET /api/meta` | As-of date, signal palette, disposition map, live coverage |

The signal palette and disposition mapping are *served*, not duplicated in the
client, so `src/signal.js` stays their single definition and the methodology
page cannot drift from the code.

---

## Commands

| Command | Does |
|---|---|
| `npm start` | Run the server (`PORT`, default 3000) |
| `npm run migrate` / `migrate:status` | Apply / inspect migrations |
| `npm run ingest` | Fetch and load both extracts. Aborts rather than degrading |
| `npm run geocode` | Tier 1, the free Census geocoder |
| `node src/geocode.js --fallback` | Tier 2, paid. Costs money. Needs `GOOGLE_MAPS_API_KEY` |
| `npm run probe:window` | Re-check the inspection window without writing anything |
| `npm run verify:sources` | Probe every source and diff its header against the pinned layout |
| `npm test` | 176 tests, `node --test` |
| `npm run scan:secrets` / `guard:sql` | Commit gates, also installed as pre-commit hooks |

### Environment

A `.env` at the repo root, gitignored. Nothing is required to run the app.

- `PORT` — server port, default 3000
- `GOOGLE_MAPS_API_KEY` — **only** for the tier-2 paid geocoder, a build-time
  batch job. It never reaches the browser. v1 served its key to the frontend
  from a `/config` endpoint, where anyone loading the page could read it.
- `SAFE_EATS_DB`, `SAFE_EATS_DISTRICT`, `SAFE_EATS_COUNTY_CODE` — overrides

---

## Where it stands

Measured against the loaded data, as of the last successful ingest
(21 August 2026):

| | |
|---|---|
| Licensed establishments loaded | 4,305 |
| Displayed (permanent food service, county 60) | 3,659 |
| With a verified coordinate | 3,618 — **98.9%** |
| With at least one published inspection | 943 — **25.8%** |
| Inspections / violation rows | 1,305 / 4,533 |
| Bounding-box query, whole county | 3,530 pins, p95 20 ms |

**Gate 1 (≥95% geocoded): passed.**
**Gate 2 (accuracy): not started.** A seeded 100-row sample is drawn in
`docs/07-accuracy-sample.csv` and awaits hand verification against aerial
imagery; at least 99 must fall within 50 m. The sample may not be redrawn to
obtain a better result. **The product does not launch until this passes.**

The 41 establishments without coordinates are suite-level addresses inside
plazas and office parks. Every one has already been through the paid geocoder
and was rejected as too coarse — a centroid pin looks as authoritative as a
rooftop pin, so they are left off rather than placed at a guess.

---

## Documentation

Start with `docs/40-mvp-plan.md`, the active plan. `docs/14-decision-log.md` is
the living record — every decision carries the condition that would reverse it,
because the reasoning behind a choice is the first thing lost. `docs/05-v1-audit-findings.md`
is what went wrong the first time.

Requirement IDs (`FR-xxx`) are stable across every document and appear in commit
messages, so the trace from charter to commit survives.

---

## Conventions

Use plan mode for anything touching ingest or scoring. Run `/code-review` before
committing. Write the test that fails on HTML input before writing the ingest.

---

Data published by the Florida Department of Business & Professional Regulation.
Basemap © Esri, HERE, Garmin, USGS, Intermap and © OpenStreetMap contributors.

Safe Eats is an independent project. It is not affiliated with, operated by, or
endorsed by the State of Florida or DBPR.
