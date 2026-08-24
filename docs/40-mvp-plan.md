# MVP Plan — Safe Eats v2

| Field | Value |
|---|---|
| Document ID | MVP-SE-001 |
| Version | 1.0 |
| Date | 21 August 2026 |
| Owner | Developer / TPM (same person) |
| Supersedes | EXP-SE-001 §7 (the 12-vs-15-week decision) |
| Traces from | PRD-SE-100, AUD-SE-001 |
| Status | Active |

---

## 1. Why this document exists

The execution plan asked for a decision between three options: cut Should-tier scope, extend to 15 weeks, or raise weekly hours. All three assume the full 150-hour v1.0 scope and a 12 hrs/week commitment.

**None of them is chosen.** The constraint is a solo developer who does not want to spend much time and wants a working product. That is a different project, and it needs a fourth option: cut to roughly **40 hours over 4 weeks**, delivered in two stages.

This is a harder cut than Option A. It is defensible because the audit changed what the work actually is — see §2.

The v1.0 documents are not discarded. `12-PRD-v1.0.md` remains the requirements contract; this plan selects a subset of it and records what was deferred. Requirement IDs are preserved throughout so the trace back to the PRD stays intact.

---

## 2. Three findings that shrank the project

The 150-hour estimate was produced before the v1 audit. Three discoveries removed large blocks of it:

**The state publishes the data directly.** Verified live: `www2.myfloridalicense.com/sto/file_download/extracts/`. Two HTTP GETs replace the Palm Beach Post crawler, the FDACS Puppeteer adapter, and both live-fallback scraping paths. Puppeteer leaves the project entirely.

**The geocoding universe is 3,898 addresses.** Not an unknown — measured from the live license extract, all with ZIP+4. This was the backlog's highest-risk story (SE-002) and the head of a five-story serial chain. It is now a batch job against a free government geocoder.

**Google Places is not needed for discovery.** Once authoritative establishments carry their own coordinates, pins come from local data. This removes the runtime matching that caused every accuracy complaint (AUD F5), the N+1 queries that caused the slowness (AUD F6), and the API bill — all at once. Places becomes optional enrichment, deferred.

The MVP is smaller than v1.0 in scope but **more accurate**, because it stops guessing which Google result corresponds to which inspection record.

---

## 3. Scope

### In

| Capability | Requirements |
|---|---|
| Weekly ingest of DBPR District 2 inspections + active licenses, filtered to Palm Beach (county 60) | FR-101, FR-102, FR-104 |
| Hard abort on HTML payload, wrong content type, or zero post-filter rows | FR-106, FR-107 |
| Idempotent load that never nulls coordinates | FR-108 |
| Run log: source, timestamp, status, row counts | FR-109 |
| One-time + incremental batch geocoding with persisted cache | FR-201, FR-203, FR-205 |
| Explicit disposition → safety signal mapping | FR-301 |
| Map with colour-coded pins, bounding-box query | FR-401, FR-403, FR-404 |
| Establishment detail: recent inspections, violation counts | E5 subset |
| Data-as-of date, disclaimer, DBPR attribution, methodology page | FR-503, FR-601 |
| Deploy + weekly scheduled refresh | E7 subset |

### Out — deferred, not cancelled

| Deferred | Rationale |
|---|---|
| Google Places enrichment (photos, ratings, hours) | Not required for the safety decision; reintroduces cost and matching risk |
| Counties beyond Palm Beach | Ingest is district-wide already; expansion is a config change once accuracy is proven |
| FDACS grocery data | Different agency and schema (charter §4.2) |
| History backfill to FY2016 | Current + prior fiscal year is sufficient signal |
| Manual review queue (FR-208) | Needs volume before it earns its build cost |
| Row-count anomaly detection (FR-110) | Replaced by a simpler absolute floor — see §5 |
| Emergency closure and disciplinary extracts | Additive; not on the critical path |
| User accounts, alerts, public API, monetization | Charter §4.2 |

Deferrals are logged in `14-decision-log.md` with the conditions that would reverse them.

---

## 4. Architecture

