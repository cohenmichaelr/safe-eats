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

> **Partly superseded by DEC-013 (2 Sep 2026).** Leaflet stands; the CARTO Positron
> tile source does not. CARTO now requires a key, and the basemap is colour by choice.

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

## DEC-010 — No history backfill: the extract accumulates, so history accrues by running

**Date:** 1 Sep 2026 · **Status:** Accepted · **Resolves:** D-005 · **Traces:** FR-111, FR-301, FR-305, E7 task 12 · Evidence: `scripts/probe-window.js`

**Context.** `docs/08-data-profile.md` found every one of the 1,305 loaded inspection visits inside 2026-07-01 → 2026-08-20, a 51-day window, leaving 74.2% of displayable establishments with no signal at all. `src/signal.js` assumes a 24-month horizon the data did not supply. Two explanations fit one pull equally well — a rolling recent-activity feed, or a fiscal-year-to-date file that is simply young — and they imply opposite plans. The first makes history something you must capture before it falls out; the second makes it something that arrives on its own.

**Evidence — a second observation, 11 days later.** `node scripts/probe-window.js` re-fetched `2fdinspi.csv` on 1 Sep 2026 and compared it against what is loaded. It writes nothing: the AC-E2-GATE population is pinned to a sample awaiting hand verification, and an ingest would move it.

| | 21 Aug 2026 | 1 Sep 2026 |
|---|---|---|
| Window | 2026-07-01 → 2026-08-20 | 2026-07-01 → 2026-08-31 |
| County-60 visits in file | 1,305 | 1,550 |
| Held visits missing from the file | — | **0 of 1,305** |
| Displayed establishments with ≥1 visit | 943 (25.8%) | 1,105 (30.2%) |

The start date did not move and nothing fell out. **The extract is fiscal-year-to-date and accumulating** — Florida's fiscal year begins 1 July, which is exactly where the window starts. It was not a 51-day feed; it was a 51-day-old file.

**Decision.** **No backfill.** Ship on the current window and let history accrue through the scheduled weekly ingest. FR-111 (FY2016+ backfill) stays deferred, now for a measured reason rather than an assumed one.

**Why.** There is nothing to backfill *from*. Eight candidate prior-fiscal-year URLs on the DBPR host were probed on 24 Aug 2026 and all returned 301 to HTML; obtaining older data would mean a public-records request, which is weeks of calendar time for history that arrives free by waiting. Marginal coverage over the 11 days is 162 newly-covered establishments, ~14.7/day. That rate decays as the uncovered remainder shrinks, so the straight-line projection of ~174 days to full coverage is a floor, not a forecast — but Florida inspects licensed food service one to four times a year by risk level, so near-complete coverage by the close of the fiscal year on 30 June 2027 follows from the inspection schedule itself, not from the extrapolation.

**Consequence — "no recent inspection" is the majority state at launch, and must be designed as one.** Roughly 70% of pins render in the fourth signal state today. That is not a defect to be hidden: it is the honest answer to *what does DBPR know about this place*, and the alternative — defaulting an uninspected establishment toward a passing signal — is precisely the failure `src/signal.js` throws to prevent. Tasks 9 and 11 therefore treat the grey state as a first-class case: the legend explains it, the methodology page states the window start date plainly, and the detail panel says "no inspection recorded since 1 July 2026" rather than showing an empty history. A user must never read a grey pin as a bad one.

**Consequence — the weekly ingest is the history mechanism, not a freshness feature.** Task 12 was scoped as "keep the data current". It is more than that: once the fiscal-year file rolls over, our copy is the only place the prior year exists, because ingest upserts and never deletes. A missed run is not a stale week, it is a permanent hole.

**Unverified, and worth watching.** What `2fdinspi.csv` does on 1 July 2027 has not been observed. It may reset to the new fiscal year, or it may be renamed with the year embedded. Either would look like a catastrophic row-count drop to the ingest, which is the correct response — the FR-104 floor aborts and leaves prior data intact — but it should be anticipated rather than discovered. `source-watchdog` covers the URL going dead; it does not yet cover the window resetting.

