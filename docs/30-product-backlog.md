# Product Backlog — Safe Eats v1.0

| Field | Value |
|---|---|
| Document ID | BKL-SE-001 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Owner | Product Manager (content) / TPM (sequencing) |
| Traces from | PRD-SE-100, EXP-SE-001 |
| Contents | 8 epics · 47 stories · 150 hours · 109 points |

---

## 1. How this document relates to the others

| Artifact | Answers |
|---|---|
| PRD-SE-100 | *What must be true* — 68 requirements with acceptance criteria |
| EXP-SE-001 | *When work happens* — 38 tasks, critical path, float |
| **BKL-SE-001** | ***What you pick up on a Tuesday*** |

A story is the unit of work you start and finish. Requirements are the contract; tasks are the schedule; stories are the thing you actually do. Every story here carries its requirement IDs and its task ID so all three stay reconciled.

**The estimates reconcile exactly.** 150 hours across 47 stories matches the 150 hours across 38 tasks in the execution plan. If they ever diverge, one of the two documents is lying.

---

## 2. Story format, and an honest problem

### The standard form

> **As a** [role], **I want** [capability], **so that** [benefit].

The third clause is the one that earns its keep. If you can't finish "so that," the story may not be worth doing.

### The enabler story problem

**Most of this backlog has no diner-facing value.** Epics E0 through E3 — 78 of 150 hours — build a pipeline, a geocoder, and a scoring engine. No diner benefits from any of it directly.

The common failure is writing around this with a fake persona:

> ❌ **As a system**, I want indexes on the geometry column, so that queries are fast.

Systems don't want things. This is a task with a costume on, and it hides the value question rather than answering it.

Two honest alternatives, both used here:

**Operator stories.** You genuinely are a user of the pipeline. Your needs are real and the benefit is stateable:

> ✅ **As the operator of Safe Eats**, I need the ingest to abort when the source returns an error page, **so that** the site never silently serves three-year-old data the way v1 did.

**Enabler stories**, marked `[E]`, stating the capability they unlock rather than inventing a user:

> ✅ `[E]` Persist geocode results keyed on normalized address, **enabling** FR-204 and removing repeat geocoding cost — *without which* SE-207 cannot complete within budget.

**Rule applied throughout: if a story has no user, say so and name what it enables.** Don't invent a persona to satisfy a template.

### Story IDs

`SE-EXX` where E is the epic number. Stable once assigned; never reused, even if a story is dropped.

---

## 3. Estimation

**Points are relative complexity. Hours are the schedule estimate.** Both are given because they serve different purposes — points train relative sizing and become velocity data; hours reconcile to the critical path.

| Points | Hours | Meaning |
|---|---|---|
| 1 | 1–2 | Understood completely. One sitting. |
| 2 | 3 | Understood. Minor unknowns. |
| 3 | 4–5 | Some investigation needed. |
| 5 | 6 | Real unknowns. Might split on contact. |
| 8 | 8 | **Large. Split it if you can.** |

Observed calibration: **≈1.4 hours per point**. Sprint capacity at 12 hrs/week × 2 weeks = 24 hours ≈ **17 points**.

**Re-derive this from actuals after Sprint 2.** The table above is a hypothesis. Two sprints of real data beats it, and rebuilding the forecast from measured velocity is the single most useful estimation habit available here.

---

## 4. INVEST, and where this backlog fails it

A good story is **I**ndependent, **N**egotiable, **V**aluable, **E**stimable, **S**mall, **T**estable. Reviewing honestly:

| Criterion | Assessment |
|---|---|
| Independent | ❌ **Substantially violated.** See below. |
| Negotiable | ⚠️ Partial. Stories tied to interface prohibitions are not negotiable by design. |
| Valuable | ⚠️ 52% of hours deliver operator or enabler value, not user value. Marked honestly. |
| Estimable | ✅ Except SE-201, flagged low-confidence. |
| Small | ✅ Largest is 8 hours. |
| Testable | ✅ Every story has acceptance criteria. |

### On independence

