# Product Requirements Document — Safe Eats v1.0

| Field | Value |
|---|---|
| Document ID | PRD-SE-100 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Owner | Product Manager |
| Status | **Pending approval** |
| Supersedes | PRD-SE-002 v0.1 (draft) |
| Traces from | CHR-SE-001, DSC-SE-001, AUD-SE-001 |
| Traces to | TRD-SE-002, RTM-SE-001 |

---

## 1. Purpose and scope of this document

Defines *what* Safe Eats v1.0 must do and how each requirement will be verified. It does not specify *how* — that is TRD-SE-002.

Every requirement here traces upward to a charter objective and downward to an acceptance test in RTM-SE-001. A requirement that cannot do both does not belong.

**Prioritization: MoSCoW.**

| Level | Meaning |
|---|---|
| **Must** | v1.0 does not launch without it. Charter objective depends on it. |
| **Should** | Significant value; launch may proceed without it if the charter objective is unaffected. |
| **Could** | Desirable. First candidates to cut against constraint C1. |
| **Won't (this release)** | Explicitly excluded. Recorded so it is not relitigated. |

**Product summary.** A mobile-first web map showing every licensed food establishment in Palm Beach County, positioned accurately, colored by its most recent health inspection result, with full history a tap away. Data comes from Florida DBPR bulk extracts on a weekly automated pipeline. No accounts, no reviews, no advertising.

---

## 2. Requirement summary

| Epic | Must | Should | Could | Total |
|---|---|---|---|---|
| E1 Data Pipeline Integrity | 9 | 2 | 1 | 12 |
| E2 Location Accuracy | 7 | 2 | 1 | 10 |
| E3 Safety Signal | 6 | 1 | 1 | 8 |
| E4 Proximity Discovery | 8 | 3 | 2 | 13 |
| E5 Establishment Detail | 5 | 3 | 2 | 10 |
| E6 Trust & Compliance | 7 | 1 | 0 | 8 |
| E7 Operability | 4 | 2 | 1 | 7 |
| **Total** | **46** | **14** | **8** | **68** |

**46 Must requirements against 144 hours.** If that ratio looks tight, it is. The Should and Could tiers are the release valve, and they are expected to be spent.

---

## 3. Epic E1 — Data Pipeline Integrity

**Objective:** O2, O5, O6 · **Principle:** SP6

> *As the operator of Safe Eats, I need every displayed record to originate from an authoritative state extract and to be verifiably current, so that the product never repeats v1's three-year silent staleness.*

**Audit context:** v1's download script targeted a nonexistent URL, detected the HTML error response, logged a warning, and continued. The error page was committed to the repository as `inspect.csv`. This epic exists so that failure mode is structurally impossible.

| ID | Pri | Requirement |
|---|---|---|
| FR-101 | Must | Ingest the DBPR District 2 inspection extract on an automated weekly schedule |
| FR-102 | Must | Ingest the DBPR District 2 active license extract on the same schedule |
| FR-103 | Must | Ingest the weekly statewide emergency closure extract |
| FR-104 | Must | Filter every ingest to Palm Beach County (code 60) |
| FR-105 | Must | Archive raw source bytes before any parsing, keyed by fetch timestamp |
| FR-106 | Must | Assert response content type and header signature; abort on mismatch |
| FR-107 | Must | Abort if the payload begins with an HTML document declaration |
| FR-108 | Must | Every ingest is idempotent — a repeated run produces identical database state |
| FR-109 | Must | Record every run with source, timestamps, status, and row counts at each stage |
| FR-110 | Should | Abort and alert if row count deviates more than 40% from the trailing four-run average |
| FR-111 | Should | Backfill inspection history from FY2016 to present as a resumable one-time job |
| FR-112 | Could | Ingest monthly disciplinary action extracts |

### Acceptance criteria

**FR-107** — the requirement that directly encodes v1's defining failure:

```gherkin
Scenario: Upstream returns an error page instead of data
  Given the DBPR endpoint responds with an HTML error page
  When the weekly ingest runs
  Then the run aborts before any parsing occurs
  And the run is recorded with status "failed" and the reason
  And an alert is raised
  And no production table is modified
  And the previously served data remains unchanged with its original as-of date
```

