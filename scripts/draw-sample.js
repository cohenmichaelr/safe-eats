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
 * AC-E2-GATE samples "map-displayed establishments", so the population is rows
 * that actually carry coordinates. Establishments with no pin are a COVERAGE
 * question (NFR-07, Gate 1) — a pin that does not exist cannot be 50 m off, and
 * folding the two together would let a coverage failure masquerade as accuracy.
 *
 *   node scripts/draw-sample.js            draw and write the worksheet
 *   node scripts/draw-sample.js --seed X   use a different seed (records it)
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { open } = require('../src/db');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'docs', '07-accuracy-sample.csv');
const DOC_PATH = path.join(ROOT, 'docs', '07-accuracy-gate.md');

const SAMPLE_SIZE = 100;
const DEFAULT_SEED = 'safe-eats/AC-E2-GATE/2026-08-24';

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

function main() {
  const argv = process.argv.slice(2);
  const seedFlag = argv.indexOf('--seed');
  const seed = seedFlag >= 0 ? argv[seedFlag + 1] : DEFAULT_SEED;

  const db = open({ readonly: true });

  const population = db.prepare(`
    SELECT establishment_id, name, address, city, zip, lat, lng,
           geocode_source, geocode_quality
      FROM establishment
     WHERE county_code = '60'
       AND lat IS NOT NULL
       AND lng IS NOT NULL
     ORDER BY establishment_id
  `).all();

  const total = db.prepare(`SELECT COUNT(*) n FROM establishment WHERE county_code = '60'`).get().n;

  if (population.length < SAMPLE_SIZE) {
    console.error(`Population is ${population.length}, smaller than the ${SAMPLE_SIZE}-row sample.`);
    process.exit(1);
  }

  // Fingerprint the exact population this draw came from.
  const fingerprint = crypto.createHash('sha256')
    .update(population.map((r) => r.establishment_id).join('\n'))
    .digest('hex')
    .slice(0, 16);

  const drawn = sample(population, SAMPLE_SIZE, rng(seed));

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
| Population | ${population.length} geocoded of ${total} Palm Beach establishments |
| Population fingerprint | \`${fingerprint}\` |
| Sample size | ${SAMPLE_SIZE} |
| Drawn at | ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} |
| Worksheet | [\`07-accuracy-sample.csv\`](07-accuracy-sample.csv) |

Re-running \`node scripts/draw-sample.js\` with this seed against this population
reproduces this exact sample. If the fingerprint changes, the population changed
and any new draw is a **different sample** — say so rather than replacing this one.

Establishments without coordinates (${total - population.length} of ${total}) are excluded:
AC-E2-GATE measures displayed pins. Missing pins are a coverage question under
NFR-07 and Gate 1, and are tracked there.

## Verification protocol

This step is manual and cannot be automated — it is a visual judgement against
aerial imagery. For each of the ${SAMPLE_SIZE} rows in the worksheet:

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

  console.log(`drew ${SAMPLE_SIZE} of ${population.length} geocoded (${total} PB total)`);
  console.log(`  seed        : ${seed}`);
  console.log(`  fingerprint : ${fingerprint}`);
  console.log(`  worksheet   : ${path.relative(ROOT, CSV_PATH)}`);
  console.log(`  protocol    : ${path.relative(ROOT, DOC_PATH)}`);
}

if (require.main === module) main();

module.exports = { rng, sample };