The geocoding chain — SE-201 → SE-203 → SE-204 → SE-207 → SE-208 — is strictly serial. You cannot resolve addresses before normalizing them, or audit accuracy before resolving.

**This is a property of the problem, not a defect in the writing.** Forcing artificial independence here would produce stories that don't deliver anything. The correct response is to name the dependency chain and manage it as a risk (TR-01), which the execution plan does.

Worth knowing that INVEST is a heuristic, not a standard. A backlog that satisfies it perfectly for a pipeline project has usually been distorted to fit.

---

## 5. Definition of Ready / Definition of Done

### Ready — a story may not be started without

1. Story statement with a stated benefit (or `[E]` with the capability it enables)
2. Acceptance criteria, testable
3. Requirement IDs from PRD-SE-100
4. Interface contract reference where it crosses a workstream boundary
5. Estimate in points and hours
6. Dependencies identified and satisfied
7. Explicit non-goals — what must *not* change

**Items 4 and 7 exist because of PT-06.** A brief without an interface reference invites generated code to invent a shape; a brief without non-goals invites scope expansion.

### Done — a story is not complete until

1. Acceptance criteria demonstrably met
2. Tests written and passing
3. CI green
4. Idempotency verified, if it touches data
5. Interface prohibitions verified, if it crosses a boundary
6. `/code-review` run
7. No secrets in the diff
8. CLAUDE.md updated if a convention changed
9. Deferred work recorded in the debt register — not left in a comment

---

## 6. Epic summary

| Epic | Theme | Stories | Hrs | Pts | Value type |
|---|---|---|---|---|---|
| **E0** | Foundation & feasibility | 4 | 12 | 8 | Enabler |
| **E1** | Data pipeline integrity | 11 | 40 | 30 | Operator |
| **E2** | Location accuracy | 8 | 32 | 24 | **User (differentiator)** |
| **E3** | Safety signal | 6 | 13 | 9 | User |
| **E4** | Proximity discovery | 7 | 27 | 21 | **User (primary)** |
| **E5** | Establishment detail | 3 | 8 | 5 | User |
| **E6** | Trust & compliance | 3 | 5 | 4 | User + operator |
| **E7** | Launch readiness | 5 | 13 | 8 | Operator |
| | **Total** | **47** | **150** | **109** | |

---

## 7. E0 — Foundation & Feasibility

> **Epic goal:** establish that the data source works, the accuracy target is reachable, and the tooling is ready — before committing to the build.

**Why it exists:** v1 built for months on a data source that had been returning error pages. E0 is the check that wasn't done.

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-001 | Validate DBPR sources | 2 | 3 | FR-101–103 | T01 | — |
| **SE-002** | **Geocoding feasibility spike** | 3 | 4 | NFR-06 | T02 | SE-001 |
| SE-003 | Repository and tooling setup | 2 | 3 | NFR-15 | T03 | — |
| SE-004 | Profile data and close Gate 0 decisions | 1 | 2 | D-002, D-004 | T04 | SE-001 |

### SE-001 — Validate DBPR sources `[E]`

> **As the operator**, I need every DBPR endpoint confirmed to return real data in the documented shape, **so that** I never again build for months against a URL that returns an error page.

**Acceptance criteria:**
```gherkin
Given the DBPR extract URLs from the program documentation
When each is fetched
Then each returns HTTP 200 with a non-HTML content type
And the first bytes are not a document declaration
And the column header matches the published layout
And the District 2 inspection extract contains rows with county code 60
And the county-60 row count is recorded
```

**Non-goals:** no ingest code, no database, no parsing beyond header inspection.

---

### SE-002 — Geocoding feasibility spike `[E]` ⚠️ **Highest-value story in the backlog**

> **As the sponsor**, I need to know in Week 1 whether 99%-within-50m is achievable, **so that** a project-ending discovery happens at hour 7 instead of hour 51.

**Acceptance criteria:**
```gherkin
Given 100 randomly sampled Palm Beach addresses from the DBPR license extract
When each is passed through normalization, then the free geocoder, then the paid fallback
Then each resulting position is verified by hand against satellite imagery
And the count within 50 metres is recorded
And failures are classified by cause
And the result is compared against the Gate 0 decision rule
```

