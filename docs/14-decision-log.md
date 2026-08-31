# Decision Log — Safe Eats v2

| Field | Value |
|---|---|
| Document ID | DEC-SE-001 |
| Version | 1.0 |
| Date | 21 August 2026 |
| Owner | Developer / TPM |
| Status | Living — append only |

Decisions are appended, never edited. A reversal is a new entry that supersedes an old one, so the reasoning at the time is preserved. Each entry records what would make it wrong, because a decision without a reversal condition is a belief.

---

## DEC-001 — Take the authoritative DBPR extracts; delete all scraping

**Date:** 21 Aug 2026 · **Status:** Accepted · **Traces:** AUD F1, F7, F8 · FR-101, FR-102

**Context.** v1 scraped the Palm Beach Post with Puppeteer across 67 counties and used a second scraping path as a live fallback. The original DBPR download URL had gone dead, which is why the data froze in January 2023.

**Decision.** Ingest `https://www2.myfloridalicense.com/sto/file_download/extracts/2fdinspi.csv` and `hrfood2.csv` directly. Delete `build-pbp-database.js`, `crawl-portal.js`, `adapters/florida-dbpr.js`, `adapters/florida-fdacs.js`, and the Puppeteer dependency.

**Why.** Verified live on 21 Aug 2026: both return HTTP 200 `text/csv` with current data through 20 Aug 2026. The state source is first-party, has no markup to break, carries no terms-of-service exposure, and is a plain HTTP GET rather than a headless browser.

**Reversal condition.** DBPR discontinues the extracts or moves them again without a discoverable successor. Mitigation: the ingest archives raw bytes per run, so a source change is detected at fetch time rather than in production.

---

## DEC-002 — Drop Google Places from the runtime path

**Date:** 21 Aug 2026 · **Status:** Accepted · **Traces:** AUD F3, F5, F6

**Context.** v1 fetched pins from Google Places and then string-matched each result against the inspection database at request time, because only 1.6% of its own records had coordinates. This matching is the direct cause of both the accuracy and the speed complaints.

**Decision.** Geocode the 3,898 known Palm Beach establishment addresses once, serve pins from local data, and remove Google Places from the request path entirely. Use Leaflet rather than the Google Maps JS API.

**Why.** Matching arbitrary Places results to licence records is a hard problem that only existed to work around missing coordinates. Geocoding a known list is the easy problem underneath it. Removing the dependency eliminates the API bill, the per-request latency, and the false-match class of bug together. The product shows licensed food establishments — which is what it is *for* — rather than everything Google knows about.

**Cost.** No photos, ratings, hours, or "search by brand name across the web." Judged not required for a safety decision.

**Reversal condition.** User feedback shows the map is unusable without photos or ratings. Places would return as a detail-panel enrichment keyed on the establishment's own coordinates — never as a discovery dependency, and never as a matching step.

---

## DEC-003 — Cut to a 38-hour MVP; reject Options A, B, and C

**Date:** 21 Aug 2026 · **Status:** Accepted · **Supersedes:** EXP-SE-001 §7 · **Amends:** Charter C2

**Context.** The execution plan found 150 hours of work against 144 hours of capacity — 104% loaded, zero reserve — and required a choice between cutting Should-tier scope (A), extending to 15 weeks (B), or raising to 15 hrs/week (C). The TPM recommendation was B.

**Decision.** None of the three. Cut to ~38 hours across two stages over 4 weeks, per `40-mvp-plan.md`.

**Why.** All three options presume the 150-hour scope, which was estimated before the v1 audit existed. The audit removed the scraping subsystem, resolved the geocoding unknown, and eliminated the runtime matching layer — roughly 60% of the reduction is architecture, not descoping. The remaining 40% is deferred scope listed in MVP §3.

The stated constraint is a solo developer who does not want to spend much time. Option B commits fifteen weeks of sustained solo effort, and the plan's own risk SR-2 says a single absence stops everything. A four-week MVP that ships is worth more than a fifteen-week plan that stalls in week seven.

