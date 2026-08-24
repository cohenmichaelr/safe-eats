# Discovery Brief — Safe Eats v2

| Field | Value |
|---|---|
| Document ID | DSC-SE-001 |
| Version | 1.0 |
| Date | 2026-08-19 |
| Author | Product Manager |
| Feeds | CHR-SE-001 §1.2, PRD-SE-100 |

---

## 1. Executive summary

Three findings drive everything downstream.

**The data problem is solved and was never the hard part.** Florida DBPR publishes complete inspection records as bulk downloads. v1's difficulty came from consuming a journalistic secondary source and from a URL that had been silently returning error pages for three years.

**The market is served, not underserved.** At least four active products cover all 67 Florida counties, several with daily refresh and richer datasets than Safe Eats plans. Any positioning premised on "nobody is doing this" is false.

**The remaining gap is narrow but real.** Incumbents are overwhelmingly *lookup* tools — you arrive already knowing the restaurant's name. None credibly serves the moment when you are standing somewhere and want to know what is nearby and clean. That gap exists because it requires per-establishment coordinate accuracy, which is expensive and unglamorous, and it is the one thing this project is structured to do well.

---

## 2. Problem definition

### 2.1 The user problem

> A diner in Palm Beach County wants to know whether the food they are about to eat comes from a kitchen that recently passed inspection. The information is public, complete, and free. It is also formatted for regulators.

Three friction points:

| Friction | Detail |
|---|---|
| **Format** | Data ships as wide CSV with numbered violation codes across 58 columns and coded dispositions. Unusable at the point of decision. |
| **Timing** | The decision happens on a sidewalk or in a delivery app, in seconds. Existing tools assume a seated user who already knows the restaurant's name. |
| **Absence of signal** | Florida does not require establishments to post inspection results, and DBPR does not issue letter grades. There is no A in the window to glance at. |

### 2.2 Why this matters

Palm Beach County led Florida in emergency restaurant closures in 2026 — <cite index="7-1">125 forced shutdowns, about 2.5% of its tracked establishments</cite>. Statewide, <cite index="7-1">roach infestations are the single largest closure trigger since 2015, followed by rodent activity, sewage backups, and unlicensed operation</cite>. These are conditions a diner would unambiguously want to know about, currently discoverable only by deliberate lookup.

### 2.3 Problem validation status

**Weak, and the PM hat should say so plainly.** No user interviews, no surveys, no analytics from v1. Evidence is inferential: the data's public-record status, competitor existence (proving *someone* believes demand exists), and app-store reviews for incumbents indicating users value the information.

**Decision:** proceed without further validation, accepting the risk. Rationale — the charter's primary objective (O1) is professional and does not depend on demand; the build is bounded at 144 hours; and lightweight validation is available post-launch at far lower cost than pre-launch research. **This is a deliberate, recorded acceptance, not an oversight** (Decision Log D-006).

---

## 3. Competitive landscape

### 3.1 Direct competitors

| Product | Form | Coverage | Refresh | Scoring | Notes |
|---|---|---|---|---|---|
| **InspectFL** | Web | <cite index="0-1">All 67 counties</cite> | <cite index="0-1">DBPR data imported daily; health scores recomputed weekly</cite> | <cite index="0-1">A–F grades with 0–100 health scores</cite> | <cite index="0-1">County choropleth shaded by violations per restaurant, with drill-down to county, city, and record level</cite> |
| **FloridaFoodSafety.org** | Web | <cite index="4-1">901 cities, all 67 counties, 67,328 licensed establishments, 994,481 inspection records</cite> | <cite index="5-1">Weekly, Monday mornings</cite> | Pass rates, violation patterns | <cite index="7-1">Only public database tracking both DBPR and FDACS in one place</cite>; covers closures, disciplinary actions, and stop-sale orders |
| **Life Kitchen Florida** | Native iOS + Android | <cite index="23-1">Every foodservice operation in Florida</cite> | <cite index="23-1">Full violation reports updated daily</cite> | Letter grades | Active since 2017. <cite index="26-1">Includes a "Live Drive Mode"</cite> — the closest thing to a proximity feature in the market |
| **What The Health** | Native | Statewide | Unknown | Unknown | <cite index="26-1">Restaurant and bar health inspection data for Florida</cite> |
| **Palm Beach Post** | Web | Statewide by county | Unknown | None | v1's original source. A newspaper data product, not a decision tool. |