```
  DBPR extracts                  build time                    runtime
  ─────────────                  ──────────                    ───────
  hrfood2.csv    ─┐
  (licenses)      ├─► ingest.js ─► SQLite ─► geocode.js ─► Express ─► Leaflet map
  2fdinspi.csv   ─┘   validate     safe-eats.db  Census      2 routes    + detail panel
  (inspections)       + filter                   batch
```

**Runtime has no external dependency.** No Google Places call, no Puppeteer, no scraping. A request touches SQLite and nothing else — which is the whole reason it will be fast.

**Stack:** Node + Express + SQLite, unchanged from v1. This is deliberate: a rewrite to Postgres or Next.js would add hours and buy nothing at 4,000 rows. Leaflet replaces the Google Maps JS API so the MVP has no key requirement and no billing surface.

### Data model

```sql
establishment          -- one row per licensed establishment
  license_id      TEXT PRIMARY KEY   -- "License ID", the stable key
  license_number  TEXT
  name            TEXT
  address, city, zip, county_code
  seats           INTEGER
  risk_level      TEXT
  lat, lng        REAL               -- NEVER written by ingest; geocoder only
  geocode_source  TEXT
  geocode_quality TEXT

inspection             -- one row per inspection visit
  inspection_number TEXT PRIMARY KEY
  license_id        TEXT REFERENCES establishment
  inspection_date   TEXT             -- ISO, normalized from MM/DD/YYYY
  disposition       TEXT             -- verbatim from source
  signal            TEXT             -- derived; see §5
  crit_violations, high_violations, intermediate_violations, basic_violations INTEGER

violation              -- unpivoted from the 58 wide columns
  inspection_number TEXT
  violation_code    TEXT
  count             INTEGER

geocode_cache          -- survives every ingest; this is how F4 stays fixed
  normalized_address TEXT PRIMARY KEY
  lat, lng, quality, source, resolved_at

ingest_run             -- FR-109
  id, source_url, started_at, finished_at, status,
  rows_fetched, rows_after_filter, rows_written, failure_reason
```

Two invariants carry the audit findings into the schema:

1. **`ingest.js` never writes `lat`/`lng`.** Coordinates arrive only from `geocode.js`, joined through `geocode_cache` on normalized address. This makes AUD F4 structurally impossible rather than merely fixed.
2. **Upsert is `INSERT ... ON CONFLICT DO UPDATE` with an explicit column list.** Never `INSERT OR REPLACE`.

---

## 5. Safety signal

Every disposition observed in the live extract is mapped explicitly. Unrecognised values fail the build rather than defaulting — an unmapped disposition is a data change worth knowing about (FR-301).

| Signal | Dispositions |
|---|---|
| 🟢 **Pass** | Inspection Completed - No Further Action · Call Back - Complied · Emergency Order Callback Complied |
| 🟡 **Warning** | Warning Issued · Insp. Completed - Warning Given, Pending · Call Back - Extension given, pending · Emergency Order Callback Time Extension |
| 🔴 **Serious** | Administrative complaint recommended · Call Back - Admin. complaint recommended · Emergency order recommended · Emergency Order Callback Not Complied |
| ⚪ **No recent inspection** | Assigned to Inspector · no inspection within 24 months |

An establishment's displayed signal is that of its **most recent inspection**. Pins use colour *and* shape, so the signal survives colour-blindness and greyscale (FR-404).

**Ingest guard replacing FR-110:** abort if post-filter Palm Beach establishment rows fall below 3,000. Measured baseline is 4,305; a legitimate drop below 3,000 does not happen, and this is one line instead of a trailing-average model.

---

## 6. Timeline

Two stages. Stage 1 exists so the thesis is proven before any UI work is committed.

### Stage 1 — Proof spike · ~10 hours · Week 1

Ends with pins on a map from real, current data. If this works, nothing else in the plan is speculative.