**FR-108:**

```gherkin
Scenario: Repeated ingest is idempotent
  Given a completed ingest of a known source file
  When the identical file is ingested again
  Then row counts in every affected table are unchanged
  And no duplicate records exist
  And no column previously populated by another process is nulled
```

The final clause is deliberate. v1 used `INSERT OR REPLACE` without listing coordinate columns, which deleted and reinserted rows, destroying every accumulated coordinate on each rebuild (AUD-SE-001 F4).

**FR-104:**

```gherkin
Scenario: County filtering is enforced
  Given a District 2 extract containing Broward, Martin, and Palm Beach records
  When the ingest completes
  Then every establishment row has county code 60
  And the run record shows both pre-filter and post-filter counts
  And the run aborts if the post-filter count is zero
```

---

## 4. Epic E2 — Location Accuracy

**Objective:** O3 · **Principles:** SP1, SP7

> *As a diner walking toward a restaurant, I need the pin to be on the actual building, so that I am judging the place I am about to enter.*

**This epic is the product's differentiator** (CHR-SE-001 §1.2). v1 had no geocoding stage — coordinates were scavenged from Google Places results by the browser, one at a time, reaching 24 of 64,110 records.

| ID | Pri | Requirement |
|---|---|---|
| FR-201 | Must | Normalize addresses before geocoding: standardize abbreviations, extract secondary unit designators, strip plaza names |
| FR-202 | Must | Geocode via a cascade: cache, then free batch geocoder, then paid geocoder, then manual queue |
| FR-203 | Must | Persist a confidence score, source, and resolution timestamp for every geocode |
| FR-204 | Must | Cache geocodes permanently, keyed on normalized address, never re-resolving an unchanged address |
| FR-205 | Must | Suppress establishments below the confidence threshold from the map while keeping them findable by search, labeled as unverified |
| FR-206 | Must | Represent geocoding failure distinctly from success — never as a coordinate value |
| FR-207 | Must | Preserve manually corrected coordinates across every subsequent pipeline run |
| FR-208 | Should | Provide a review queue listing failed and low-confidence geocodes |
| FR-209 | Should | Achieve ≥98% geocode coverage of active licenses |
| FR-210 | Could | Match establishments to external place identifiers using both name similarity and distance |

### Acceptance criteria

**FR-206** — encodes audit finding F5, where failures were written as literal `(0, 0)`, a real location in the Gulf of Guinea that passed every null check and could never be retried:

```gherkin
Scenario: Geocoding failure is not a coordinate
  Given an address the geocoder cannot resolve
  When the geocoding stage completes
  Then the establishment has no position value
  And its confidence is recorded as zero
  And it does not appear on the map
  And it remains eligible for retry on a future run
```

**FR-207:**

```gherkin
Scenario: Manual correction survives the pipeline
  Given an establishment whose coordinates were set manually
  When a full ingest and geocoding cycle runs
  Then the manual coordinates are unchanged
  And the source remains recorded as manual
  And confidence remains at maximum
```

**FR-205:**

```gherkin
Scenario: Low-confidence establishments are suppressed, not hidden
  Given an establishment geocoded below the confidence threshold
  When a user views the map covering its area
  Then no pin is displayed for it
  But searching its name returns it
  And the result is labeled as having an unverified location
  And no coordinates are shown
```

### Verification gate

**AC-E2-GATE (Must):** a randomly drawn, seeded sample of 100 map-displayed establishments is verified by hand against satellite imagery. **At least 99 must fall within 50 metres.** Below that, v1.0 does not launch. The sample may not be redrawn to obtain a better result, and the threshold may not be adjusted. Failures are classified by cause, and the cause distribution directs remediation.

---

## 5. Epic E3 — Safety Signal

**Objective:** O7 · **Principles:** SP4, SP5

> *As a diner with seconds to spend, I need a signal I can read at a glance and trust, without needing to interpret regulatory terminology.*

**Audit context:** v1 assigned pin colors by substring-matching status text for "fail", "warning", "satisfactory". Against real DBPR dispositions, none of its 50,207 clean inspections rendered green and none of its emergency orders rendered red. The map was almost entirely blue (AUD-SE-001 F12).

