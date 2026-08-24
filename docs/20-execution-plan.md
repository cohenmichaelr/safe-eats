# Execution Plan — Safe Eats v2

| Field | Value |
|---|---|
| Document ID | EXP-SE-001 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Owner | Technical Program Manager |
| Governs | Schedule, sequencing, resource loading, execution risk |
| Traces from | CHR-SE-001, PMP-SE-002 |

---

## 1. Headline findings

Three things came out of the schedule analysis that the project plan did not surface.

### 1.1 The plan is over-committed with zero reserve

| Measure | Value |
|---|---|
| Total decomposed work | **150 hours** |
| Available capacity (12 hrs/wk × 12 wk) | 144 hours |
| Overrun | **6 hours (104% loaded)** |
| Management reserve | **0 hours (0%)** |

A plan loaded at 104% is not a plan. Standard practice is 15–20% reserve for a project with this much technical uncertainty, which here means roughly 22–30 hours held back and unallocated.

**Every hour of the 150 is committed to a named deliverable.** The first task that runs long — and one will — consumes schedule that does not exist, and the overrun propagates to every downstream task because there is only one resource.

Three ways out, in §7. A decision is required before Week 1.

### 1.2 Float does not buy you time — it buys you sequencing freedom

Critical path is **98 hours (65% of total work)**, leaving 52 hours of float. On a team project that float would be parallelism: assign it to someone else and compress the schedule.

**With one resource, that is not available.** Duration is governed by total work divided by rate — 150 ÷ 12 ≈ 12.5 weeks — regardless of the network structure. Classical CPM assumes unlimited resources. You have one.

So the float pool is worth something different, and it is worth a great deal: **52 hours of work that can be pulled forward or pushed back when something blocks you.** If the DBPR endpoint is down on a Tuesday, you have 52 hours of work that does not need DBPR. That is your resilience against external dependency failure (see [Dependency Register](21-dependency-register.md)), and it should be managed deliberately rather than discovered accidentally.

**Rule: never spend float work early unless blocked.** Float consumed for convenience in Week 3 is unavailable as recovery in Week 9.

### 1.3 The riskiest task is scheduled after 51 hours of committed work

The geocoding accuracy audit (T19, Gate 2) sits at hour 51 on the critical path — roughly Week 5. It is simultaneously:

- the highest-uncertainty item in the plan (you have never geocoded these addresses; v1 provides no signal at 24 records, all externally supplied),
- the product differentiator (charter §1.2),
- and the only gate whose failure stops rather than delays the project.

Discovering it is unachievable at hour 51 means 51 hours spent to learn something a 4-hour probe could have told you at hour 3.

**This is a sequencing error, and it is corrected in §3.**

---

## 2. Critical path

```
T01 → T04 → T05 → T06 → T07 → T08 → T13 → T15 → T16 → T18 → T19 → T20
    → T22 → T23 → T26 → T28 → T29 → T32 → T33 → T36 → T37 → T38
```

| Seq | ID | Task | Hrs | Cum |
|---|---|---|---|---|
| 1 | T01 | Validate DBPR sources & schema | 3 | 3 |
| 2 | T04 | Data profile + decisions D-002/D-004 | 2 | 5 |
| 3 | T05 | Schema + migrations | 4 | 9 |
| 4 | T06 | Extractor: fetch, archive, assert | 7 | 16 |
| 5 | T07 | Transformer: county filter, unpivot | 8 | 24 |
| 6 | T08 | Loader: idempotent upsert | 6 | 30 |
| 7 | T13 | Address normalizer | 8 | 38 |
| 8 | T15 | Census geocoder integration | 6 | 44 |
| 9 | T16 | Google fallback + confidence mapping | 5 | 49 |
| 10 | T18 | County geocode backfill run | 2 | 51 |
| 11 | **T19** | **Accuracy audit — Gate 2** | 4 | **55** |
| 12 | T20 | Scoring algorithm | 6 | 61 |
| 13 | T22 | Batch score recompute | 3 | 64 |
| 14 | T23 | Viewport query endpoint | 4 | 68 |
| 15 | T26 | Map view + clustering | 8 | 76 |
| 16 | T28 | Summary card | 3 | 79 |
| 17 | T29 | Detail page | 6 | 85 |
| 18 | T32 | Accessibility audit + remediation | 4 | 89 |
| 19 | T33 | Performance optimization | 3 | 92 |
| 20 | T36 | Deploy production | 2 | 94 |
| 21 | T37 | Observe two ETL cycles | 2 | 96 |
| 22 | T38 | Retrospective | 2 | 98 |

**Structural observation.** The critical path passes through the entire data chain before touching anything user-visible. Twelve of twenty-two critical tasks complete before the first pixel renders. This is correct — it is the deliberate correction to v1 — but it means **you will spend eleven weeks with nothing to show.** Plan for that psychologically. The urge to jump to T26 will peak around Week 5, which is exactly when the geocoding work is hardest and least rewarding.

### Float pool