**Why not Option A specifically.** A cuts FR-110 and FR-208, the two requirements written to defend against known v1 failures — the plan says so itself. This decision keeps that defence: FR-110 is replaced by a simpler absolute row-count floor (MVP §5) rather than removed.

**Reversal condition.** Stage 1 actuals exceed 15 hours against the 10-hour estimate. That would mean the architecture savings were overstated, and Stage 2 must be re-forecast from measured velocity before continuing.

---

## DEC-004 — Do not write the dependency register, interface contracts, or status documents

**Date:** 21 Aug 2026 · **Status:** Accepted · **Traces:** EXP-SE-001 §8

**Context.** The v1.0 document set references `21-dependency-register.md`, `23-interface-contracts.md`, and `24-status-and-governance.md`. None was ever written. The weekly execution mechanics depend on all three.

**Decision.** Do not write them. Record the gap here instead.

**Why.** Each coordinates work across a boundary between people: a dependency register tracks who you are waiting on, interface contracts stop two workstreams inventing incompatible shapes, and a status report informs a sponsor. There is one person, no workstream boundary, and no sponsor. Writing them would be documentation as performance.

**What replaces them.** The single external dependency (DBPR extract availability) is covered by the ingest's own fetch-time validation and run log — a live check beats a document. Interface shapes live in `CLAUDE.md` as invariants, where Claude Code will actually read them. Status is the actual-hours-per-task figure in MVP §7.

**Reversal condition.** A second person joins, or the project takes on an external dependency with a human owner. Interface contracts become necessary the moment two people write against the same boundary.

---

## DEC-005 — Keep Node, Express, and SQLite

**Date:** 21 Aug 2026 · **Status:** Accepted

**Context.** The rebuild is an opportunity to change stack — Next.js, Postgres with PostGIS, and a hosted tile service were all considered.

**Decision.** Keep the v1 stack. Replace only what the audit condemned.

**Why.** The dataset is 4,305 establishments and roughly 10,000 inspections per year. SQLite with a bounding-box index answers that in single-digit milliseconds; PostGIS solves a scale problem this project does not have. A stack change costs hours, adds unfamiliarity, and improves nothing measurable. v1's problems were a dead URL, missing coordinates, and runtime matching — none of them attributable to Node, Express, or SQLite.

**Reversal condition.** Expansion beyond roughly ten counties, or a concurrent-write requirement. Neither is in scope.

---

## DEC-006 — Establishment identity is composite: `license_key` + `normalized_address`

**Date:** 24 Aug 2026 · **Status:** Accepted · **Resolves:** D-010 · **Traces:** FR-104, FR-108 · AUD F4 · Evidence: `docs/08-data-profile.md`

**Context.** `src/db.js` has cited a "DEC-006" since the schema was written. The entry was never written; this closes that dangling reference. The question it answers: what is the primary key of `establishment`, given that the obvious candidate — the licence number the state prints on the certificate — is not unique.

**Decision.** `establishment_id = '<digits>|<license_type_code>|<normalized_address>'`. The first two segments are `license_key`, which is also the join key to `inspection`.

**Why.** Measured across all 4,305 county-60 rows, exactly **one** `license_key` covers more than one establishment: `6021991|2010` — licence `SEA6021991` — two businesses in different suites of the same building. One collision in 4,305 is a rate of 0.02%, and it would be easy to argue it is beneath notice.

It is not, for two reasons. The failure is **silent**: a non-composite key does not error, it merges two restaurants into one record and shows a diner the other one's inspection result. And the licence number is the state's key, not ours — it collides because DBPR issues one licence per licensee at a location, and nothing prevents the next extract from containing ten such cases. A key chosen because today's data happens not to collide is a key that fails on a future Tuesday.

The address is the right second segment because it is what actually distinguishes the two: same licence, same building, different suite, and the suite is carried in the address string.