**Reversal condition.** Either (a) a prior-fiscal-year extract becomes discoverable, or a public-records request is filed and returns, at which point backfill is a bulk ingest against the same loader; or (b) displayed coverage is still below ~60% by 31 Jan 2027, which would falsify the inspection-frequency reasoning above and make the grey majority a permanent product condition rather than a launch one.

---

## DEC-011 — Show violation tiers, never bare violation codes

**Date:** 2 Sep 2026 · **Status:** Accepted · **Resolves:** D-012 · **Traces:** FR-503, FR-502, E5 task 10 · Charter editorial rule

**Context.** D-012 asked how the detail panel should present violation severity. The profile had already established that `Number of Critical Violations` and `Number of Noncritical Violations` are blank in 100% of source rows, leaving four populated counts: total, high priority, intermediate, basic. Unpivoting the 58 wide columns (task 5) also produced a `violation` table of 4,533 rows carrying 38 distinct codes.

**What the codes actually are.** Bare two-character numbers — `03`, `08`, `12`, `31` — taken from the extract's column headers `Violation 01` … `Violation 58`. **The extracts publish no description for any of them**, and `docs/source-layouts.json` records none. The obvious place to get the text, DBPR's per-inspection detail page, is dead (DEC-012).

**Decision.** The detail panel displays the **tier counts** — high priority, intermediate, basic, and the total — each with DBPR's own tier name and a one-line gloss of what that tier means. It displays **no violation codes at all**. The codes stay in the database and remain in the `/api/establishments/:id` payload; they are simply not rendered.

**Why.** FR-503 requires plain language and "no bare codes", and there are only three ways to satisfy it:

1. Print `Violation 03`. Meets the letter of the data and tells the reader nothing. A code with no key is noise that looks like evidence.
2. Write our own description of each code. This is the option to refuse. An inspection record is a statement about a **named, identifiable business**, and a description we authored — however carefully inferred from the code's position on the form — is our accusation wearing the state's authority. The charter's editorial rule is that Safe Eats publishes only what a DBPR record supports, and the record supports the count, not a narrative.
3. Publish the tiers and stop. The tier names are DBPR's own severity classification, they are populated, and they carry real meaning: a diner can act on "two high-priority violations" without knowing which two.

Option 3 is the only one that is both useful and true. The gloss text describes the *tier*, which is a documented DBPR classification, not the individual finding.

**Consequence.** The panel is less specific than a reader might want, and less specific than the underlying data technically is. That is the correct trade: the specificity we would have to add is invented. The methodology page states plainly that we hold the codes and why we do not show them, rather than letting the absence look like an oversight.

**Reversal condition.** DBPR publishes an authoritative code-to-description table, or restores a per-inspection page we can link to (DEC-012). Either makes the descriptions quotable rather than authored, and the panel can then show each cited violation by the state's own text.

---

## DEC-012 — Link to the state's inspection search, not to a per-visit record

**Date:** 2 Sep 2026 · **Status:** Accepted · **Traces:** FR-504, E5 task 10 · AUD F1

**Context.** FR-504 requires that the detail panel link out to the state's own record, so a reader can verify anything we display against the source. The natural target is DBPR's per-inspection page, whose historic form is `www.myfloridalicense.com/inspectionDetail.asp?InspVisitID=<visit>&businessID=<licence id>`. Both parameters are columns we already hold: `inspection.inspection_visit_id` and `inspection.source_license_id`.

**Evidence.** Probed 2 Sep 2026 with a real pair from the loaded data (visit `13747028`, business `2224513`):

```
HTTP 200 · text/html · 8,190 bytes
<META HTTP-EQUIV="refresh" CONTENT=5;URL="http://www.myfloridalicense.com/dbpr/index.html">
```