**Decision rule:** ≥95 proceed · 85–94 proceed with expanded normalization · 70–84 escalate · <70 **stop**.

**Non-goals:** throwaway script. No production code, no caching, no database writes, no reuse expectation.

**Note:** this story has 91 hours of schedule float and is still scheduled first. Float measures schedule freedom; this story is sequenced by risk.

---

### SE-003 — Repository and tooling setup `[E]`

> **As the operator**, I need a fresh repository with hooks enforcing the non-negotiables, **so that** rules I care about are structurally enforced rather than remembered.

**Acceptance criteria:**
```gherkin
Given a new repository initialized without v1 history
When the tooling is configured
Then CLAUDE.md is committed before any application code
And a pre-commit hook blocks credential-shaped strings
And the hook is proven by attempting to commit a test key
And a hook blocks destructive SQL against non-local databases
And CI runs on every push
```

**Non-goals:** do not import v1 code or history. Do not attempt to rewrite v1's history to remove the 28MB database.

---

### SE-004 — Profile data and close Gate 0 decisions

> **As the product manager**, I need the data's actual shape and the two blocking decisions resolved, **so that** the schema and coverage denominator are built on measurement rather than assumption.

**Acceptance criteria:** null rates, address pathology examples, and duplicate analysis recorded. D-002 (map provider) and D-004 (establishment types) decided and logged with reasoning.

---

## 8. E1 — Data Pipeline Integrity

> **Epic goal:** every record originates from an authoritative extract, is verifiably current, and survives a rerun intact.

**Value type:** operator. No diner benefits directly; every diner-facing feature depends on it.

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-101 | Schema, constraints, spatial indexes | 3 | 4 | IFC-1 | T05 | SE-004 |
| SE-102 | Fetch and archive raw extracts | 2 | 3 | FR-105 | T06 | SE-101 |
| **SE-103** | **Abort on invalid source payload** | 3 | 4 | FR-106, FR-107 | T06 | SE-102 |
| SE-104 | Filter to Palm Beach County | 1 | 2 | FR-104 | T07 | SE-103 |
| SE-105 | Unpivot wide violation columns | 5 | 6 | FR-101 | T07 | SE-104 |
| **SE-106** | **Idempotent upsert** | 5 | 6 | FR-108, IFC-1.P2 | T08 | SE-105 |
| SE-107 | Record every ingest run | 1 | 2 | FR-109 | T09 | SE-106 |
| SE-108 | Detect row-count anomalies | 1 | 1 | FR-110 | T09 | SE-107 |
| SE-109 | Violation reference in plain English | 5 | 6 | FR-503 | T12 | SE-101 |
| SE-110 | Backfill three years of history | 2 | 3 | FR-111 | T10 | SE-106 |
| SE-111 | Schedule the pipeline with alerting | 2 | 3 | FR-701, FR-702 | T11 | SE-107 |

### SE-103 — Abort on invalid source payload ⭐

> **As the operator**, I need the ingest to stop before parsing when the source returns anything unexpected, **so that** an upstream change is a loud failure instead of three years of silent staleness.

**Acceptance criteria:** PRD-SE-100 §3, FR-107 scenario. Additionally:
```gherkin
Given a fixture containing a header with one column renamed
When the ingest runs
Then the run aborts with a schema-drift reason
And no attempt is made to infer the correct mapping
```

**Non-goals:** never coerce, guess, or partially load. Abort is the correct behavior.

**Audit reference:** F2. v1 detected the HTML response, logged a warning, and continued. The warning was correct; continuing was not.

---

### SE-106 — Idempotent upsert ⭐

> **As the operator**, I need reruns to leave the database in an identical state, **so that** geocoded coordinates — the most expensive asset in the system — survive every pipeline run.

**Acceptance criteria:** PRD-SE-100 §3, FR-108 scenario. Additionally:
```gherkin
Given establishments with populated geocode columns and one with geocode_locked set
When a full ingest runs
Then every geocode column retains its prior value
And the locked row is untouched
And no ingest statement uses REPLACE semantics
```

