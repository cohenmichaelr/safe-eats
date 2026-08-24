# Requirements Traceability Matrix — Safe Eats v1.0

| Field | Value |
|---|---|
| Document ID | RTM-SE-001 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Owner | Product Manager |

---

## 1. Purpose

Establishes the chain from business objective to verification for every requirement, in both directions:

- **Forward** — every charter objective is served by at least one requirement, and every requirement is verified.
- **Backward** — every requirement traces to an objective. A requirement with no parent is scope creep with a document number.

Reviewed at every phase gate. Coverage of Must requirements is a Gate 4 criterion.

**Trace chain:**

```
Charter Objective → Discovery Principle → Requirement → Design → Verification → Gate
```

---

## 2. Forward trace — objectives to requirements

| Obj | Statement | Requirements | Gate |
|---|---|---|---|
| O1 | Full lifecycle in both roles | *(process objective — traced in §6)* | All |
| O2 | DBPR as sole authoritative source | FR-101…107, FR-704 | 1 |
| O3 | Location accuracy for proximity decisions | FR-201…210, NFR-06 | **2** |
| O4 | Answer in under five seconds | FR-401…413, NFR-01…04, NFR-13 | 4 |
| O5 | Substantially complete coverage | FR-102, FR-104, FR-209, NFR-07 | 1 |
| O6 | Unattended operation | FR-108, FR-109, FR-701…707, NFR-05, NFR-11 | 6 |
| O7 | Defensible publication | FR-301…308, FR-501…510, FR-601…608, NFR-08…10, NFR-15, NFR-16 | 5 |

**Coverage check:** every objective except O1 has requirement coverage. O1 is verified by artifact completeness and gate discipline (§6).

---

## 3. Backward trace — requirements to objectives and verification

Legend — **Method:** AT automated test · IT integration test · MT manual test · PT performance test · MA manual audit · IR inspection/review · PR property test

### E1 — Data Pipeline Integrity

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-101 | M | O2 | SP6 | TRD §2.1, §3.1 | IT | Scheduled run completes unattended; row counts recorded | 1 |
| FR-102 | M | O2, O5 | SP6 | TRD §3.2 | IT | License extract loaded; count reconciles to source | 1 |
| FR-103 | M | O2 | SP6 | TRD §3.3 | IT | Closure file loaded; missing-file case handled without abort | 1 |
| FR-104 | M | O5 | SP7 | TRD §3.4 | AT | Query returns zero non-60 rows; pre/post counts logged | 1 |
| FR-105 | M | O2 | SP6 | TRD §3.4 | AT | Archive object exists with fetch timestamp before parse | 1 |
| FR-106 | M | O2 | SP6 | TRD §3.4 | AT | Malformed-header fixture aborts run | 1 |
| FR-107 | M | O2 | SP6 | TRD §3.4 | AT | **HTML-payload fixture aborts; no table modified** | 1 |
| FR-108 | M | O6 | SP6 | TRD §4.2 | AT | Double-run produces identical state incl. geocode columns | 1 |
| FR-109 | M | O6 | SP6 | TRD §4.1 | AT | Run record complete for success and failure paths | 1 |
| FR-110 | S | O6 | SP6 | TRD §3.4 | AT | Anomalous-count fixture aborts and alerts | 1 |
| FR-111 | S | O5 | — | TRD §3.1 | IT | FY2016+ loaded; resumable after interruption | 1 |
| FR-112 | C | O7 | SP4 | TRD §3 | IT | Disciplinary records loaded and linked | — |