**It answers 200 with a bounce stub** — a five-second meta-refresh to the DBPR index. Not a 404, not a redirect: a success status carrying a page that contains none of the requested record. That is the exact shape of AUD F1, the failure this whole rebuild exists to correct, and it is worth naming that we found it by checking rather than by shipping the link and waiting for a complaint.

`https://www.myfloridalicense.com/portalsearches/VerifyLicensee?Mode=0&BoardType=H` — the "Online Inspection Search" linked from DBPR's own inspections page — resolves normally (200, 12KB, no bounce).

**Decision.** Link to the search page, and label the link for what it does: *"Look up &lt;licence number&gt; on the state's inspection search"*. Do not construct a deep link to a record we cannot reach.

**Why.** A link that promises a specific record and delivers a marketing page is worse than no link, because it spends the reader's trust to prove nothing. Naming the licence number in the link text gives them the one thing they need to complete the lookup by hand, and keeps the promise the label makes.

**Consequence.** FR-504's verification reads "Link resolves to state record"; as implemented, the link resolves to the state's *search for* the record. This is a partial satisfaction and is logged as such rather than ticked — it should be re-examined at Gate 4.

**Reversal condition.** DBPR restores a working per-inspection or per-establishment URL. The two identifiers needed to build it are already stored on every row, so this reverts to a deep link the moment there is one to point at.

---

## DEC-013 — Basemap: Esri World Street Map, in colour

**Date:** 2 Sep 2026 · **Status:** Accepted · **Supersedes:** DEC-008 (tile source only; Leaflet is unchanged) · **Traces:** FR-403, FR-404, NFR-12 · Charter C3

**Context.** Two separate things changed DEC-008's answer on the same day: one forced, one chosen.

### 1. CARTO stopped being keyless — forced

DEC-008 selected CARTO Positron specifically because it needed no API key, no billing account and no browser-exposed credential. That premise expired. CARTO now requires a key for `basemaps.cartocdn.com` and serves unregistered traffic a tile with **"API KEY REQUIRED — carto.com/basemaps/apikey" watermarked diagonally across it**.

The failure is worth recording precisely, because it is this project's own subject matter:

```
GET https://a.basemaps.cartocdn.com/light_all/10/283/433.png
HTTP 200 · image/png · 7,915 bytes · valid PNG · correct map geometry
```

Status code: fine. Content type: fine. Payload size: plausible. Decodes as a real image of the right place. **Every check short of looking at the pixels passes**, and the product is visibly broken. That is AUD F1's shape exactly — a success response carrying a wrong payload — and it was found by rendering a tile and reading it, not by any assertion in this repository.

The lesson generalises past this incident: **a check that cannot fail on the actual failure mode is not a check.** `source-watchdog` verifies the DBPR extracts are alive and CSV; nothing verified that the basemap was a basemap. See the open item below.

### 2. Colour instead of greyscale — chosen

DEC-008 argued for a desaturated basemap so the signal colours would be the only colour on the map. That argument is still correct on its own terms, and it is overridden deliberately: a colour street map is more legible and more familiar, and the greyscale canvas made the product read as a data tool rather than as something you consult before dinner.

**Decision.** Leaflet with **Esri World Street Map** raster tiles, in colour. No key, no billing account, no credential in the browser. Labels are baked into the tile, so the second reference layer the Light Gray canvas needs is dropped. Attribution: Esri, HERE, Garmin, USGS, Intermap, © OpenStreetMap contributors.

**Why Esri and not the alternatives.** Three keyless candidates were fetched and inspected as images, not as status codes:

| Candidate | Key | Verdict |
|---|---|---|
| CARTO Positron | now required | Watermarked; unusable unregistered |
| Esri World Street Map | none | Muted colour, labels included — chosen |
| OSM Standard | none | Saturated greens and oranges; also the OSMF tile policy discourages production use, which DEC-008 already rejected it for |

OSM Standard is the more obvious "colour map", and it is the worse one here: its parks are the green of a passing pin and its arterials the orange-red of an enforcement pin. Esri's palette is quieter, which leaves the signal colours more room.