**Non-goals:** the ETL must never write `geom`, `geocode_confidence`, `geocode_source`, or `geocode_at` (IFC-1.P1).

**Audit reference:** F4. `INSERT OR REPLACE` omitting coordinate columns destroyed every coordinate on each rebuild.

---

### SE-105 — Unpivot wide violation columns `[E]`

> `[E]` Transform the 58 per-code violation columns into one row per observed violation, **enabling** FR-503 plain-language rendering and all scoring — *without which* violation detail cannot be queried at all.

**Acceptance criteria:**
```gherkin
Given an inspection row with counts in several violation columns
When transformed
Then one row exists per violation code with count greater than zero
And no row exists for a zero count
And the code set version is stamped
And the sum of observations reconciles to the source total violation count
```

**Non-goals:** do not interpret or score codes here. Transformation only.

---

### SE-109 — Violation reference in plain English

> **As a careful planner**, I want violations described in language I understand, **so that** I can tell "food held at unsafe temperature" from "light shield missing" without regulatory knowledge.

**Acceptance criteria:** every in-use code has a short label and a consumer-facing description; severity tier recorded; codes 45–49 flagged reporting-only; codes 50 and 52 flagged administrative.

**Note:** this is the designated fallback work when an external dependency blocks progress (DEP-SE-001 §5). It needs only a schema and a text editor. **Protect it — do not spend it early for variety.**

---

## 9. E2 — Location Accuracy ⭐ **The differentiator**

> **Epic goal:** every displayed pin is on the right building.

**Value type:** user, and the reason the product exists. Charter §1.2 establishes accuracy of place as the defensible claim.

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-201 | Normalize addresses ⚠️ low confidence | 8 | 8 | FR-201 | T13 | SE-106 |
| SE-202 | Cache geocode results | 2 | 3 | FR-204 | T14 | SE-101 |
| SE-203 | Resolve via free batch geocoder | 5 | 6 | FR-202 | T15 | SE-201, SE-202 |
| SE-204 | Paid fallback with confidence mapping | 3 | 5 | FR-202, FR-203 | T16 | SE-203 |
| **SE-205** | **Preserve manual overrides** | 1 | 2 | FR-207 | T17 | SE-204 |
| SE-206 | Review queue for failures | 1 | 2 | FR-208 | T17 | SE-204 |
| SE-207 | Geocode the full county | 1 | 2 | FR-209 | T18 | SE-204 |
| **SE-208** | **Verify pin accuracy — Gate 2** | 3 | 4 | NFR-06 | T19 | SE-207 |

### SE-201 — Normalize addresses ⚠️

> **As a deciding diner**, I want the pin on the actual storefront rather than the plaza entrance, **so that** I'm judging the restaurant I'm about to walk into.

**Acceptance criteria:** abbreviations standardized to postal conventions; secondary unit designators extracted and retained separately; leading plaza and center names stripped; low parse confidence routed to review rather than guessed.

**Estimate confidence: LOW (±100%).** Address pathology is unknown until SE-004 and SE-002. **Re-estimate at Gate 0.** This is the single most likely story to blow its estimate.

---

### SE-204 — Paid fallback with confidence mapping

> `[E]` Resolve addresses the free geocoder missed and assign a confidence score per published mapping, **enabling** FR-205 suppression — *without which* there is no basis for distinguishing a trustworthy pin from a guess.

**Acceptance criteria:**
```gherkin
Given an address the free tier could not resolve
When the paid geocoder returns a result
Then confidence is assigned from the precision indicator per the published mapping
And a result below the display threshold is stored but not shown on the map

Given an address neither tier can resolve
Then no position is stored
And confidence is recorded as zero
And the record remains eligible for retry
```

**Non-goals:** **never write a sentinel coordinate** (IFC-2.P1). No `(0,0)`, no placeholder, no default.

**Audit reference:** F5. v1 wrote `(0,0)` on failure — a real location in the Gulf of Guinea that passed every null check and permanently blocked retry.

---

### SE-205 — Preserve manual overrides ⭐

