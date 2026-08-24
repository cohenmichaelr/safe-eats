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

## Open decisions

| ID | Decision needed | By | Notes |
|---|---|---|---|
| OPEN-1 | Hosting target | Task 12 | Render hosted v1; static-friendly hosts are viable now that Puppeteer is gone |
| OPEN-2 | Paid geocode fallback | Gate 1 | Only if Census coverage lands under 95%; ~$5 for the remainder |
| OPEN-3 | Expand beyond Palm Beach | Post-MVP | Ingest is already district-wide; gated on the accuracy sample holding |