**What this costs, and what pays for it.** FR-404 requires the signal to survive greyscale and colour-blindness, and it still does — the signal was never carried by colour alone. Each state has a distinct shape (circle, triangle, square, diamond), and the popup, the detail panel and the results list each name it in words.

What is genuinely lost is **scanning speed**: picking the red squares out of a viewport is harder over a busy basemap than over a grey one. The pins compensate — white stroke widened from 11% to 16% of the mark, plus a drop shadow, and the same for cluster bubbles — so a mark holds its edge over tan, green and water alike. If scanning proves to be the thing users actually do, the fix is a basemap toggle rather than a reversal.

**Reversal condition.** Either (a) usability evidence that people scan the map for red rather than search it for a place, which would argue for restoring a desaturated default; or (b) Esri's terms turn out to prohibit this use (open item below), which forces a provider change regardless of colour. Reversal is a URL and an attribution string — the layer is one `L.tileLayer` call — so this is a cheap decision to unwind, which is part of why it was taken quickly.

---

## DEC-014 — Host: Render, one service, refresh in-process

**Date:** 2 Sep 2026 · **Status:** Accepted · **Resolves:** OPEN-1 · **Traces:** E7, FR-108, FR-109, NFR-12 · Charter C3

**Context.** OPEN-1 has been open since the plan was written. v1 is already hosted on Render at `safe-eats-d8mp.onrender.com`, so the platform is settled by inertia and by the absence of a reason to move. What was *not* settled — and what turns out to matter far more — is the shape of the deployment.

**The finding that decides it.** `docs/40-mvp-plan.md` task 12 says "deploy + weekly scheduled ingest". On Render the obvious home for the second half is a Cron Job service. **It cannot be**, and the reason is structural rather than a limitation to work around. From Render's documentation:

> "Cron jobs can't provision or access a persistent disk."
> "You can attach a persistent disk to a paid Render web service, private service, or background worker."
> "A persistent disk is accessible by only a single service instance, and only at runtime."

Our database is a SQLite file on a disk. A cron job is a separate service, so **it cannot see that file**. A cron job running `npm run ingest` would fetch both extracts correctly, load them into its own ephemeral filesystem, discard the result when the process exits, and report success. Every week. With no symptom anywhere.

That is worth stating plainly: **the obvious implementation of task 12 is a silent no-op that reports success indefinitely** — v1's exact failure, rebuilt on new infrastructure, and undetectable from the outside.

**Decision.** One Render **web service** with a persistent disk. The weekly refresh runs **in-process**, inside the service that owns the disk (`src/scheduler.js`, driving `scripts/refresh.js` as a child process). Blueprint committed as `render.yaml`.

**Why in-process is not a compromise.** The measured cost is 3.3 seconds of work once a week — verify 1.2s, ingest 1.2s, geocode 0.6s, basemap 0.3s — against a service whose p95 query time is 20 ms. There is no contention worth designing around. The refresh runs as a child process so that a refresh which throws, leaks or exhausts memory cannot take the web service with it: the map staying up on last week's data is a far better failure than the map going away.

**The schedule is derived from the data, not from a timer.** `setInterval(ONE_WEEK)` since boot is silently wrong on a platform that restarts services for deploys, host moves and idling — a service restarting every few days would never refresh at all while looking perfectly healthy. Instead "is a refresh due" is answered from the newest *successful* `ingest_run`, which survives restarts because it is in the database. That is the same value the UI shows as its as-of date, so "is the data stale" and "is a refresh due" have exactly one answer, and it is the one the user can see. A failed run deliberately does not reset the clock; if it did, a source outage would suppress the retries that recover from it.

**The plan cannot be free, and this is the reason.** `plan: starter` is not headroom. Render's free instances have an ephemeral filesystem and a disk requires a paid instance. On a free instance:

- `safe-eats.db` is destroyed on every deploy and every restart
- `geocode_cache` goes with it — 3,840 resolved addresses, **272 of them paid Google lookups that would have to be bought again**
- the accumulated inspection history goes too, and DEC-010 established that once the fiscal file rolls over, our copy is the only place prior years exist