### E2 — Location Accuracy

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-201 | M | O3 | SP1 | TRD §5.1 | AT | Pathological-address fixtures normalize correctly | 2 |
| FR-202 | M | O3 | SP1 | TRD §5.2 | IT | Each cascade tier exercised; order verified | 2 |
| FR-203 | M | O3 | SP1 | TRD §5.3 | AT | Confidence, source, timestamp present on every resolution | 2 |
| FR-204 | M | O3 | SP3 | TRD §4.1 | AT | Second run of unchanged data makes zero external calls | 2 |
| FR-205 | M | O3 | **SP1** | TRD §5.3 | IT | Below-threshold absent from map, present in search, labeled | 2 |
| FR-206 | M | O3 | SP1, SP6 | TRD §4.2 | AT | Failure yields null position, zero confidence, retry-eligible | 2 |
| FR-207 | M | O3 | SP1 | TRD §4.2 | AT | **Manual coordinates survive full cycle** | 2 |
| FR-208 | S | O3 | SP1 | TRD §5.2 | MT | Queue lists failures and low-confidence records | 2 |
| FR-209 | S | O5 | — | TRD §5.2 | AT | Coverage query ≥98% | 2 |
| FR-210 | C | O3 | SP1 | TRD §5.2 | IT | Matches require both name similarity and proximity | — |
| **NFR-06** | **M** | **O3** | **SP1** | TRD §5.4 | **MA** | **Seeded 100-sample audit: ≥99 within 50m** | **2** |

### E3 — Safety Signal

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-301 | M | O7 | SP4 | TRD §6.1 | AT | Latest completed visit selected incl. callbacks | 3 |
| FR-302 | M | O7 | SP4, SP6 | TRD §6.1 | AT | **All observed dispositions map; unknown raises** | 3 |
| FR-303 | M | O7 | SP4 | TRD §6.1 | AT | Reporting-only codes produce zero delta | 3 |
| FR-304 | M | O7 | SP5 | TRD §6.2 | AT | Score converges toward neutral as age increases | 3 |
| FR-305 | M | O7 | SP5 | TRD §6.4 | AT | >36 months yields non-score state | 3 |
| FR-306 | M | O4 | SP3 | TRD §4.1 | PT | No score computation observed on request path | 3 |
| FR-307 | S | O7 | SP4 | TRD §4.1 | AT | Version stamped on every stored score | 3 |
| FR-308 | C | O7 | SP4 | TRD §6.1 | AT | Repeat codes across consecutive visits detected | — |
| — | M | O7 | SP4 | TRD §7 | **PR** | **Monotonicity: added violation never improves score** | 3 |

### E4 — Proximity Discovery

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-401 | M | O4 | SP2 | TRD §2.1 | MT | Map is landing view; centers on location or default | 4 |
| FR-402 | M | O4 | SP3 | TRD §4.4 | PT | Payload proportional to viewport | 4 |
| FR-403 | M | O4 | **SP2** | TRD §2.3, §4.4 | IT | **Displayed set derives solely from own database** | 4 |
| FR-404 | M | O4 | — | TRD §2.1 | MT | Signal distinguishable in grayscale | 4 |
| FR-405 | M | O4 | SP3 | TRD §2.1 | PT | Individual markers bounded at low zoom | 4 |
| FR-406 | M | O4 | SP5 | TRD §2.1 | MT | Card shows name, address, signal, date, plain line | 4 |
| FR-407 | M | O4 | — | TRD §4.3 | IT | Partial and imprecise input returns expected results | 4 |
| FR-408 | M | O4 | SP2 | TRD §2.1 | MT | One-handed use at 375px on real device | 4 |
| FR-409 | S | O4 | — | TRD §4.4 | IT | Filter narrows result set correctly | 4 |
| FR-410 | S | O4 | — | TRD §4.4 | IT | Recent-closure filter returns expected set | 4 |
| FR-411 | S | O4 | — | TRD §5 | MT | Address input recenters map | 4 |
| FR-412 | C | O4 | — | — | MT | Distance-sorted list | — |
| FR-413 | C | O4 | — | TRD §4.4 | MT | Pan triggers re-query | — |
| NFR-01 | M | O4 | SP3 | TRD §4.4 | PT | p95 <300ms, full dataset | 3 |
| NFR-02 | M | O4 | SP3 | TRD §2.1 | PT | Interactive <2.5s throttled 4G | 5 |
| NFR-04 | M | O4 | SP3 | — | MT | <5s cold to first answer, real device | 5 |
| NFR-13 | M | O4 | SP2 | — | MT | One-handed at 375px | 5 |