**Cost of being wrong in the other direction.** If the address normalizer is unstable — if the same establishment normalizes differently between runs — the composite key produces duplicate rows rather than merged ones. That is the safer failure, visible rather than silent, and it is bounded by `normalize()` being pure and deterministic over the source string. `geocode_cache` is keyed on the same normalized address, so a normalizer change is already a coordinated change.

**Reversal condition.** DBPR publishes a genuinely unique establishment identifier — the inspection extract's `License ID` column is the candidate — and it is present, populated, and stable across two consecutive extracts. At that point the composite key becomes an unnecessary complication and should be retired to a unique index.

---

## DEC-007 — `inspection` is keyed on `Inspection Visit ID`, never on `Inspection Number`

**Date:** 24 Aug 2026 · **Status:** Accepted · **Resolves:** D-011 · **Traces:** FR-105, FR-301 · Evidence: `docs/08-data-profile.md`

**Context.** The inspection extract carries two id-shaped columns. `Inspection Number` reads like the natural key and is not one: it identifies a *case*, and a case accumulates visits — an initial inspection, then the callback that resolves or escalates it.

**Decision.** The primary key of `inspection` is `Inspection Visit ID`. `Inspection Number` is retained as `inspection_number`, indexed, as the case identifier.

**Why.** Measured on the ingested extract: **1,305 visit rows collapse to exactly 1,037 case ids** — 786 cases of one visit, 234 of two, 17 of three. Keying on the case id would silently discard 268 rows, 20.5% of all inspection activity.

The discarded fifth is the worst fifth to lose. A case with more than one visit is by definition a case that did not resolve on the first attempt: the first visit says `Warning Issued` or `Call Back - Extension given, pending`, and the second says `Call Back - Complied` or `Call Back - Admin. complaint recommended`. Those callback dispositions are precisely the ones `src/signal.js` maps to a changed signal. Collapsing on case id keeps an arbitrary one of the pair and therefore reports either a resolved problem as outstanding, or an escalated one as resolved. Both are wrong; the second is dangerous, because it is wrong in the reassuring direction — the same class of error as AUD F1, where a dead pipeline reported success.

Keying on the visit id also makes the displayed signal well-defined: the establishment shows the signal of its most recent *visit*, ordered by `inspection_date` then `visit_number`, which is the state of the premises the last time an inspector stood in it.

**Reversal condition.** None foreseeable. If DBPR ever publishes visit-level rows without a stable visit id, the key would have to become `(inspection_number, visit_number)` — a composite over the same information, not a return to the case id.

---

## DEC-008 — Map provider: Leaflet with CARTO Positron raster tiles

**Date:** 24 Aug 2026 · **Status:** Accepted · **Resolves:** D-002 · **Traces:** NFR-12, NFR-13, FR-403, FR-404 · Charter C3

**Context.** D-002 has been open since Gate 0. v1 used the Google Maps JavaScript API, which required a browser-exposed key: `server.js` served `GOOGLE_MAPS_API_KEY` to the frontend from a `/config` endpoint, so the key was readable by anyone who loaded the page. `docs/40-mvp-plan.md` §4 already assumes Leaflet; this entry records the choice, the tile source it depends on, and what would reverse it.

**Decision.** Leaflet 1.9 with `Leaflet.markercluster`, drawing CARTO Positron raster tiles. No API key, no billing account, no key on the server. Attribution: © OpenStreetMap contributors, © CARTO, and Florida DBPR for the inspection data.

**Why.**

*Against Google Maps JS.* It reintroduces the exact surface the audit condemned — a key that must reach the browser, and a billing account behind it. Charter C3 caps infrastructure at <$50/month (NFR-12); Google bills per map load above the free allowance, so the cost is traffic-coupled and therefore unbounded by anything under our control. Nothing in FR-403 or FR-404 needs Google's basemap.

*Against MapLibre GL with vector tiles.* Better rendering and cheap client-side restyling, but it costs hours the plan does not have — Task 9 is budgeted at 8 hours — and every free vector-tile source still wants a key. At 4,305 pins, raster plus markercluster is not the bottleneck.