**That is AUD F4 — losing every accumulated coordinate on each load — recreated at the infrastructure layer.** The audit finding that `INSERT OR REPLACE` reproduced in SQL, a free instance reproduces in the filesystem. Migration 005 spends three database triggers preventing it; hosting it on an ephemeral disk would undo all of that for seven dollars a month.

**Not decided here — the cutover.** This entry chooses the host and the shape. It does **not** authorise replacing the running v1 at `safe-eats-d8mp.onrender.com`. Gate 2 requires the accuracy sample to pass before v1.0 launches and it has not been verified, so deploying v2 to the public URL now would breach the project's own release gate. The blueprint therefore targets a service to be stood up alongside v1, and the cutover is a separate, deliberate act after the gate passes.

**Reversal condition.** Either (a) the dataset outgrows a single-instance SQLite file, which at 4,305 establishments and 20 ms p95 is not close, and which would mean Render Postgres and a genuinely separate cron service; or (b) the refresh grows long enough to interfere with request serving, at which point it moves to a background worker sharing the disk — the same one-service-per-disk constraint permits that shape, and `scripts/refresh.js` would not change.

---

## DEC-016 — The accuracy gate measures a frozen draw, within a drift bound

**Date:** 3 Sep 2026 · **Status:** Accepted · **Resolves:** D-016 · **Traces:** AC-E2-GATE, NFR-06, FR-209 · Charter O3/M3

**Context.** `docs/07-accuracy-gate.md` says a sample may not be redrawn to obtain a better result, and that a changed population fingerprint means any new draw is a different sample. It says nothing about the population simply **growing**, which is what a weekly ingest does by design. The question became concrete twice in two days: an ingest added 14 establishments, and the tier-2 geocode run added 23 more by resolving addresses that previously had no coordinate. The pinned fingerprint `da7b5b4397e4ceca` (population 3,618) is now `e13d0f3cc0c07b61` (population 3,641), with 100 rows drawn and none yet verified.

**Why the obvious rule is wrong.** "Redraw whenever the population changes" is the strict reading, and it is unusable: the refresh runs weekly, so it would reset verification every week and the gate could never be completed. **A rule that can never be satisfied is not a gate**, it is a way of never shipping.

**Decision.** Verification proceeds against the **frozen draw**. A later ingest does not invalidate a sample already drawn. Two guards bound that:

1. **Drift cap of 5%.** If the displayed population has moved more than 5% from the size recorded at draw time, the sample no longer represents what ships and must be redrawn — before the *next* release assessment, not mid-verification.
2. **Any sampled establishment leaving the population voids the draw.** A verdict on establishments the product no longer displays is not a verdict on the product.

Both are enforced by `scripts/score-gate.js`, which now refuses to issue a verdict in either case, and prints the population and its drift above every result — complete or not.

**Why a cap rather than unlimited tolerance.** Drift is not neutral, and this is the part worth stating plainly. The establishments that join the population between draws are precisely the ones that were **hard to place** — they needed the paid geocoder, or several attempts, or a corrected address. They are therefore *more* likely to be misplaced than an average member of the population. Excluding them from the sample does not merely lose precision, it **biases the result optimistically**: the gate would systematically measure the easy cases and report the number as if it covered everything. A small amount of that is tolerable in exchange for a gate that can actually be completed; an unbounded amount is a gate measuring a population that no longer exists.

**Why the figure is always printed.** A gate result that does not state the population it measured, and how far the live population has moved since, is a claim with a hidden denominator — the same species of problem as v1's "success" with no freshness assertion behind it. When the database cannot be read at all, the scorer now says `population NOT CHECKED` rather than passing quietly, because a verdict that cannot name its own population must not read as a stronger claim than it is.

**Current state.** Drift is **+23 (0.64%)**, well inside the bound, and all 100 sampled establishments are still in the population. **The pending verification is valid and can proceed.**