| ID | Pri | Requirement |
|---|---|---|
| FR-301 | Must | Derive the safety signal from the most recent completed inspection, including callbacks |
| FR-302 | Must | Map every DBPR disposition value explicitly; no substring matching, no unhandled default |
| FR-303 | Must | Exclude reporting-only violation codes from all scoring |
| FR-304 | Must | Reduce signal strength toward neutral as the last inspection ages |
| FR-305 | Must | Display "not recently inspected" rather than a score when no inspection exists within 36 months |
| FR-306 | Must | Compute scores in batch and store them; never compute on the request path |
| FR-307 | Should | Version the scoring formula and stamp the version on every stored score |
| FR-308 | Could | Weight repeated violations of the same code across consecutive inspections |

### Acceptance criteria

**FR-302:**

```gherkin
Scenario: Every disposition is explicitly handled
  Given the complete set of DBPR disposition values present in the data
  When each is passed to the signal mapper
  Then every value maps to a defined signal
  And no value falls through to an unknown or default state
  And a disposition not in the mapping raises an error rather than being silently defaulted
```

**FR-303:**

```gherkin
Scenario: Reporting-only violations do not affect the score
  Given two inspections identical except that one adds a reporting-only violation
  When scores are computed
  Then both scores are identical
```

**FR-301 monotonicity property:**

```gherkin
Scenario Outline: Additional violations never improve the score
  Given an inspection with a computed score
  When any additional violation of any severity is added
  Then the resulting score is less than or equal to the original
```

### Open decision

**The letter grade itself is unresolved** (Decision Log D-001). Florida issues no grades; any letter is Safe Eats' editorial construct on a small business's reputation. The alternative — stating findings factually — is more defensible and possibly more useful. **Requirements in this epic are written to be neutral on the outcome.** D-001 must be resolved before Phase 3.

---

## 6. Epic E4 — Proximity Discovery

**Objective:** O4 · **Principles:** SP2, SP3 · **Persona:** P1

> *As a diner standing somewhere, I need to see what is around me and how each place did, in seconds, on my phone.*

**This epic is the positioning.** Audit finding F1: v1's map was driven by Google Places search results, meaning coverage was whatever Google chose to return. This epic requires the inverse — the map renders what the database contains.

| ID | Pri | Requirement |
|---|---|---|
| FR-401 | Must | The map is the landing experience, centered on the user's location or a county default |
| FR-402 | Must | Establishments are retrieved by map viewport bounds, never as a full dataset |
| FR-403 | Must | The set of displayed establishments is determined solely by Safe Eats' own data |
| FR-404 | Must | Pins encode the safety signal by both color and shape or icon |
| FR-405 | Must | Cluster pins at lower zoom levels, bounding individually rendered markers |
| FR-406 | Must | Selecting a pin shows name, address, signal, inspection date, and one plain-language line |
| FR-407 | Must | Search establishments by name, tolerant of partial and imprecise input |
| FR-408 | Must | Function fully on a 375-pixel viewport, one-handed |
| FR-409 | Should | Filter by safety signal |
| FR-410 | Should | Filter to recently closed establishments |
| FR-411 | Should | Search by address or postal code, recentering the map |
| FR-412 | Could | List view sorted by distance |
| FR-413 | Could | Re-query on map pan |

### Acceptance criteria

**FR-403** — encodes the correction of v1's inverted architecture:

```gherkin
Scenario: The database determines what appears on the map
  Given a map viewport over an area containing known establishments
  When the map renders
  Then every establishment in the database within those bounds and above the
       confidence threshold is represented
  And no establishment absent from the database is represented
  And no third-party service is consulted to determine which establishments exist
  And every pin position derives from the stored geocode
```

**FR-402:**

```gherkin
Scenario: Only the viewport is retrieved
  Given the full county dataset is loaded
  When a user views a map covering a small neighborhood
  Then only establishments within those bounds are transferred
  And the response completes within the performance target
  And payload size is proportional to the viewport, not the dataset
```

**FR-404:**

```gherkin
Scenario: Signal is perceivable without color
  Given a map displaying establishments across all signal levels
  When viewed in grayscale or by a user with color vision deficiency
  Then each signal level remains distinguishable by shape or icon
```

---