### 3.2 Honest assessment

Safe Eats v1.0 will launch with **less coverage** (one county vs. 67), **less data** (DBPR only vs. DBPR + FDACS), and **slower refresh** (weekly vs. daily) than the strongest incumbents.

That sentence belongs in the charter and in your own head before Week 1. Any strategy that requires beating incumbents on breadth loses.

### 3.3 Where the gap actually is

| Capability | Incumbents | Opportunity |
|---|---|---|
| Look up a named restaurant | Strong across the board | None |
| Statewide coverage | Strong | None |
| County and city-level statistics | Strong (InspectFL, FloridaFoodSafety) | None |
| Data freshness | Daily for two of them | None |
| **"What's around me right now"** | Weak. Web incumbents are search- and statistics-led. Life Kitchen's Drive Mode is the only proximity attempt. | **Real** |
| **Per-establishment coordinate accuracy** | Unverified; choropleth and list-first designs don't require it | **Real, and expensive to match** |
| **Transparent scoring methodology** | Scores presented without published derivation | **Moderate** |
| Mobile-web decision speed | Native apps require install; web incumbents are content-heavy | **Moderate** |

### 3.4 Positioning statement

> For diners in Palm Beach County deciding where to eat **right now**, Safe Eats is a map that shows what is physically around you and how each place did at its last health inspection. Unlike statewide lookup tools that require you to already know the restaurant's name, Safe Eats answers the question you have when you don't.

**The defensible claim is accuracy of place, not breadth of data.** This is why the 99%-within-50m gate is the product rather than a chore, and why it is the only gate that stops the project.

### 3.5 Competitive risks

| Risk | Assessment |
|---|---|
| An incumbent ships proximity-first UX | Moderate probability, high impact. Unmitigable. Accepted (charter R13). |
| Users prefer statewide coverage over local accuracy | Plausible. Would invalidate positioning. Test post-launch, not pre-launch. |
| Incumbents' data is simply good enough | Likely for the lookup use case. Reinforces narrowing to the proximity moment. |

---

## 4. Jobs To Be Done

### JTBD-1 — Primary

> When I'm **standing on a street or scrolling a delivery app deciding where to eat**, I want to **see which nearby places recently passed inspection**, so I can **avoid a bad experience without spending more than a few seconds researching**.

- Success: a confident choice in under 30 seconds
- Failure: giving up and eating somewhere unknown; or eating somewhere with a recent serious violation
- Competing solutions today: Google/Yelp ratings as a cleanliness proxy (poor), asking a friend, ignoring the question
- **This is the job Safe Eats optimizes for.**

### JTBD-2 — Secondary

> When I'm **planning a meal for someone medically vulnerable**, I want to **examine a specific restaurant's full inspection history**, so I can **judge whether problems are one-off or chronic**.

- Success: enough detail to distinguish a single bad day from a pattern
- Competing solutions: incumbent lookup tools, which serve this well
- **Safe Eats must be competent here. It will not win here.**

### JTBD-3 — Tertiary

> When I'm **curious about food safety in my area**, I want to **see what's been closed or cited recently**, so I can **stay informed about where I live**.

- Competing solutions: local news, InspectFL statistics pages
- **Post-launch consideration. Not a v1.0 driver.**

### Anti-job

> When I'm **a restaurant owner with an unflattering but accurate record**, I want to **have it removed**.

Safe Eats corrects factual errors. It does not remove accurate public records. This distinction is a product requirement (O7), not a support policy.

---

## 5. Personas

### P1 — Deciding Diner *(primary; JTBD-1)*