**Consequence — this is now a per-county gate.** DEC-015 scoped `displayedPredicate` so the gate holds one county steady while the product covers three. Broward and Dade have no drawn sample and therefore no accuracy verdict; they are displayed on the strength of Palm Beach's geocoding method, not on a measurement of their own. That is a real exposure and it should be named rather than assumed away: the honest position is that Palm Beach will be measured and the other two inherit an argument. Each should get its own draw before anyone claims a statewide accuracy figure.

**Reversal condition.** Either (a) the drift cap proves to bite in normal operation — a fiscal-year roll-over or a large licensing change moving the population more than 5% between draws — in which case the answer is a scheduled redraw cadence rather than a looser cap; or (b) evidence that newly-geocoded establishments are *not* systematically harder to place, which would remove the bias argument and allow the cap to widen.

---

## DEC-017 — Statewide: all 67 counties, with unverified pin accuracy labelled

**Date.** 3 Sep 2026 · **Status.** Decided, implemented · **Supersedes.** OPEN-3 · **Amends.** DEC-015

**Context.** The product ingested and displayed three counties. The question was what it would take
to run Florida.

**Decision.** Ingest and display all 67 counties. A county that has not passed its own accuracy gate
is still shown, and every record in it carries a plain statement that its pin position has not been
verified. Counties with 100 or fewer displayed establishments are verified in full rather than
sampled.

**Measured, 3 Sep 2026, against the live extracts:**

| | |
|---|---|
| Counties | 67, codes 11 (Alachua) to 77 (Washington), contiguous |
| Displayable (type 2010) | 54,296 |
| All licence types | 69,512 |
| Loaded | 69,527 establishments · 27,196 inspections · 105,571 violations |
| Out-of-state codes | 10 (701–746), 17 rows, zero restaurants |
| Weekly fetch | 33 MB across 14 files, from 10 MB |

**What the measurement overturned.** DEC-015 and `migrations/006` derived the fetch list from a
county-to-district map, on the finding that each of the three counties had all of its type-2010 rows
in one district file. Across all 67 that is false. Seven counties are split, and a map would have
silently dropped the smaller half:

| County | | |
|---|---|---|
| Okeechobee | 7 in d4 | 84 in d7 |
| Columbia | 1 in d4 | 138 in d5 |
| Brevard | 1,462 in d4 | 1 in d5 |
| Hillsborough | 3,348 in d3 | 1 in d7 |
| Polk | 1,329 in d3 | 4 in d4 |
| Sumter | 247 in d3 | 1 in d5 |
| Volusia | 1,426 in d4 | 1 in d5 |

So `COUNTY_DISTRICT` is deleted rather than extended: every district is fetched and the row's own
county code decides what is kept. That costs 33 MB a week instead of 10, and it is the difference
between a complete county and a county quietly missing rows.

**Why display before verification, and why labelled.** DEC-015 gives each county its own gate — 100
rows verified by hand against imagery, at least 99 within 50 m — because the counties differ where it
matters: over half of Dade's addresses use the Miami grid where one wrong character lands miles away,
against 5.8% of Palm Beach's. That reasoning is unchanged, and it means 67 gates, roughly 5,200 hand
verifications. Holding the entire state behind that work would keep a diner in Pensacola from seeing
a published state inspection record for years.

The alternative failure is worse than it looks, though: a pin in an unverified county is visually
identical to a verified one, so showing it silently borrows Palm Beach's verification for Baker's
addresses. Hence the label. `position_verified` travels with every record, and the panel says that
the address is the state's and the position derived from it has not been checked. The claim the
product makes is now scoped to what it has actually measured.

**Small counties.** Liberty has 3 displayed establishments, Lafayette 5, Union 7; about two dozen are
under 100 and cannot yield a 100-row sample. Those counties are verified in full. That is stronger
than sampling — every row checked, and the ≥99% rule leaves a 3-row county no failures at all — and
cheaper, since all the small counties together are about 900 rows.

**Consequences.**