### E5 — Establishment Detail

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-501 | M | O7 | — | TRD §2.1 | IT | Stable URL; server-rendered; shareable | 4 |
| FR-502 | M | O7 | SP5 | TRD §4.1 | IT | History complete, ordered, tiered counts correct | 4 |
| FR-503 | M | O7 | SP4 | TRD §4.1 | MT | Plain language; tier labeled; no bare codes | 4 |
| FR-504 | M | O7 | SP4 | TRD §3.2 | MT | Link resolves to state record | 4 |
| FR-505 | M | O7 | SP5 | — | IR | Snapshot disclaimer present | 4 |
| FR-506 | S | O7 | SP5 | TRD §4.1 | IT | Closure banner with dates and condition | 4 |
| FR-507 | S | O7 | SP4 | TRD §6 | MT | Components reconcile to displayed score | 4 |
| FR-508 | S | O7 | SP5 | — | MT | Elapsed time in plain language | 4 |
| FR-509 | C | O7 | SP4 | TRD §4.1 | IT | Disciplinary actions displayed | — |
| FR-510 | C | O7 | SP5 | — | MT | Trend across inspections | — |
| NFR-03 | M | O4 | SP3 | — | PT | LCP <2.0s on 4G | 5 |
| NFR-14 | M | O7 | — | TRD §2.1 | IR | Pages indexable | 5 |

### E6 — Trust & Compliance

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-601 | M | O6, O7 | **SP6** | TRD §8 | MT | As-of date on every data page | 5 |
| FR-602 | M | O7 | SP4 | TRD §6 | IR | Methodology page with worked example | 5 |
| FR-603 | M | O7 | SP4 | TRD §4.1 | IT | Source and ingest date traceable per fact | 5 |
| FR-604 | M | O7 | — | — | IR | Non-affiliation disclaimer site-wide | 5 |
| FR-605 | M | O7 | — | — | IR | Source attribution present | 5 |
| FR-606 | M | O7 | — | — | MT | Correction mechanism functional; commitment stated | 5 |
| FR-607 | M | O7 | — | TRD §8 | AT | **Unauthenticated modification rejected** | 5 |
| FR-608 | S | O7 | SP4 | — | IR | Correction vs. removal policy published | 5 |
| NFR-08 | M | O7 | — | — | AT+MT | axe-core clean; manual keyboard and SR pass | 5 |
| NFR-09 | M | O7 | — | — | MT | Grayscale review | 5 |
| NFR-10 | M | O7 | — | — | MT | List view functional without map | 5 |
| NFR-15 | M | O7 | — | TRD §8 | AT | History scan clean; hook blocks test key | 0 |
| NFR-16 | M | O7 | — | TRD §8 | IR | Application role read-only | 5 |

### E7 — Operability

| Req | Pri | Obj | Principle | Design | Method | Verification | Gate |
|---|---|---|---|---|---|---|---|
| FR-701 | M | O6 | — | TRD §2.1 | IT | Two consecutive unattended cycles | 6 |
| FR-702 | M | O6 | SP6 | TRD §8 | MT | Forced failure produces alert | 5 |
| FR-703 | M | O6 | SP6 | TRD §8 | IT | Failed run leaves prior data and date intact | 5 |
| FR-704 | M | O4, O6 | SP3 | **TRD §2.3** | IT | **No outbound third-party call during user request** | 3 |
| FR-705 | S | O6 | SP6 | TRD §4.1 | MT | Ingest history queryable | 5 |
| FR-706 | S | O6 | — | TRD §8 | AT | Rate limiting enforced | 5 |
| FR-707 | C | O6 | SP6 | — | MT | Health dashboard | — |
| NFR-05 | M | O6 | SP6 | TRD §2.1 | MT | Staleness ≤8 days | 6 |
| NFR-11 | M | O6 | — | — | MT | Uptime monitored | 6 |
| NFR-12 | M | — | — | TRD §2.1 | IR | Billing within budget | 6 |

---

## 4. Audit finding remediation trace

Confirms each v1 failure is structurally addressed rather than merely noted.