## 7. Epic E5 — Establishment Detail

**Objective:** O7 · **Principles:** SP4, SP5 · **Persona:** P2

> *As someone deciding carefully, I need the actual findings and their history, in language I understand, with a path to the official record.*

| ID | Pri | Requirement |
|---|---|---|
| FR-501 | Must | Each establishment has a stable, shareable, server-rendered detail page |
| FR-502 | Must | Display full inspection history, most recent first, with date, type, disposition, and violation counts by severity tier |
| FR-503 | Must | Render violations in plain language, with severity tier labeled |
| FR-504 | Must | Link to the authoritative state record |
| FR-505 | Must | Display the state's snapshot disclaimer |
| FR-506 | Should | Display emergency closures prominently, with dates and condition |
| FR-507 | Should | Display the score's derivation — which findings contributed and by how much |
| FR-508 | Should | Indicate elapsed time since last inspection in plain language |
| FR-509 | Could | Display disciplinary actions |
| FR-510 | Could | Display signal trend across inspections |

### Acceptance criteria

**FR-503:**

```gherkin
Scenario: Violations are readable without regulatory knowledge
  Given an inspection citing numbered violation codes
  When the detail page renders
  Then each violation appears in plain language
  And its severity tier is labeled
  And no bare numeric code is presented as the primary description
```

**FR-507:**

```gherkin
Scenario: The score shows its work
  Given an establishment with a computed score
  When a user views its detail page
  Then the findings that contributed are listed with their individual effect
  And the effect of elapsed time since inspection is shown
  And the sum reconciles to the displayed score
```

---

## 8. Epic E6 — Trust & Compliance

**Objective:** O7 · **Principles:** SP4, SP5, SP6

> *As a restaurant operator, I need to be represented accurately and to have a path to correct genuine errors. As a diner, I need to know where this came from and how current it is.*

**Audit context:** v1 exposed two unauthenticated POST endpoints, one of which wrote coordinates. Anyone could reposition any restaurant (AUD-SE-001 F6).

| ID | Pri | Requirement |
|---|---|---|
| FR-601 | Must | Every page displays the data-as-of date |
| FR-602 | Must | A public methodology page explains the scoring in plain language with a worked example |
| FR-603 | Must | Every displayed fact is traceable to a source extract and ingest date |
| FR-604 | Must | Site-wide disclaimer of affiliation with or endorsement by the state |
| FR-605 | Must | Attribute the state as data source |
| FR-606 | Must | Provide a public mechanism to report a factual error, with a stated response commitment |
| FR-607 | Must | No public endpoint permits unauthenticated modification of any record |
| FR-608 | Should | Publish a written policy distinguishing factual correction from removal of accurate records |

### Acceptance criteria

**FR-601:**

```gherkin
Scenario: Staleness is never silent
  Given the most recent successful ingest occurred on a known date
  When a user views any page displaying inspection data
  Then that date is displayed
  And if it exceeds the freshness threshold, the display indicates the data may be outdated
```

**FR-607:**

```gherkin
Scenario: No anonymous writes
  Given the deployed application
  When any endpoint is called without valid authentication in a manner that would modify data
  Then the request is rejected
  And no data is modified
```

---

## 9. Epic E7 — Operability

**Objective:** O6 · **Principle:** SP6

| ID | Pri | Requirement |
|---|---|---|
| FR-701 | Must | The pipeline runs on schedule without human intervention |
| FR-702 | Must | Pipeline failure raises an alert |
| FR-703 | Must | Pipeline failure never causes stale data to be presented as current |
| FR-704 | Must | The application never makes outbound third-party requests during a user request |
| FR-705 | Should | Ingest history is queryable for troubleshooting |
| FR-706 | Should | Public endpoints are rate-limited |
| FR-707 | Could | Operational dashboard showing pipeline health |

**FR-704** is the single rule most responsible for v1's slowness. It is architectural, not a performance optimization.

---

## 10. Non-functional requirements