- `migrations/007_statewide_counties.sql` rebuilds `establishment` with
  `CHECK (CAST(county_code AS INTEGER) BETWEEN 11 AND 77)`. The constraint still does work: it is
  what refuses the out-of-state codes now that there is no vetted county list.
- `/api/search` filters county, city and signal in SQL. Selecting 54,296 rows and filtering in
  JavaScript was tolerable at 15,652 and is not now. City stays as forgiving as `canonicalCity`
  because the alias map is finite: the spellings that reach "ROYAL PALM BEACH" are enumerable.
- **The signal filter had to move too, and the first attempt was wrong.** Signal is derived, not
  stored — a pass older than `STALE_AFTER_MONTHS` reads as "unknown" — so it was first handled by
  over-fetching and filtering after. Measured statewide, "show me enforcement actions" then returned
  4 results out of 1,269, all early in the alphabet, because the window filled before the filter ran.
  A filter that silently returns the first slice of an answer is worse than no filter. The boundary
  is now `staleCutoff()`, derived from the same constant and compared in SQL. The four signals
  partition the population exactly: 17,189 + 1,779 + 1,269 + 34,072 = 54,309.
- **A timezone bug surfaced while aligning them.** `establishmentSignal` read local months from a
  UTC-parsed date, so an inspection exactly on the staleness boundary was stale in Florida and fresh
  in London, from the same data. Now UTC on both sides.
- `/api/meta` no longer carries every city. 942 entries, ~64 KB uncompressed on the first paint of a
  phone map, for a menu that only ever shows one county — `/api/cities?county=NN` serves it on
  demand and meta drops to 8.8 KB.
- `DEFAULT_LIMIT` no longer exceeds the displayable universe, and cannot. The guarantee changes from
  "the cap never applies" to "the cap is scoped to the viewport".
- `seedGeocodeCache` tops up instead of restoring only into an empty table, or the committed cache
  would never reach the deployed disk that already holds the three-county one.
- `scripts/report-cities.js` (new) lists unmapped city spellings per county. The alias map covered
  201 spellings across three counties; statewide it is far larger, and 177 candidate pairs are
  outstanding. Aliases remain hand-checked — the module records five cases where edit distance merged
  genuinely different cities.

**Coverage, closed at Gate 1.** The Census geocoder alone reached 91.0% statewide, under the 95% bar
— rural addresses match worse, as the plan anticipated. The tier-2 paid fallback (D-017) resolved
4,528 of the 5,272 remaining addresses; 739 came back too coarse to accept and 5 returned nothing.
**Displayed coverage is now 98.73%** (53,619 of 54,309), from 52,444 Census and 5,840 Google
resolutions. 5,272 paid lookups, list price $26.36 and likely nil against Google's 10,000-a-month
free tier.

**Reversal condition.** If verification finds that unverified counties are materially less accurate
than the gated ones — say a sampled county failing well below the threshold — the labelling is not
enough, and display narrows to gated counties while the data stays statewide. The machinery for that
is already in place: `DISPLAYED_COUNTIES` and the ingest scope are separate.

## DEC-018 — The basemap is configuration, and production is licensed (closes D-014)

**Date.** 4 Sep 2026 · **Status.** Decided, implemented · **Closes.** D-014 · **Amends.** DEC-013

**Context.** D-014 was raised by DEC-013 and marked "before public launch": v2 draws its tiles from
`services.arcgisonline.com`, Esri's keyless legacy endpoint, and nobody had read whether
unauthenticated production use is permitted. Launch is now the question, so it had to be answered.

**What the terms say.** Esri's own developer documentation states that basemap services require an
ArcGIS Location Platform or ArcGIS Online account, that billing occurs when tiles are returned, and
that applications must display attribution. The master-agreement page carries links to E204/E300
rather than terms. **No published text was found permitting unauthenticated production use of the
legacy endpoint.** Absence of a prohibition is not a licence, and a public site is not the place to
find out.

**Decision.** The provider becomes configuration, in `src/basemap.js`:

