'use strict';

/**
 * Draws the AC-E2-GATE accuracy sample — charter O3 / M3, PRD §4.
 *
 * The PRD says the sample "may not be redrawn to obtain a better result, and the
 * threshold may not be adjusted". Two things enforce that here:
 *
 *   1. The draw is seeded and deterministic. Re-running reproduces the same 100
 *      establishments from the same population, so there is no hidden reroll.
 *   2. The population is fingerprinted. If the establishment set changes and the
 *      draw is repeated, the recorded fingerprint no longer matches and the new
 *      sample is visibly a different sample rather than a quiet substitution.
 *
 * AC-E2-GATE samples "map-displayed establishments". That phrase carries two
 * filters and both are load-bearing:
 *
 *   displayed — licence type 2010 only, per DEC-009. Drawing from the full
 *     licensed universe is what voided draw 1.
 *   map       — rows that actually carry coordinates. Establishments with no pin
 *     are a COVERAGE question (NFR-07, Gate 1); a pin that does not exist cannot
 *     be 50 m off, and folding the two together would let a coverage failure
 *     masquerade as accuracy.
 *
 *   node scripts/draw-sample.js            draw and write the worksheet
 *   node scripts/draw-sample.js --seed X   use a different seed (records it)
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { open } = require('../src/db');
const { DISPLAYED_LICENSE_TYPES, displayedPredicate, countyName } = require('../src/display');

const ROOT = path.join(__dirname, '..');
const { gatePaths, SAMPLE_SIZE: GATE_SAMPLE_SIZE } = require('./gate-paths');

const SAMPLE_SIZE = GATE_SAMPLE_SIZE;

/**
 * DEC-009 — the product displays permanent food service (2010) only. Mobile
 * vendors, caterers, temporary events and vending operators are licensed at a
 * commissary, base or home address, so their coordinate is not a claim the
 * product makes and must not be measured as one. The population here is the
 * DISPLAYED population, which is what AC-E2-GATE says it samples; drawing from
 * the full licensed universe is what voided draw 1.
 *
 * The predicate itself now lives in `src/display.js`, shared with the map API, so
 * the sampled population and the rendered one cannot drift apart again.
 */
const DISPLAYED_LICENSE_TYPE = DISPLAYED_LICENSE_TYPES.join(', ');

/** The county this gate measures. Overridable so a new county can be drawn. */
const GATE_COUNTY = process.env.SAFE_EATS_GATE_COUNTY || '60';
const PATHS = gatePaths(GATE_COUNTY);
const CSV_PATH = PATHS.csv;
const DOC_PATH = PATHS.doc;
const HISTORY_PATH = PATHS.history;
const DEFAULT_SEED = PATHS.seed;

/** mulberry32 — small, deterministic, adequate for drawing a sample. */
function rng(seedText) {
  let a = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0);
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by the seeded RNG. */
function sample(items, n, next) {
  const pool = items.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};


/**
 * How many rows of an existing worksheet already carry a verdict.
 *
 * This is the number that separates a legitimate redraw from the reroll the PRD
 * forbids. Redrawing before anyone has looked at imagery changes nothing about
 * the outcome; redrawing after verdicts exist discards evidence and is exactly
 * how a failing gate gets turned into a passing one.
 */
function existingVerdictCount() {
  if (!fs.existsSync(CSV_PATH)) return null;
  const { parse } = require('csv-parse/sync');
  const rows = parse(fs.readFileSync(CSV_PATH), { columns: true, bom: true, skip_empty_lines: true });
  return rows.filter((r) => String(r.verdict ?? '').trim() !== '').length;
}

function appendHistory(entry) {
  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
    : [];
  history.push(entry);
  fs.writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
  return history;
}

