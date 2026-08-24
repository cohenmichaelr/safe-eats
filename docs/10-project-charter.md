# Project Charter — Safe Eats v2

| Field | Value |
|---|---|
| Document ID | CHR-SE-001 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Project sponsor | Michael Cohen |
| Product manager | Michael Cohen |
| Technical lead | Michael Cohen |
| Status | **Pending sponsor approval** |

> **Note on governance.** Sponsor, PM, and tech lead are the same person. The separation is deliberate. Each role has different accountabilities and different failure modes, and this charter is written so that the sponsor role can hold the PM role accountable, and the PM role can hold the tech lead accountable — in writing, on the record. Approving this document is a sponsor act, not a formality.

---

## 1. Purpose and justification

### 1.1 Business need

Palm Beach County has roughly 5,000–6,000 licensed food service establishments. Florida DBPR inspects them and publishes every result as public record. A diner deciding where to eat cannot practically use that record: it ships as bulk CSV and a license-lookup portal, neither designed for the moment of decision.

Safe Eats v1 attempted to close that gap and failed on both speed and accuracy. A [structural audit](05-v1-audit-findings.md) established the cause: v1's map was driven by Google Places results, with the database consulted only to color pins via fuzzy name matching. Only 24 of 64,110 rows ever received coordinates. The data was three fiscal years stale because the download script targeted a URL that does not exist. This is an inverted architecture, not a defect list.

### 1.2 The market reality this charter must confront

**Safe Eats is entering a served market, not an unserved one.** Discovery (see [Discovery Brief](11-discovery-brief.md)) identified at least four active competitors covering all 67 Florida counties with more data and faster refresh than Safe Eats plans for v1.

A charter that ignores this would be sponsor malpractice. Two honest conclusions follow:

**First, the primary justification for this project is professional, not commercial.** The stated objective — running a full product lifecycle as both technical program manager and developer — is achievable regardless of market outcome and is not contingent on beating incumbents. This is the project's principal return.

**Second, the product objective must be narrow enough to be genuinely defensible.** "Florida inspection data on a map" is taken. The wedge available is the *decision moment*: a map-first, location-accurate view of what is physically around you right now. Incumbents are predominantly lookup tools — you arrive knowing the restaurant's name. Safe Eats answers the question you have when you don't.

**This reframes the plan's central cost.** Geocoding accuracy — 21% of budgeted effort, and the one gate with no exceptions — is not overhead. It *is* the differentiator. A lookup tool can tolerate approximate coordinates. A proximity tool cannot. The most expensive thing in the plan is the thing the product is for.

### 1.3 Alternatives considered

| Alternative | Assessment | Disposition |
|---|---|---|
| Repair v1 in place | Audit finding F1 is architectural. Repair means replacing the data path, the geocoding approach, the matching logic, and the map layer — which is a rebuild with worse foundations. | **Rejected** |
| Abandon; use an existing app | Satisfies the diner need. Satisfies none of the professional objective. | **Rejected** |
| Statewide scope at v1 | Multiplies geocoding volume ~13×, competes head-on where incumbents are strongest, and defers the accuracy gate that is the actual differentiator. | **Rejected for v1; candidate for v2** |
| Rebuild, county-scoped, accuracy-first | Bounded, achievable solo in 12 weeks, delivers the professional objective in full, and stakes a defensible narrow claim. | **SELECTED** |

---

## 2. Objectives

SMART, with the measure that will settle each one.

| ID | Objective | Measure | Target | Due |
|---|---|---|---|---|
| **O1** | Execute a complete product lifecycle across both PM and engineering roles, with artifacts a hiring manager or steering committee would accept | Charter, discovery, PRD, RTM, decision log, project plan, and six passed phase gates, all written before or during the work they govern | 100% produced; ≥5 of 6 gates on schedule | Week 12 |
| **O2** | Establish DBPR as the single authoritative data source, replacing all scraping | Zero scraping code in the v2 repo; 100% of displayed records traceable to a DBPR extract and ingest date | 100% | Week 4 |
| **O3** | Achieve location accuracy sufficient for proximity-based decisions | Hand-verified sample of 100 pins within 50m of true position | ≥99/100 | Week 6 |
| **O4** | Deliver a map that answers "what's around me and is it clean" in under five seconds | p95 viewport query latency; p95 time-to-first-answer | <300ms; <5s | Week 10 |
| **O5** | Achieve substantially complete coverage of the county's licensed establishments | Active DBPR licenses in county 60 present in the database | ≥98% | Week 4 |
| **O6** | Operate without manual intervention | Consecutive unattended weekly ETL cycles at launch; data staleness | ≥2 cycles; ≤8 days | Week 12 |
| **O7** | Publish defensibly — no claim the underlying record does not support | Public methodology page; every fact source-linked; documented correction process; zero unsourced assertions | 100% | Week 11 |