| | |
|---|---|
| `SAFE_EATS_BASEMAP_KEY` set | **CARTO**, licensed — a free key, no account required, 5,000,000 tiles a month. The fallback D-014 itself named. |
| unset | **OpenStreetMap**, under the OSMF Tile Usage Policy. Correct for a laptop; marked `licensed: false` so it cannot be mistaken for a production posture. |

`/api/meta` composes the tile URL and its attribution; `public/app.js` no longer names a host, and the
footer credit is filled from the same source rather than typed into the HTML where it would go stale.

**The key is public, and that is not AUD F3.** A basemap key travels to the browser by definition —
the browser fetches the tiles. AUD F3 was v1 serving its **Google Maps** key from `/config`: a key
with billing attached to geocoding and Places. That key remains server-side only, in
`src/geocode.js` tier 2. The distinction is what a key can spend, not whether it is visible.

**What this cost, and what it caught.** Pinning the new reference tile produced a clean 7,128-byte
map of Pahokee. The *first* pin did not: OpenStreetMap answered Node's default User-Agent with a
256×256 PNG reading **"Access blocked — App is not following the tile usage policy"**. HTTP 200,
`image/png`, plausible size — every machine-checkable assertion passed, and the pinned definition of
"correct" was a picture of a refusal. That is the AUD F1 shape exactly, and it is why
`check-basemap.js` looks at pixels and makes a person open the image. The canary now sends an
identifying User-Agent, which the OSMF policy requires anyway, and refuses to compare against a pin
taken from a different provider.

**Reversal condition.** If CARTO changes its free tier or begins watermarking keyed tiles the way it
watermarked keyless ones (DEC-013), the canary reports LOOK rather than PASS and the provider moves
again — which now costs one environment variable rather than a front-end edit.

## Closed decisions





| ID | Decision | Closed by | Date |
|---|---|---|---|
| D-002 | Map provider | DEC-008 | 24 Aug 2026 |
| D-004 | Establishment types included | DEC-009 | 24 Aug 2026 |
| D-005 | Historical backfill depth | DEC-010 | 1 Sep 2026 |
| D-012 | Violation severity display | DEC-011 | 2 Sep 2026 |
| D-014 | Esri basemap terms of use | DEC-018 | 4 Sep 2026 |
| D-015 | Watch the basemap, not just the data | `scripts/check-basemap.js` | 2 Sep 2026 |
| OPEN-1 | Hosting target | DEC-014 | 2 Sep 2026 |
| D-016 | Accuracy sample vs. a growing population | DEC-016 | 3 Sep 2026 |
| OPEN-3 | Expand beyond Palm Beach | DEC-015 (Broward, Dade) | 2 Sep 2026 |
| D-010 | Establishment identity key | DEC-006 | 24 Aug 2026 |
| D-011 | Inspection primary key | DEC-007 | 24 Aug 2026 |

D-010 and D-011 were not in the `docs/12-PRD-v1.0.md` register, which defines D-001…D-006. They are registered there now. DEC-006 also closes the dangling citation in `src/db.js`.

## Open decisions

| ID | Decision needed | By | Notes |
|---|---|---|---|
| D-013 | Fiscal-year roll-over behaviour | Before 1 Jul 2027 | Raised by DEC-010. `2fdinspi.csv` is fiscal-year-to-date; what it does when FY2627 closes is unobserved. Extend `source-watchdog` to alert on a window reset, not only on a dead URL. |
| OPEN-2 | Paid geocode fallback | — | *Effectively closed by implementation* (commit `03e6120`): tier-2 fallback raised coverage 92.82% → 98.86%. Needs a retrospective entry recording cost and provider. |
| OPEN-3 | ~~Expand beyond Palm Beach~~ | Closed | DEC-015 took it to three counties, DEC-017 to all 67. |
| D-017 | ~~Paid geocoding for the statewide remainder~~ | Closed 4 Sep 2026 | Run. 5,272 lookups took displayed coverage from 91.0% to 98.73%, clearing Gate 1's 95% bar. Recorded in DEC-017. |