| ID | Task | Hrs | Float | Blocked by |
|---|---|---|---|---|
| T03 | Repo + Claude Code config | 3 | 95 | nothing |
| T02 | Geocoding spike | 4 | 91 | T01 |
| T10 | Backfill 3 years | 3 | 65 | T08 |
| T12 | Violation reference + plain English | 6 | 64 | T05 |
| T09 | Ingest logging + anomaly detection | 3 | 53 | T08 |
| T11 | Scheduled workflow | 3 | 53 | T09 |
| T34 | Security hardening | 3 | 53 | T11 |
| T17 | Review queue + lock flag | 4 | 45 | T16 |
| T21 | Property + unit tests | 4 | 33 | T20 |
| T31 | Methodology page | 2 | 27 | T20 (D-001) |
| T35 | Compliance copy + correction form | 2 | 27 | T31 |
| T25 | Performance test | 4 | 17 | T23, T24 |
| T24 | Search endpoint | 3 | 16 | T22 |
| T30 | Search UI | 2 | 7 | T24, T26 |
| T27 | Pin styling | 3 | 6 | T26 |

**T12 is the most valuable float item.** Six hours of writing plain-English violation descriptions, dependent only on the schema, with 64 hours of float. It requires no external service, no network, and no prior task beyond T05. **This is your designated fallback work whenever an external dependency fails.**

---

## 3. Corrective resequencing

### 3.1 Move the geocoding risk to Week 1

T02 (geocoding spike) has 91 hours of float, meaning the schedule does not care when it happens. **Risk does.**

> **Schedule by risk, not by float.** A task with large float and large uncertainty should be scheduled early, because its purpose is information, and information is worth most when the most decisions remain open.

**Amended Week 1:**

| Task | Hrs |
|---|---|
| T01 Validate DBPR sources & schema | 3 |
| **T02 Geocoding spike — 100 real addresses through the full cascade, verified by hand** | **4** |
| T04 Data profile + decisions D-002, D-004 | 2 |
| T03 Repo + Claude Code config | 3 |

The spike is a throwaway script. Pull 100 random Palm Beach addresses from the DBPR license extract, run them through Census then Google, verify positions by hand against satellite imagery, and record the hit rate.

**Decision rule at Gate 0:**

| Spike result | Action |
|---|---|
| ≥95 of 100 within 50m | Gate 2 is achievable. Proceed as planned. |
| 85–94 | Achievable with normalization work. Increase T13 from 8h to 14h and cut scope to pay for it. |
| 70–84 | At risk. Escalate to sponsor. Re-plan Phase 2 before committing to Phase 1. |
| <70 | **Stop.** The differentiator may not be reachable. Sponsor decision on continuing at all. |

Four hours in Week 1 to de-risk the item that can end the project. This is the single highest-value change in this document.

### 3.2 Gates govern release, not work scheduling

The project plan states no phase begins until the prior gate passes. Read strictly, that forbids using the float pool — you could not write violation descriptions in Week 3 because that is "Phase 4 work."

**That reading makes the 52-hour float pool unusable and should be corrected.**

| Revised rule | |
|---|---|
| **Gates control what ships** | Nothing from a phase is released until its gate passes |
| **Gates do not control what you work on** | Any unblocked task may be worked at any time |
| **Exception: Gate 2** | No frontend work consuming more than 4 hours before Gate 2 passes, because that work is worthless if the project stops there |

The exception preserves the intent — don't invest in the map before you know the map can be accurate — without freezing 52 hours of usable buffer.

---

## 4. Resource-constrained schedule

Duration is governed by total work ÷ rate, not by critical path length. At 12 hrs/week and 150 hours of work, minimum duration is **12.5 weeks** with zero absorbed variance.

| Wk | Cum hrs | Planned work | Gate |
|---|---|---|---|
| 1 | 12 | T01, **T02 (spike)**, T04, T03 | **Gate 0** |
| 2 | 24 | T05, T06 (partial) | |
| 3 | 36 | T06, T07 | |
| 4 | 48 | T07, T08, T09 | |
| 5 | 60 | T10, T11, T13 (partial) | **Gate 1** |
| 6 | 72 | T13, T14, T15 | |
| 7 | 84 | T16, T17, T18, **T19** | **Gate 2** |
| 8 | 96 | T20, T21, T22 | **Gate 3 (D-001)** |
| 9 | 108 | T23, T24, T25, T26 (partial) | |
| 10 | 120 | T26, T27, T28 | |
| 11 | 132 | T29, T30, T31, T12 | **Gate 4** |
| 12 | 144 | T32, T33, T34, T35 | **Gate 5** |
| **13** | **150** | **T36, T37, T38 — overrun** | **Gate 6** |

**Gate 2 lands in Week 7, not Week 6** once the schedule is resource-constrained rather than phase-blocked. The original plan's Week 6 target assumed parallelism that a single resource cannot deliver.

**Launch lands in Week 13, not Week 12.** That is with zero variance absorbed. It is the honest number.

---

## 5. Schedule risk