**O3 is the project's keystone.** It is the differentiator (§1.2), the hardest technical problem, the largest effort line, and the only unconditional gate. If O3 fails, the product has no reason to exist and the correct response is to stop, not to lower the threshold.

---

## 3. Success criteria

### 3.1 Project success (assessed at Week 12)

- All seven objectives met at target.
- v1.0 live, serving Palm Beach County, running unattended.
- Complete artifact set produced, with decisions recorded at the time they were made rather than reconstructed afterward.
- Written retrospective answering the six questions in the project plan §9.

### 3.2 Product success (assessed at Week 24, 90 days post-launch)

- ETL success rate ≥95% with no more than one manual intervention per quarter.
- Zero substantiated accuracy complaints resulting in a corrected record.
- Infrastructure spend within budget.
- Production p95 latency holding within NFR targets.

### 3.3 Explicitly *not* success criteria

Traffic, user counts, revenue, competitive displacement, or app-store presence. Adopting any of these mid-project would be a charter amendment (§9), because each would justify scope the 12-week plan cannot absorb. Stating this now is what prevents the plan from quietly becoming a growth project in Week 7.

---

## 4. Scope

### 4.1 In scope

- Automated ingest of DBPR inspection, license, and emergency closure extracts, filtered to Palm Beach County (code 60)
- Historical inspection backfill, FY2016 to present
- Geocoding pipeline with confidence scoring, permanent caching, and manual override
- Map-first discovery with viewport querying and marker clustering
- Per-establishment detail pages with full inspection history and plain-language violations
- Safety scoring, with public methodology
- Name and address search
- Public correction process and disclaimers

### 4.2 Out of scope for v1.0

Binding. Anything here entering v1 requires a charter amendment.

User accounts, reviews, or user-generated content · restaurant claim-and-respond flows · menus, hours, photos, reservations, or delivery integration · counties outside Palm Beach · lodging inspections · FDACS retail food data · native mobile applications · notifications or alerting · public API · analytics dashboards · monetization or advertising · non-English localization

### 4.3 Scope boundary conditions

| Boundary | Rule |
|---|---|
| Geography | Palm Beach County, code 60, only. County expansion is a v2.0 decision made after v1.0 is stable. |
| Data source | DBPR bulk extracts only. No scraping, of any site, for any reason. Google is permitted for geocoding within the ETL, never on the request path. |
| Establishment types | Food service licenses. Vending machines excluded (see [Decision Log](14-decision-log.md) D-004). |
| Editorial | Safe Eats publishes only what a DBPR record supports, plus a documented, deterministic score derived from it. No inferences, no predictions, no commentary. |

---

## 5. Deliverables and milestones

| ID | Milestone | Deliverable | Target |
|---|---|---|---|
| M0 | Project definition complete | Charter, discovery brief, PRD v1.0, RTM, decision log approved | Week 1 |
| M1 | Data source validated | Gate 0 record; all DBPR URLs verified; v1 audit closed | Week 1 |
| M2 | Full history in database | FY2016–present loaded, county-filtered, idempotent | Week 3 |
| M3 | **Location accuracy gate passed** | Audit record showing ≥99/100 within 50m | Week 6 |
| M4 | Scoring approved | Signed formula, versioned, methodology drafted | Week 7 |
| M5 | API meets performance target | Measured p95 <300ms on full dataset | Week 8 |
| M6 | Feature complete | All P0 requirements demonstrated against acceptance criteria | Week 10 |
| M7 | Launch readiness | Gate 5 record: accessibility, performance, security, compliance | Week 11 |
| M8 | **v1.0 live** | Production deployment; two unattended ETL cycles observed | Week 12 |

---

## 6. Constraints

| ID | Constraint | Type | Implication |
|---|---|---|---|
| C1 | ~12 hours/week, single person, ~144 hours total | Resource | Every addition must be paid for by a removal. Non-negotiable. |
| C2 | 12-week duration | Schedule | Fixed. Scope flexes; the date does not. |
| C3 | <$50/month infrastructure | Cost | Drives the map provider decision (D-002). |
| C4 | DBPR file availability and format | External | Uncontrollable. Mitigated by archiving raw files and asserting schema. |
| C5 | Data is public record, published under state disclaimer | Legal | Constrains presentation, not access. Governs O7. |
| C6 | No budget for legal review | Resource | Raises the bar on editorial conservatism. Favors the least-inferential option at every decision. |

---

## 7. Assumptions