*For a desaturated basemap specifically.* The signal colour is the information (FR-404). A full-colour basemap competes with the pins for the same channel: OSM Standard renders retail buildings, parks and roads in saturated colour, which is the palette the pass/warning/serious markers occupy. Positron is greyscale by design, so the pin carries the only colour on the map — and the shape channel still survives greyscale and colour-blindness.

*Against OSM Standard tiles.* Free and keyless, but the OSMF tile usage policy asks public-facing products with meaningful traffic to use another provider. Depending on it means depending on forbearance.

**This does not violate the no-external-calls invariant.** `CLAUDE.md` §4 governs the *request path on our server*: an API request touches SQLite and nothing else. Tiles are fetched by the browser directly from the CDN and never transit our process. The invariant exists because v1 called Google Places server-side to *match records at request time* (AUD F5, F6) — a correctness and latency failure. A basemap image is neither.

**Verified endpoint, 24 Aug 2026.** `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` — HTTP 200, `image/png`, 20,399 bytes at z12/1123/1710. The `rastertiles/positron` path that appears in older documentation returns 404 and must not be used; recorded here for the same reason DEC-001 records the dead DBPR host.

**Cost.** $0, and the fallback below is also $0.

**Reversal condition.** CARTO's free-tier terms change, its usage caps are reached, or a third-party basemap dependency becomes unacceptable. The exit is Protomaps: a single `.pmtiles` extract of Florida served as a static file from our own host, which removes the third party entirely at the cost of a few hundred megabytes and a protocol shim. That exit is available at any time and changes no pin, cluster, or detail-panel code.

---

## DEC-009 — Establishment types: permanent food service (2010) only

**Date:** 24 Aug 2026 · **Status:** Accepted · **Resolves:** D-004 · **Traces:** FR-104, NFR-07, AC-E2-GATE · Charter §4.1 · Evidence: `docs/08-data-profile.md`

**Context.** D-004 sets the coverage denominator: which of the 4,305 licensed county-60 establishments Safe Eats displays. The charter already excludes vending machines and defers the rest here.

**Measured composition.** Licence type meanings are not documented in the extracts or in `docs/source-layouts.json`. Each is inferred from seats, risk level and business names within the data, and corroborated against DBPR's public application forms — external knowledge, flagged as such in the profile.

| Code | n | Inferred meaning | Seats | Geocoded | ≥1 inspection |
|---|---|---|---|---|---|
| 2010 | 3,659 | Permanent food service | 3,263 have seats (max 3,000) | 3,618 | 943 |
| 2014 | 471 | Mobile food dispensing vehicle | none | 467 | 47 |
| 2013 | 124 | Caterer | none | 124 | 12 |
| 2016 | 35 | Temporary event | none, blank risk level | 32 | 0 |
| 2015 | 16 | Vending machine | none, blank risk level | 15 | 1 |

**Decision.** Display licence type **2010 only** — 3,659 establishments, 85.0% of the licensed universe. The other four types are ingested and stored but not displayed and not counted in any coverage figure.

**Why.** The product's claim is *this pin is a place you can walk into, and this is what the inspector found there*. That claim is true for 2010 and false for the rest, in a specific and unfixable way: **for a mobile vendor, a caterer, or a vending operator, the licensed address is the operator's base, commissary, or home — not where the food reaches a diner.** Pinning 471 food trucks at their registered addresses would put many of them on residential streets and assert, in the product's own visual language, that a restaurant is there. The charter's editorial rule is that Safe Eats publishes only what a DBPR record supports; a DBPR mobile-vendor record does not support a location claim.

Temporary events (2016) are ephemeral and have zero inspections. Vending machines were already excluded by the charter. Caterers are the closest call — a commissary kitchen is a real, fixed, inspected place — but it is not a place a diner chooses, so a pin on it answers a question nobody asked.

This is a decision about *display*, not ingest. Nothing is discarded: all five types remain in `establishment`, so reversing it is a filter change, not a re-ingest.