| Finding | v1 failure | Requirement | Verification |
|---|---|---|---|
| F1 | Map driven by Google Places; DB used only for pin color | **FR-403** | Displayed set derives solely from own database |
| F2 | Dead URL; three-year silent staleness; HTML committed as CSV | **FR-107, FR-601** | HTML payload aborts run; as-of date always displayed |
| F3 | Stable license key present but unused; fuzzy name matching | FR-108 (design: TRD §4.2) | Idempotent upsert on DBPR-provided key |
| F4 | `INSERT OR REPLACE` destroyed coordinates each rebuild | **FR-207, FR-108** | Manual coordinates survive full cycle |
| F5 | `(0,0)` written as failure sentinel; permanently unretryable | **FR-206** | Failure yields null position and remains retry-eligible |
| F6 | Two unauthenticated POST endpoints, one writing coordinates | **FR-607** | Unauthenticated modification rejected |
| F7 | License type codes mismapped | FR-102 (design: TRD §3.2) | Type mapping verified against DBPR code table |
| F8 | Hand-rolled CSV parsing on hardcoded indices; encoding bug | FR-106 | Header signature asserted; encoding fixture |
| F9 | Wrong geocoding API; no verification of returned place | FR-202, FR-203 | Cascade order and confidence scoring verified |
| F10 | 28MB database committed to Git | *Process — charter §11 action 4* | Fresh repository |
| F11 | Empty table joined in hot path | *Design — TRD §4* | Schema review |
| F12 | Substring matching; 50,207 clean inspections rendered blue | **FR-302** | All dispositions map; unknown raises |
| F13 | Hardcoded 10-page crawl limit capped coverage | FR-104, FR-209 | Coverage ≥98% |
| F14 | Zero tests | *Process — TRD §7* | Coverage threshold in CI |

**All fourteen findings have a named owner in the requirement set.** Nine map to a Must requirement; five are addressed by process or design rather than a testable requirement, which is recorded here so they are not assumed handled.

---

## 5. Gate coverage summary

| Gate | Wk | Requirements verified | Blocking |
|---|---|---|---|
| 0 | 1 | NFR-15; assumptions A1, A3, A6; decisions D-002, D-004 | Phase 1 |
| 1 | 3 | FR-101…111, FR-104, FR-209 | Phase 2 |
| **2** | **6** | **FR-201…209, NFR-06, NFR-07** | **Project** |
| 3 | 8 | FR-301…307, FR-704, NFR-01 | Phase 4 |
| 4 | 10 | FR-401…411, FR-501…508 | Phase 5 |
| 5 | 11 | FR-601…608, FR-702, FR-703, NFR-02…04, NFR-08…10, NFR-13, NFR-14, NFR-16 | Launch |
| 6 | 12 | FR-701, NFR-05, NFR-11, NFR-12 | — |

---

## 6. Objective O1 verification

O1 is a process objective and is verified by artifact and discipline rather than by product test.

| Evidence | Criterion | Status |
|---|---|---|
| Project charter | Approved before work begins | Pending |
| Discovery brief | Produced before requirements | ✅ Complete |
| PRD v1.0 | Approved; all Must requirements traced | Pending |
| This matrix | Maintained; reviewed at every gate | ✅ Established |
| Decision log | Decisions recorded at the time made, with rationale and alternatives | ✅ Established |
| Project plan | WBS, timeline, RAID maintained weekly | ✅ Complete |
| Gate records | Six written records with evidence | 0 of 6 |
| Change requests | Every scope change logged with its trade-off | 0 logged |
| Weekly PM hour | Held before development, editor closed | Not started |
| Retrospective | Six questions answered in writing | Pending |

**The strongest evidence for O1 is a decision log written contemporaneously.** Reconstructed rationale is indistinguishable from rationalization, and both a hiring manager and a steering committee can tell the difference.

---

## 7. Maintenance

Updated when: a requirement is added, changed, or removed; a verification method changes; a gate is passed; or a change request is approved.

Reviewed at every gate. Two checks:

1. **Orphan check** — every requirement traces to an objective. Orphans are scope creep and are removed or escalated.
2. **Coverage check** — every objective has at least one Must requirement, and every Must requirement has a verification method and a gate. Uncovered Must requirements block the gate.