Mid-20s to mid-40s. Mobile, often on cellular, frequently one-handed. Deciding among options within a few blocks. Low patience: will abandon in seconds. Will not read violation codes, will not create an account, will not install an app to answer one question.

**Needs:** map, immediate visual signal, one line of plain English, correct pin position.
**Fails if:** loading is slow, the pin is on the wrong building, or the answer requires interpretation.
**Design implications:** mobile web first; map is the landing experience; grade legible at a glance; **a wrong pin fails this persona completely** — she walks to the wrong restaurant.

### P2 — Careful Planner *(secondary; JTBD-2)*

30s–60s. Immunocompromised, pregnant, feeding young children, or caring for elderly parents. Planning ahead, often on desktop. Will read detail and wants specifics and history.

**Needs:** full inspection history, plain-language violations, dates, trend, source links.
**Fails if:** data is stale without saying so, or scoring is unexplained.
**Design implications:** detail pages must be substantive; methodology must be public; staleness must be stated, not hidden.

### P3 — Local Watchdog *(tertiary; JTBD-3)*

Journalist, blogger, or engaged resident. Wants patterns rather than a single answer.

**Needs:** recent closures, filtering, sortable lists.
**Design implications:** mostly P1 requirements deferred. Do not build for P3 in v1.0.

### Persona priority

**When P1 and P2 conflict, P1 wins.** P2 is well served by incumbents; P1 is the wedge. Concretely: a map that loads instantly with a grade and one line beats a map that loads slowly with complete violation detail.

---

## 6. Solution principles

Derived from the above. These arbitrate design disputes and are cited in the PRD.

| # | Principle | Consequence |
|---|---|---|
| **SP1** | **A missing pin is a gap; a wrong pin is a lie.** | Suppress below the confidence threshold. Never guess a position. |
| **SP2** | **The map is the product.** | Map-first landing. Everything else supports it. |
| **SP3** | **Speed is a safety feature.** | A tool too slow to consult at the decision moment provides zero safety benefit. |
| **SP4** | **Publish only what the record supports.** | No inference, no prediction. Scoring is deterministic, documented, and versioned. |
| **SP5** | **Time-anchor every claim.** | Never a bare grade. Always tied to an inspection date. |
| **SP6** | **Fail loudly, never silently.** | v1's defining failure was silent staleness. Every page shows data-as-of. |
| **SP7** | **Narrow beats broad.** | One county done accurately over thirteen done approximately. |

---

## 7. Constraints on the solution

| Source | Constraint | Product implication |
|---|---|---|
| DBPR data | No coordinates provided, only address strings | Geocoding is a first-class subsystem, not a utility |
| DBPR data | No letter grades issued by the state | Any grade is Safe Eats' editorial construct, requiring justification (D-001) |
| DBPR data | Weekly refresh at best | Cannot claim real-time; must state as-of date |
| DBPR data | Reporting-only violation codes 45–49 exist | Must be excluded from scoring or restaurants are unfairly penalized |
| Legal | Public record, published under a state snapshot disclaimer | Presentation must preserve the snapshot framing |
| Legal | No budget for review | Choose the least-inferential option at every fork |
| Resource | 144 hours, solo | Ruthless P0 discipline |
| Cost | <$50/month | Constrains map provider (D-002) |

---

## 8. Open questions for the sponsor

| ID | Question | Why it matters | Needed by |
|---|---|---|---|
| OQ1 | Does v1 have real users or inbound traffic? | Determines migration and URL-preservation scope (assumption A6) | Week 1 |
| OQ2 | Is the domain live and indexed? | Affects launch approach and SEO continuity | Week 1 |
| OQ3 | Is "Safe Eats" name-cleared? | Similar names exist in this category | Before launch |
| OQ4 | Is there any intent to monetize later? | Would trigger a data-rights and terms review now, not later | Before launch |
| OQ5 | Given §3.2, does the sponsor still accept the professional objective as primary? | Charter §1.2 depends on an affirmative answer | **Before charter approval** |

**OQ5 is the gating question.** Everything downstream assumes the sponsor has read the competitive assessment and proceeded anyway, deliberately.
