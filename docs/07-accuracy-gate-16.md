# Accuracy gate — AC-E2-GATE

**Status: sample drawn, verification NOT started.**

Charter O3 / M3, PRD §4. The decision rule:

> A randomly drawn, seeded sample of 100 map-displayed establishments is verified
> by hand against satellite imagery. **At least 99 must fall within 50 metres.**
> Below that, v1.0 does not launch. The sample may not be redrawn to obtain a
> better result, and the threshold may not be adjusted. Failures are classified by
> cause, and the cause distribution directs remediation.

## Draw

| | |
| --- | --- |
| Seed | `safe-eats/AC-E2-GATE/county-16/2026-09-03` |
| Population | 4859 geocoded of 4887 displayed Broward establishments |
| Population filter | county 16 Broward · licence type 2010 (DEC-009) · geocoded |
| Population fingerprint | `b76893d4587917d3` |
| Sample size | 100 |
| Drawn at | 2026-09-03T13:17:32Z |
| Draw number | 1 — full history in [`07-draw-history.json`](07-draw-history.json) |
| Worksheet | [`07-accuracy-sample.csv`](07-accuracy-sample.csv) |

Re-running `node scripts/draw-sample.js` with this seed against this population
reproduces this exact sample. If the fingerprint changes, the population changed
and any new draw is a **different sample** — say so rather than replacing this one.

Establishments without coordinates (28 of 4887) are excluded:
AC-E2-GATE measures displayed pins. Missing pins are a coverage question under
NFR-07 and Gate 1, and are tracked there.

## Verification protocol

This step is manual and cannot be automated — it is a visual judgement against
aerial imagery. For each of the 100 rows in the worksheet:

1. Open `satellite_link`. It centres on the geocoded position at zoom 20.
2. Open `address_search_link` in a second tab to see where the address resolves.
3. Fill `verdict`:
   - `ok`     — the pin sits on the correct building or its parcel.
   - `off`    — the pin is on the wrong building, wrong parcel, or in the street.
   - `unsure` — imagery is too old, obstructed, or the establishment is inside a
     large complex with no identifiable unit.
4. For `off` and `unsure` only: right-click the true rooftop in Google Maps,
   copy the coordinates, and paste them into `true_lat` / `true_lng`. The scorer
   computes the real distance from these; do not estimate it by eye.
5. Fill `cause` for every non-`ok` row, from this list:

| Cause | Meaning |
| --- | --- |
| `street-interpolation` | TIGER placed the point along a road centreline, not on the parcel |
| `wrong-block` | Correct street, wrong block or house-number range |
| `zip-centroid` | Fell back to a ZIP or city centroid |
| `plaza-ambiguity` | Correct parcel, wrong unit in a plaza, mall, airport or stadium |
| `stale-address` | The licensed address no longer matches the building on the ground |
| `wrong-city` | Resolved to a same-named street in another municipality |
| `other` | Anything else — explain in `notes` |

A `verdict` of `ok` needs no coordinates: at zoom 20 a correct-building judgement
is comfortably inside 50 m, since a typical Palm Beach commercial footprint is
20–40 m across. Rows left blank are treated as **unverified**, not as passes.

## Scoring

    node scripts/score-gate.js

Reads the worksheet, computes the within-50 m count, classifies the failures, and
compares the result against the ≥99/100 rule. It refuses to report a verdict while
any row is unverified.