**Consequence — the coverage denominator changes.** Every published percentage now reads against 3,659, not 4,305:

- Geocoding coverage: **3,618 / 3,659 = 98.88%** (was 98.86% against the full universe). Gate 1's ≥95% still passes.
- Inspection coverage: **943 / 3,659 = 25.8%** have any inspection at all. That is a history-depth problem, not a scope problem — see the open table.
- 41 of the 49 establishments with no coordinates are 2010, so the ungeocoded remainder is barely reduced by the narrowing.

**Consequence — the drawn accuracy sample is invalidated.** `docs/07-accuracy-gate.md` records a 100-row sample drawn 24 Aug 2026 against a population of 4,256 geocoded establishments, fingerprint `21c1adf00333ed53`. **Fifteen of those 100 rows are types this decision removes** — 13 mobile vendors, 1 caterer, 1 vending operator. The population becomes 3,618, so the fingerprint changes and, by that document's own rule, any new draw is a different sample.

The sample must be redrawn as draw 2. This does **not** breach the rule that a sample may not be redrawn to obtain a better result, and the reason is that **zero of the 100 rows had been verified** when this decision was taken. No information about the outcome existed, so no outcome can have influenced it. Draw 1 stays in `07-draw-history.json`; the redraw is caused by a scope decision recorded independently of any result, and this entry is the record of that causation.

The sequencing error is worth naming: D-004 was scheduled as a **Gate 0** decision precisely so the denominator would be fixed before anything was measured against it. Drawing the sample while D-004 was still open was out of order, and the cost is one wasted draw.

**Reversal condition.** Either (a) DBPR begins publishing an operating location distinct from the licensed address for mobile vendors, at which point 2014 becomes displayable and adds 471 establishments; or (b) user evidence shows caterers are being searched for. Reversal is a filter change plus a redraw of the accuracy sample, since the population would change again.

---

## Closed decisions

| ID | Decision | Closed by | Date |
|---|---|---|---|
| D-002 | Map provider | DEC-008 | 24 Aug 2026 |
| D-004 | Establishment types included | DEC-009 | 24 Aug 2026 |
| D-010 | Establishment identity key | DEC-006 | 24 Aug 2026 |
| D-011 | Inspection primary key | DEC-007 | 24 Aug 2026 |

D-010 and D-011 were not in the `docs/12-PRD-v1.0.md` register, which defines D-001…D-006. They are registered there now. DEC-006 also closes the dangling citation in `src/db.js`.

## Open decisions

| ID | Decision needed | By | Notes |
|---|---|---|---|
| **D-005** | **Historical backfill depth** | **Before Task 9** | **Escalated by the profile.** Every inspection in the extract falls in 2026-07-01 → 2026-08-20, a 51-day window, so only 943 of 3,659 displayable establishments (25.8%) carry any signal at all and 74.2% would render as "no recent inspection". `src/signal.js` assumes a 24-month horizon that the data does not supply. Eight candidate prior-fiscal-year URLs on the DBPR host were probed on 24 Aug 2026; all returned 301 to HTML. Whether the window is a sliding feed or a snapshot artefact cannot be settled from one pull — it needs repeated fetches. |
| D-012 | Violation severity display | Task 10 | `Number of Critical Violations` and `Number of Noncritical Violations` are blank in 100% of source rows, so `critical_violations`/`noncritical_violations` are NULL for all 1,305 inspections. Only total/high/intermediate/basic are populated. The detail panel must be built on the four that exist. |
| OPEN-1 | Hosting target | Task 12 | Render hosted v1; static-friendly hosts are viable now that Puppeteer is gone |
| OPEN-2 | Paid geocode fallback | — | *Effectively closed by implementation* (commit `03e6120`): tier-2 fallback raised coverage 92.82% → 98.86%. Needs a retrospective entry recording cost and provider. |
| OPEN-3 | Expand beyond Palm Beach | Post-MVP | Ingest is already district-wide; gated on the accuracy sample holding |