| ID | Category | Requirement | Target | Verification |
|---|---|---|---|---|
| NFR-01 | Performance | Viewport query response | p95 <300ms | Load test, full dataset |
| NFR-02 | Performance | Map interactive | <2.5s on 4G mobile | Lighthouse, throttled |
| NFR-03 | Performance | Detail page LCP | <2.0s on 4G | Lighthouse |
| NFR-04 | Performance | Time to first usable answer | <5s from cold load | Manual, real device |
| NFR-05 | Freshness | Maximum data age | ≤8 days | Monitored |
| NFR-06 | **Accuracy** | **Pin within 50m of true position** | **≥99% of sample** | **AC-E2-GATE** |
| NFR-07 | Accuracy | Coverage of active county licenses | ≥98% | Reconciliation query |
| NFR-08 | Accessibility | WCAG 2.1 AA | Conformant | axe-core + manual |
| NFR-09 | Accessibility | Signal never conveyed by color alone | Absolute | Grayscale review |
| NFR-10 | Accessibility | Non-map fallback list view | Present | Manual |
| NFR-11 | Availability | Uptime | 99.5% | Monitoring |
| NFR-12 | Cost | Monthly infrastructure and API spend | <$50 | Billing review |
| NFR-13 | Mobile | Usable one-handed at 375px | Absolute | Real device |
| NFR-14 | SEO | Detail pages server-rendered and indexable | All | Crawl check |
| NFR-15 | Security | No credentials in source or history | Absolute | Pre-commit hook + scan |
| NFR-16 | Security | Application database role is read-only | Absolute | Config review |

---

## 11. Won't have — this release

Binding per charter §4.2. Recorded to prevent relitigation.

| Excluded | Rationale |
|---|---|
| User accounts, reviews, UGC | Charter scope; would add ~2 weeks and a moderation obligation |
| Restaurant claim-and-respond | Requires identity verification and dispute process |
| Menus, hours, photos, reservations, delivery | Not the job; incumbents and Google serve it |
| Counties beyond Palm Beach | SP7; expansion is a v2.0 decision after stability |
| Lodging inspections | Different dataset, different user |
| FDACS retail food data | Different agency, different schema, different job |
| Native mobile applications | Mobile web satisfies P1 without install friction |
| Notifications or alerting | Requires accounts |
| Public API | Post-launch consideration |
| Statistics and trend dashboards | Serves P3, who is not a v1.0 driver |
| Monetization or advertising | Would trigger a data-rights review; charter §3.3 |

---

## 12. Release plan

| Release | Contents | Gate |
|---|---|---|
| **v0.1 — Internal** (Wk 4) | E1 complete; data loaded and verified. No UI. | Gate 1 |
| **v0.2 — Internal** (Wk 6) | E2 complete. **Accuracy gate.** No UI. | **Gate 2** |
| **v0.3 — Internal** (Wk 8) | E3, E7 core, API. Verified by query, not interface. | Gate 3 |
| **v0.9 — Private beta** (Wk 10) | E4, E5 Must requirements. Feature complete. | Gate 4 |
| **v1.0 — Public** (Wk 12) | E6 complete, NFRs met, hardened. | Gates 5–6 |

**Deliberately, no user-facing interface exists until Week 10.** Two-thirds of the schedule produces nothing visible. That sequencing is the correction to v1, which began with the map and inherited its data from whatever the map happened to fetch. If the impulse to build the map early becomes pressing around Week 5, that impulse is the one that produced v1.

---

## 13. Dependencies on unresolved decisions

| Decision | Blocks | Needed by |
|---|---|---|
| D-001 Letter grade or factual statement | E3 implementation, FR-602 | Phase 3, Week 7 |
| D-002 Map provider | E4 implementation, NFR-12 | Gate 0, Week 1 |
| D-003 Confidence threshold value | FR-205, AC-E2-GATE | Phase 2, Week 5 |
| D-004 Establishment types included | FR-104, coverage denominator | Gate 0, Week 1 |
| D-005 Historical backfill depth | FR-111 | Phase 1, Week 3 |

Full analysis in [Decision Log](14-decision-log.md).

---

## 14. Approval

Approving this PRD commits to the 46 Must requirements as the v1.0 definition and to §11 as binding exclusions.

| Role | Name | Signature | Date |
|---|---|---|---|
| Product Manager | Michael Cohen | | |
| Technical Lead (feasibility) | Michael Cohen | | |
| Sponsor | Michael Cohen | | |