> **As the operator**, I need hand-corrected coordinates to survive every pipeline run, **so that** fixing a pin is permanent rather than something that quietly reverts next Monday.

**Acceptance criteria:** PRD-SE-100 §4, FR-207 scenario.

**Small story, disproportionate importance.** Two hours. Without it, every manual correction is temporary, the review queue is pointless, and the accuracy gate cannot be recovered by hand.

---

### SE-208 — Verify pin accuracy ⭐ **GATE 2**

> **As the sponsor**, I need proof that pins are where they claim to be, **so that** the product's central claim is measured rather than assumed.

**Acceptance criteria:**
```gherkin
Given a seeded random sample of 100 map-displayed establishments
When each is verified by hand against satellite imagery
Then at least 99 fall within 50 metres
And the seed, pass rate, and every failure with its cause are recorded
```

**Non-goals:** the sample may not be redrawn. The threshold may not be adjusted. The sample size may not be reduced.

**Failure blocks the project, not the sprint** (CHR-SE-001 §2). Escalates to sponsor.

---

## 10. E3 — Safety Signal

> **Epic goal:** a signal readable in one second and defensible under challenge.

⚠️ **Blocked on decision D-001.** Stories are written neutral on whether the output is a letter grade or a severity band. The PM recommendation is bands plus factual statements. **Resolve before Sprint 4.**

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| **SE-301** | **Map every disposition explicitly** | 1 | 2 | FR-302 | T20 | SE-106 |
| SE-302 | Derive signal from latest inspection | 1 | 2 | FR-301 | T20 | SE-301 |
| SE-303 | Exclude reporting-only violations | 1 | 1 | FR-303 | T20 | SE-109 |
| SE-304 | Decay signal as inspection ages | 1 | 1 | FR-304, FR-305 | T20 | SE-302 |
| SE-305 | Property tests for scoring invariants | 3 | 4 | FR-306 | T21 | SE-304 |
| SE-306 | Batch recompute for all establishments | 2 | 3 | FR-306 | T22 | SE-304 |

### SE-301 — Map every disposition explicitly ⭐

> **As a deciding diner**, I want a restaurant that passed inspection to actually show as passing, **so that** the map tells me something instead of showing everything as unknown.

**Acceptance criteria:** PRD-SE-100 §5, FR-302 scenario.

**Audit reference:** F12. v1 matched substrings for "fail", "warning", "satisfactory". Against real dispositions, **none of its 50,207 clean inspections rendered green** and none of its emergency orders rendered red. Two hours of work fixes the single most visible defect in v1.

---

### SE-303 — Exclude reporting-only violations

> **As a restaurant operator**, I need fire-extinguisher and exit-sign findings kept out of my food safety signal, **so that** I'm not penalized for things unrelated to food safety.

**Acceptance criteria:** PRD-SE-100 §5, FR-303 scenario.

**One hour, and it is a fairness requirement.** Codes 45–49 are recorded for reporting purposes and are not food safety findings. Scoring them systematically punishes establishments for the wrong thing.

---

### SE-305 — Property tests for scoring invariants `[E]`

> `[E]` Prove the scoring invariants hold across generated inputs, **enabling** confident formula changes — *without which* a tuning change could silently invert the signal.

**Acceptance criteria:** score always within bounds; adding any violation never improves the signal; reporting-only codes produce zero delta; identical inputs produce identical output.

**The monotonicity test is the one that matters.** If it fails, you have a defamation problem, not a bug.

---

## 11. E4 — Proximity Discovery ⭐ **The primary user value**

> **Epic goal:** a diner sees what's around them and how each place did, in seconds, on a phone.

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| **SE-401** | **Viewport query endpoint** | 3 | 4 | FR-402, FR-403 | T23 | SE-306 |
| SE-402 | Name search endpoint | 2 | 3 | FR-407 | T24 | SE-306 |
| **SE-403** | **Map with clustered establishments** | 8 | 8 | FR-401, FR-405 | T26 | SE-401 |
| SE-404 | Signal by colour and shape | 2 | 3 | FR-404, NFR-09 | T27 | SE-403 |
| SE-405 | Summary card on selection | 2 | 3 | FR-406 | T28 | SE-403 |
| SE-406 | Search interface | 1 | 2 | FR-407 | T30 | SE-402, SE-403 |
| SE-407 | Verify query performance at scale | 3 | 4 | NFR-01 | T25 | SE-401 |