| # | Task | Hrs | Traces |
|---|---|---|---|
| 1 | Repo reset: delete Puppeteer/scraper/FDACS/Yelp code and the 12 debug scripts; untrack the `.db` and `inspect.csv`; fix `.gitignore` | 2 | AUD F7, F8, F10 |
| 2 | `ingest.js` — fetch both District 2 extracts, validate content type + HTML guard, filter to county 60, load `establishment` and `inspection` | 4 | FR-101/102/104/106/107 |
| 3 | `geocode.js` — Census batch geocoder over 3,898 distinct addresses, persist to `geocode_cache` | 3 | FR-201/203/205 |
| 4 | Throwaway Leaflet page rendering every geocoded point | 1 | — |

**Gate 1 — proceed only if:** ≥95% of establishments geocoded, ingest run is idempotent on a second run, and a hand-checked sample of 20 pins sits on the correct building.

### Stage 2 — Shippable MVP · ~28 hours · Weeks 2–4

| # | Task | Hrs | Traces |
|---|---|---|---|
| 5 | Unpivot the 58 violation columns into `violation` | 2 | FR-105 |
| 6 | Signal mapping + fail-on-unknown-disposition test | 2 | FR-301 |
| 7 | `GET /api/establishments?bbox=` — bounding-box query, indexed | 3 | FR-401 |
| 8 | `GET /api/establishments/:licenseId` — detail + inspection history | 2 | E5 |
| 9 | Map UI: clustered pins, colour + shape, search-this-area | 8 | FR-403/404 |
| 10 | Detail panel: signal, date, violation breakdown, DBPR link | 4 | E5 |
| 11 | Trust surface: data-as-of date, disclaimer, attribution, methodology page | 2 | FR-503, FR-601 |
| 12 | Deploy + weekly scheduled ingest + failure alert | 3 | E7 |
| 13 | Reserve | 2 | — |

**Gate 2 — ship when:** 20-pin accuracy sample passes, no runtime external calls, ingest failure leaves prior data and its as-of date untouched, and the disclaimer is visible without scrolling on mobile.

### Summary

| | Hours | Elapsed at 10–12 hrs/week |
|---|---|---|
| Stage 1 | 10 | Week 1 |
| Stage 2 | 28 | Weeks 2–4 |
| **Total** | **38** | **4 weeks** |

Against the original 150 hours over 12–15 weeks. The reduction is roughly 60% architecture (§2) and 40% deferred scope (§3).

---

## 7. Wearing both hats

The PM discipline that is worth keeping at this size, and what is not:

**Kept** — requirement IDs on every task, so the trace from charter to commit survives · gates with numeric criteria, because "is it accurate enough" needs an answer decided in advance · a decision log, because the reasoning behind a deferral is what you lose first · actual-hours tracking, because 38 is an estimate and Stage 1 will tell you how good it was.

**Dropped** — the dependency register, interface contracts, and status/governance documents referenced by the v1.0 set. Those coordinate work across people. There is one person. Writing them would be ceremony, and the decision to drop them is itself logged (DEC-004).

**The one metric to track:** hours actually spent per task versus the estimate above. After Stage 1 you will have four real data points, and Stage 2's forecast should be rebuilt from them rather than defended.

---

## 8. Claude Code operating model

Replacing the Gemini CLI workflow:

- **`CLAUDE.md`** carries the architecture and the invariants from §4 — particularly *ingest never writes coordinates*, which is the rule most likely to be broken by a plausible-looking edit.
- **Brief from the story, not the vibe.** Each task above has a requirement ID and acceptance criteria. Paste those. The v1.0 backlog's Definition of Ready exists precisely because an unbriefed request invites invented interfaces.
- **`/code-review`** before each commit; **`/security-review`** once before deploy, given the `.env` handling that v1 got wrong.
- **Plan mode** for anything touching the ingest or scoring paths — the two places where a silent error reproduces v1's core failure.
- **A test that fails on HTML input** is the single highest-value test in the project. Write it before the ingest code.

---

## 9. Open items

| Item | Needs |
|---|---|
| Hosting target | Render was used for v1; a static-friendly host now works since there is no Puppeteer. Decide at Task 12. |
| Geocode fallback | Census handles ZIP+4 US addresses well. If Stage 1 coverage lands under 95%, add a paid fallback for the remainder (~$5). Decide at Gate 1. |
| Domain name | Not required to ship. |