| ID | Assumption | Validation | If false |
|---|---|---|---|
| A1 | DBPR District 2 extract contains county code 60 records | **Gate 0 — open** | Project blocked pending an alternate extraction path |
| A2 | ~12 hrs/week sustainable for 12 weeks | Ongoing | Timeline extends proportionally; phases are independently valuable |
| A3 | Palm Beach County has 5,000–6,000 active food licenses | Gate 0 | Affects geocoding cost and effort estimates |
| A4 | US Census batch geocoder resolves the majority of addresses | Phase 2 | One-time Google cost rises; still within C3 |
| A5 | Free tiers of Supabase and Vercel suffice at v1 volumes | Phase 1 | Self-host per TRD Option B; adds ~2 weeks |
| A6 | v1 has no meaningful user base requiring migration | **Sponsor — open** | Adds URL preservation and migration scope |
| A7 | v1's SQLite database and code have no salvage value beyond the `LIC_ID` insight and mobile CSS | Confirmed by audit | — |

---

## 8. Stakeholders and RACI

| Stakeholder | Interest | Influence | Engagement |
|---|---|---|---|
| Sponsor (self) | Both objectives delivered; time well spent | Decisive | Approves charter, amendments, and go/no-go at M8 |
| Product manager (self) | Scope integrity, defensible decisions | High | Owns PRD, decision log, gates, change control |
| Technical lead (self) | Correctness, maintainability | High | Owns architecture, implementation, quality |
| Palm Beach County diners | Accurate, fast answers | None (unrepresented) | Represented by personas; the accuracy gate is their proxy |
| Restaurant operators | Fair, accurate representation | Low, but legitimate | Represented by O7 and the correction process |
| Florida DBPR | Correct use and attribution of public records | Indirect | Attribution and disclaimer requirements |

### RACI

| Activity | Sponsor | PM | Tech Lead |
|---|---|---|---|
| Charter approval | **A** | R | C |
| Scope change approval | **A** | R | C |
| Requirements definition | I | **A/R** | C |
| Scoring formula sign-off | C | **A/R** | C |
| Architecture decisions | I | C | **A/R** |
| Phase gate 0–1, 3–5 | I | **A/R** | R |
| **Phase gate 2 (accuracy)** | **A** | R | R |
| Launch go/no-go | **A** | R | C |

Gate 2 escalates to sponsor because it is the only gate whose failure should stop the project rather than delay it. The PM role must not be able to pass it alone.

---

## 9. Governance

**Change control.** Amendments to objectives, success criteria, §4.2 scope exclusions, or constraints require sponsor approval using the template in the project plan §7. The mandatory trade-off field cannot be "none" — capacity is fixed by C1.

**Weekly PM hour.** One hour at the start of each week, before any development: gate status, RAID review, scope review. Held with the editor closed. If this hour is skipped twice consecutively, that is a project health signal to raise to the sponsor, not a scheduling detail.

**Escalation.** Any gate failure, any risk materializing at high impact, or any request to weaken a gate criterion escalates to sponsor. Requests to weaken Gate 2 are refused at the PM level without escalation.

---

## 10. High-level risks

Full register in project plan §5. Sponsor-visible items:

| ID | Risk | Response |
|---|---|---|
| R1 | Geocoding fails the 99%/50m gate | 30 hours budgeted; three-tier cascade; **project stops rather than ships inaccurate pins** |
| R5 | Scope creep | Highest-probability risk. §4.2 is binding; change control mandatory |
| R8 | Complaint from a restaurant operator | Public-record basis, source links, documented corrections, conservative editorial posture |
| R11 | v1's unauthenticated write endpoints, if deployed | **Immediate action required — see §11** |
| R13 | Competitive irrelevance | Accepted knowingly. §1.2 states the professional objective as primary |

---

## 11. Immediate actions on approval

| # | Action | Owner | Due |
|---|---|---|---|
| 1 | If v1 is publicly deployed, take offline or add authentication to both POST routes | Tech Lead | **Immediately** |
| 2 | Close assumptions A1, A3, A6 | PM | Week 1 |
| 3 | Resolve open decisions D-001 through D-006 | PM | Per decision log |
| 4 | Initialize v2 repository fresh; do not carry v1 history | Tech Lead | Week 1 |
| 5 | Execute Gate 0 | PM | Week 1 |

---

## 12. Approval

Approving this charter authorizes the project, commits the resources in §6, and accepts the objectives in §2 and the scope boundaries in §4.

By approving, the sponsor specifically accepts:

- that the primary return is professional rather than commercial (§1.2);
- that the market contains established competitors with broader coverage;
- that Gate 2 failure stops the project rather than triggering a workaround;
- that §4.2 exclusions are binding absent a written amendment.

| Role | Name | Signature | Date |
|---|---|---|---|
| Sponsor | Michael Cohen | | |
| Product Manager | Michael Cohen | | |
| Technical Lead | Michael Cohen | | |