### SE-401 — Viewport query endpoint ⭐

> **As a deciding diner**, I want the map to load what's around me quickly, **so that** I get an answer before I lose patience and give up.

**Acceptance criteria:** PRD-SE-100 §6, FR-402 and FR-403 scenarios.

**Non-goals** (IFC-4): no outbound third-party call on the request path. No score computed at request time. No unbounded query. The database is the sole authority on which establishments exist.

**Audit reference:** F1 and F4. v1's map was driven by Google Places results, and `/api/restaurants/all` returned 64,110 rows with no `WHERE` and no `LIMIT`.

---

### SE-403 — Map with clustered establishments

> **As a deciding diner**, I want to see nearby restaurants on a map without it becoming an unreadable mass of pins, **so that** I can actually pick one.

**Acceptance criteria:** map is the landing view, centered on location or county default; individually rendered markers bounded; clusters show count and worst-signal indication; positions derive solely from stored coordinates.

**8 points — the largest story here.** Splittable if it proves difficult: base map → clustering → interaction. Split on contact rather than pre-emptively.

---

### SE-404 — Signal by colour and shape

> **As a diner with colour vision deficiency**, I want to distinguish signal levels without relying on colour, **so that** the map works for me at all.

**Acceptance criteria:** PRD-SE-100 §6, FR-404 scenario.

**Accessibility requirement, not a nice-to-have.** NFR-09 makes it absolute.

---

## 12. E5 — Establishment Detail

> **Epic goal:** the careful planner gets the actual findings, in plain language, with a path to the official record.

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-501 | Establishment detail page | 3 | 4 | FR-501, FR-502, FR-504, FR-505 | T29 | SE-405 |
| SE-502 | Render violations in plain language | 1 | 2 | FR-503 | T29 | SE-501, SE-109 |
| SE-503 | Methodology page | 1 | 2 | FR-602 | T31 | SE-304 |

### SE-503 — Methodology page

> **As a restaurant operator**, I want to see exactly how my signal was calculated, **so that** I can check the work rather than take it on faith.

**Acceptance criteria:** plain language, includes weights and a worked example, versioned to match the formula, linked from every page displaying a signal.

**Governance rule:** any change to the scoring formula updates this page **in the same commit**. A formula change without a methodology update is not shippable.

---

## 13. E6 — Trust & Compliance

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-601 | Data-as-of date, disclaimers, attribution | 1 | 1 | FR-601, FR-604, FR-605 | T35 | SE-501 |
| SE-602 | Correction request mechanism | 1 | 1 | FR-606, FR-608 | T35 | SE-501 |
| **SE-603** | **Secure endpoints and credentials** | 2 | 3 | FR-607, NFR-15, NFR-16 | T34 | SE-111 |

### SE-601 — Data-as-of date, disclaimers, attribution

> **As a diner**, I want to know how current this information is, **so that** I'm not trusting a stale record without knowing it's stale.

**Acceptance criteria:** PRD-SE-100 §8, FR-601 scenario. Plus non-affiliation disclaimer and source attribution site-wide, and the state snapshot disclaimer on detail pages.

**One hour, and it is the direct countermeasure to v1's defining failure.** v1 served three-year-old data with no indication it was old.

---

### SE-603 — Secure endpoints and credentials ⭐

> **As a restaurant operator**, I need it to be impossible for a stranger to move my pin, **so that** the map can't be vandalized to misrepresent my business.

**Acceptance criteria:** PRD-SE-100 §8, FR-607 scenario. Every route enumerated and classified; application database role read-only; keys restricted by referrer and API; billing caps configured.

**Audit reference:** F6. v1 exposed two unauthenticated POST endpoints, one writing coordinates. **Verify by enumerating every route**, not by recalling that you didn't add one.

---

## 14. E7 — Launch Readiness