| ID | Risk | Effect | Response |
|---|---|---|---|
| SR-1 | **Zero management reserve** | First overrun propagates fully to launch | **§7 decision required before Week 1** |
| SR-2 | Single resource — no parallelism, no cover | Any absence stops all progress | Phases are independently valuable; each gate is a safe stop |
| SR-3 | 65% of work is on the critical path | Two-thirds of tasks slip the end date directly | Protect float; do not spend it early |
| SR-4 | T13 normalizer estimate is soft | Address pathology is unknown until T04 | T02 spike gives an early read; re-estimate at Gate 0 |
| SR-5 | Gate 2 has no float and stops the project | Terminal, not recoverable | Mitigated by moving T02 to Week 1 |
| SR-6 | External dependency failure blocks critical path | Idle time | Float pool is designated fallback work (§2) |
| SR-7 | 12 hrs/week is an estimate, not a commitment | Duration scales inversely | Track actuals weekly from Week 1; re-forecast at Gate 1 |

---

## 6. Estimation confidence

Not all estimates deserve equal trust. Stated so that variance is interpreted correctly rather than treated as uniform failure.

| Confidence | Tasks | Basis | Treatment |
|---|---|---|---|
| **High (±20%)** | T01, T03, T05, T09, T10, T11, T31, T35, T36, T37, T38 | Well-understood, bounded, done before | Estimate is the plan |
| **Medium (±50%)** | T06, T07, T08, T12, T14, T20, T21, T22, T23, T24, T32, T33, T34 | Understood in shape, unknown in detail | Expect variance; absorb from reserve |
| **Low (±100%)** | **T13, T15, T16, T17, T18, T19, T26** | Depends on data quality and library behavior you have not observed | **T02 spike exists specifically to convert these to Medium** |

**Six of seven low-confidence tasks are the geocoding chain, and all six are on the critical path.** That concentration is the project's central execution risk, and it is the reason §3.1 matters more than anything else in this document.

---

## 7. Decision required before Week 1

The plan is 104% loaded with 0% reserve. Three options; one must be chosen.

### Option A — Cut scope to create reserve

Drop all Should-tier requirements from v1.0. Recovers roughly 26 hours: FR-110, FR-111, FR-208, FR-209, FR-307, FR-409–411, FR-506–508, FR-608, FR-705, FR-706.

- **For:** Holds the 12-week date. Creates ~18% reserve. Must-tier alone is a coherent product.
- **Against:** Loses the anomaly detection (FR-110) that guards against v1's silent-staleness failure, and the review queue (FR-208) that makes the accuracy gate recoverable. **Neither should be cut** — which means the real recovery is closer to 16 hours and ~11% reserve.
- **Verdict:** Viable but thin, and it cuts two requirements that specifically defend against known v1 failures.

### Option B — Extend to 15 weeks

150 hours of work plus 27 hours reserve = 177 hours ≈ 15 weeks at 12 hrs/week.

- **For:** Full scope. Honest 18% reserve. No requirement sacrificed.
- **Against:** 25% longer. Sustaining a solo project past three months is its own risk (SR-2).
- **Verdict:** Most honest. The date was an assumption, not a constraint — charter C2 fixes duration, but C2 was written before this analysis existed and is amendable.

### Option C — Increase to 15 hrs/week for 12 weeks

180 hours capacity, 30 hours reserve.

- **For:** Holds date and scope.
- **Against:** Assumption A2 was 12 hrs/week. Raising it by 25% without evidence converts a schedule problem into a burnout problem, and SR-2 says an absence stops everything.
- **Verdict:** Only if 15 hrs/week is genuinely available. Do not choose this to avoid choosing B.

### TPM recommendation

**Option B, with a re-forecast at Gate 1.**

The 12-week figure was an estimate produced before the work was decomposed. Decomposition says 150 hours. Defending an estimate against its own decomposition is how projects arrive at Week 11 with 40% of the work remaining.

Track actual hours from Week 1. At Gate 1 you will have four weeks of real velocity data, and the forecast should be rebuilt from it rather than from A2. If actual velocity is 14 hrs/week, Option B lands early. If it is 9, you will know in Week 5 rather than Week 11.

This is a charter amendment to constraint C2 and requires sponsor approval.

---

## 8. Weekly execution mechanics

**Monday PM hour, editor closed:**

1. Record actual hours worked last week against planned. Compute variance.
2. Update task status: not started, in progress, complete, blocked.
3. Recompute forecast completion from actual velocity, not from plan.
4. Review float consumed. If float was spent without being blocked, that is a finding.
5. Check gate criteria for any gate within two weeks.
6. Review dependency health ([Dependency Register](21-dependency-register.md) §6).
7. Write the status report ([Status & Governance](24-status-and-governance.md)).

**Blocked-task protocol.** When blocked by an external dependency: log it with a timestamp, switch to the highest-float unblocked task, and do not idle. Record blocked hours separately from worked hours — blocked time is dependency data, not lost capacity, and it is the evidence base for §6 of the dependency register.

**Task entry criteria.** No task starts without: its requirement ID, its acceptance criteria, its interface contract reference ([Interface Contracts](23-interface-contracts.md)), and its estimate recorded. This is the Definition of Ready, and it applies to work you brief to Claude Code as much as to work you do yourself.