function main() {
  const argv = process.argv.slice(2);
  const seedFlag = argv.indexOf('--seed');
  const seed = seedFlag >= 0 ? argv[seedFlag + 1] : DEFAULT_SEED;
  const force = argv.includes('--force');

  const verdictsSoFar = existingVerdictCount();
  if (verdictsSoFar !== null && verdictsSoFar > 0 && !force) {
    console.error('');
    console.error(`  REFUSING TO REDRAW — the existing worksheet has ${verdictsSoFar} recorded verdict(s).`);
    console.error('');
    console.error('  The PRD forbids redrawing the sample to obtain a better result. Discarding');
    console.error('  verification work already done is precisely that, whatever the intent.');
    console.error('');
    console.error('  If the population genuinely changed and the sample must be redrawn, do it');
    console.error('  deliberately with --force. The draw history records that it happened, how');
    console.error('  many verdicts were discarded, and when.');
    console.error('');
    process.exit(1);
  }

  const db = open({ readonly: true });

  // Scoped to ONE county on purpose — DEC-015. The product now displays Palm
  // Beach, Broward and Dade, but the accuracy gate is per county: a sample drawn
  // across all three would be a different sample from the one already drawn and
  // awaiting verification, and would silently discard that work. Each county
  // clears its own bar before it ships.
  const displayed = displayedPredicate('e', { counties: GATE_COUNTY });

  const population = db.prepare(`
    SELECT e.establishment_id, e.name, e.address, e.city, e.zip, e.lat, e.lng,
           e.geocode_source, e.geocode_quality
      FROM establishment e
     WHERE ${displayed.sql}
       AND e.lat IS NOT NULL
       AND e.lng IS NOT NULL
     ORDER BY e.establishment_id
  `).all(...displayed.params);

  const total = db.prepare(
    `SELECT COUNT(*) n FROM establishment e WHERE ${displayed.sql}`
  ).get(...displayed.params).n;

  /*
   * A county smaller than the sample is verified in full — DEC-017.
   *
   * Statewide, roughly two dozen counties hold fewer than 100 displayable
   * establishments; Liberty has 3. Refusing to draw would leave them
   * permanently unverifiable, and drawing "100" from 3 would report a sample
   * that does not exist. So the whole population is taken, and the artefacts
   * say census rather than sample.
   *
   * This is stronger than sampling, not weaker: every row is checked, so the
   * >=99% rule leaves no room at all in a county of 3 — all three must be
   * within 50 m. It is also cheaper. All the small counties together are about
   * 900 rows, fewer than nine sampled counties.
   */
  const census = population.length <= SAMPLE_SIZE;
  const drawSize = census ? population.length : SAMPLE_SIZE;

  if (population.length === 0) {
    console.error('Population is empty — nothing to verify, and nothing to claim.');
    process.exit(1);
  }

  // Fingerprint the exact population this draw came from.
  const fingerprint = crypto.createHash('sha256')
    .update(population.map((r) => r.establishment_id).join('\n'))
    .digest('hex')
    .slice(0, 16);

  // A census is still ordered by the seeded shuffle, so the worksheet's row
  // order is reproducible the same way a sample's is.
  const drawn = sample(population, drawSize, rng(seed));

  const header = [
    'n', 'establishment_id', 'business_name', 'address', 'city', 'zip',
    'geocoded_lat', 'geocoded_lng', 'geocode_quality',
    'satellite_link', 'address_search_link',
    'verdict', 'true_lat', 'true_lng', 'cause', 'notes',
  ];

  const lines = [header.join(',')];
  drawn.forEach((r, i) => {
    const sat = `https://www.google.com/maps/place/${r.lat},${r.lng}/@${r.lat},${r.lng},20z/data=!3m1!1e3`;
    const query = encodeURIComponent(`${r.address}, ${r.city}, FL ${String(r.zip || '').slice(0, 5)}`);
    const search = `https://www.google.com/maps/search/?api=1&query=${query}`;
    lines.push([
      i + 1, r.establishment_id, r.name, r.address, r.city, r.zip,
      r.lat, r.lng, r.geocode_quality,
      sat, search,
      '', '', '', '', '',
    ].map(csvEscape).join(','));
  });

  fs.writeFileSync(CSV_PATH, `${lines.join('\n')}\n`);

  const drawnAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const history = appendHistory({
    drawnAt,
    seed,
    populationSize: population.length,
    populationFingerprint: fingerprint,
    sampleSize: drawSize,
    census,
    verdictsDiscarded: verdictsSoFar ?? 0,
    forced: force,
  });

  // A superseded draw stays part of the record. This document is regenerated on
  // every draw, so without this the previous one would survive only in the
  // history JSON. Why it was superseded belongs in the decision log; this says
  // that it was, and what population it came from.
  const superseded = history.slice(0, -1);
  const supersededSection = superseded.length
    ? `\n### Superseded draws\n\n${superseded
        .map(
          (d, i) =>
            `${i + 1}. Drawn ${d.drawnAt} from a population of ${d.populationSize}, ` +
            `fingerprint \`${d.populationFingerprint}\` — ${d.verdictsDiscarded} verdict(s) discarded.`
        )
        .join('\n')}\n\nA different population is a different sample. The decision that changed it is in\n[\`14-decision-log.md\`](14-decision-log.md).\n`
    : '';

  const doc = `# Accuracy gate — AC-E2-GATE

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
| Seed | \`${seed}\` |
| Population | ${population.length} geocoded of ${total} displayed ${countyName(GATE_COUNTY)} establishments |
| Population filter | county ${GATE_COUNTY} ${countyName(GATE_COUNTY)} · licence type ${DISPLAYED_LICENSE_TYPE} (DEC-009) · geocoded |
| Population fingerprint | \`${fingerprint}\` |
| ${census ? 'Census size' : 'Sample size'} | ${drawSize}${census ? ' — every displayed establishment in the county (DEC-017)' : ''} |
| Drawn at | ${drawnAt} |
| Draw number | ${history.length} — full history in [\`07-draw-history.json\`](07-draw-history.json) |
| Worksheet | [\`07-accuracy-sample.csv\`](07-accuracy-sample.csv) |
${supersededSection}
Re-running \`node scripts/draw-sample.js\` with this seed against this population
reproduces this exact sample. If the fingerprint changes, the population changed
and any new draw is a **different sample** — say so rather than replacing this one.

Establishments without coordinates (${total - population.length} of ${total}) are excluded:
AC-E2-GATE measures displayed pins. Missing pins are a coverage question under
NFR-07 and Gate 1, and are tracked there.

## Verification protocol

This step is manual and cannot be automated — it is a visual judgement against
aerial imagery. For each of the ${drawSize} rows in the worksheet:

1. Open \`satellite_link\`. It centres on the geocoded position at zoom 20.
2. Open \`address_search_link\` in a second tab to see where the address resolves.
3. Fill \`verdict\`:
   - \`ok\`     — the pin sits on the correct building or its parcel.
   - \`off\`    — the pin is on the wrong building, wrong parcel, or in the street.
   - \`unsure\` — imagery is too old, obstructed, or the establishment is inside a
     large complex with no identifiable unit.
4. For \`off\` and \`unsure\` only: right-click the true rooftop in Google Maps,
   copy the coordinates, and paste them into \`true_lat\` / \`true_lng\`. The scorer
   computes the real distance from these; do not estimate it by eye.
5. Fill \`cause\` for every non-\`ok\` row, from this list:

| Cause | Meaning |
| --- | --- |
| \`street-interpolation\` | TIGER placed the point along a road centreline, not on the parcel |
| \`wrong-block\` | Correct street, wrong block or house-number range |
| \`zip-centroid\` | Fell back to a ZIP or city centroid |
| \`plaza-ambiguity\` | Correct parcel, wrong unit in a plaza, mall, airport or stadium |
| \`stale-address\` | The licensed address no longer matches the building on the ground |
| \`wrong-city\` | Resolved to a same-named street in another municipality |
| \`other\` | Anything else — explain in \`notes\` |

A \`verdict\` of \`ok\` needs no coordinates: at zoom 20 a correct-building judgement
is comfortably inside 50 m, since a typical Palm Beach commercial footprint is
20–40 m across. Rows left blank are treated as **unverified**, not as passes.

## Scoring

    node scripts/score-gate.js

Reads the worksheet, computes the within-50 m count, classifies the failures, and
compares the result against the ≥99/100 rule. It refuses to report a verdict while
any row is unverified.
`;

  fs.writeFileSync(DOC_PATH, doc);

  console.log(
    census
      ? `census: all ${drawSize} geocoded rows (${total} displayable in ${countyName(GATE_COUNTY)})`
      : `drew ${drawSize} of ${population.length} geocoded (${total} displayable in ${countyName(GATE_COUNTY)})`
  );
  console.log(`  seed        : ${seed}`);
  console.log(`  fingerprint : ${fingerprint}`);
  console.log(`  worksheet   : ${path.relative(ROOT, CSV_PATH)}`);
  console.log(`  protocol    : ${path.relative(ROOT, DOC_PATH)}`);
}

if (require.main === module) main();

module.exports = { rng, sample };