| ID | Story | Pts | Hrs | Req | Task | Depends |
|---|---|---|---|---|---|---|
| SE-701 | Accessibility audit and remediation | 3 | 4 | NFR-08, NFR-10 | T32 | SE-501 |
| SE-702 | Performance optimization to targets | 2 | 3 | NFR-02–04 | T33 | SE-407, SE-701 |
| SE-703 | Deploy to production | 1 | 2 | — | T36 | SE-702, SE-603 |
| SE-704 | Observe two unattended cycles | 1 | 2 | FR-701, NFR-05 | T37 | SE-703 |
| SE-705 | Retrospective | 1 | 2 | O1 | T38 | SE-704 |

### SE-705 — Retrospective

> **As the sponsor**, I need an honest written account of how this went, **so that** the professional objective actually pays out rather than evaporating.

**Acceptance criteria:** the six questions in PMP-SE-002 §9 answered in writing; estimation calibration recorded per confidence band; every materialized risk noted along with whether its leading indicator fired.

**This story is the charter's primary objective.** Skipping it means the project delivered a website and nothing else.

---

## 15. Sprint plan

**Two-week sprints. 24 hours capacity ≈ 17 points.**

| Sprint | Wks | Stories | Hrs | Gate |
|---|---|---|---|---|
| **S1** | 1–2 | SE-001, **SE-002**, SE-003, SE-004, SE-101, SE-102 | 19 | **Gate 0** |
| **S2** | 3–4 | SE-103, SE-104, SE-105, SE-106, SE-107, SE-108 | 22 | |
| **S3** | 5–6 | SE-110, SE-111, SE-202, SE-201 | 22 | **Gate 1** |
| **S4** | 7–8 | SE-203, SE-204, SE-205, SE-206, SE-207, **SE-208** | 21 | **Gate 2** ⭐ |
| **S5** | 9–10 | SE-301–306, SE-401, SE-402, SE-109 | 24 | **Gate 3** |
| **S6** | 11–12 | SE-403, SE-404, SE-405, SE-406, SE-407 | 20 | |
| **S7** | 13–14 | SE-501, SE-502, SE-503, SE-601, SE-602, SE-603, SE-701 | 17 | **Gate 4** |
| **S8** | 15–16 | SE-702, SE-703, SE-704, SE-705 | 9 | **Gates 5–6** |

| | |
|---|---|
| Committed work | 150 hours |
| Capacity, 8 sprints | 192 hours |
| **Management reserve** | **42 hours (22%)** |

**This resolves the reserve problem from EXP-SE-001 §7.** Eight two-week sprints gives 22% reserve — above the 15–20% target — and it means committing to 16 weeks rather than 12.

If 16 weeks is unacceptable, seven sprints yields 18 hours reserve (11%), which is below target and thin for a project with six low-confidence stories. **Seven sprints is defensible only if SE-002 comes back above 95**, retiring the largest uncertainty in Week 1.

**Sprint 8 is deliberately light at 9 hours.** That is the buffer. If earlier sprints run over — and one will — the overflow lands here rather than off the end of the project.

---

## 16. Backlog management

**Sprint planning (30 min, start of sprint):** confirm each story meets Definition of Ready; adjust for measured velocity, not planned; commit to a sprint goal in one sentence.

**Sprint review (30 min, end of sprint):** demonstrate against acceptance criteria; record actual hours per story; compute point-hour calibration; update the forecast from actuals.

**Refinement (15 min, mid-sprint):** bring the next sprint's stories to Ready; re-estimate anything that has learned something; split any story now looking larger than 5 points.

### Rules

1. **A story that isn't Ready doesn't enter a sprint.** No exceptions — this is the rule that protects PT-06 brief quality.
2. **Don't split a story mid-sprint to claim partial completion.** It's either done or it carries.
3. **Re-estimate from actuals after Sprint 2.** The 1.4 h/point calibration is a hypothesis.
4. **New work is a change request**, funded from reserve, per GOV-SE-001 §7.
5. **Never weaken acceptance criteria to close a story.** Carry it instead. This applies with no exceptions to SE-208.
