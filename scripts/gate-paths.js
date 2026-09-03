'use strict';

/**
 * Where each county's accuracy gate lives — DEC-015, DEC-016.
 *
 * The gate is per county, because the counties are not alike where it matters.
 * Measured 3 Sep 2026 across the displayed populations:
 *
 *   grid-direction addresses ("NW 7 ST")   Palm Beach 5.8%   Broward 13.2%   Dade 51.7%
 *   numbered streets                       Palm Beach 7.3%   Broward 12.5%   Dade 51.7%
 *
 * Over half of Dade's addresses use the Miami grid, where "NW 7 ST" and
 * "NW 7 AVE" are different streets that both exist and one wrong character
 * lands miles away. A Palm Beach result carries almost no information about
 * that, so pooling the three into one sample would produce a number that reads
 * as a three-county claim while measuring mostly one county's address shapes.
 *
 * All three geocoders self-report ~99.5% "exact/rooftop", which is exactly why
 * that figure cannot stand in for a gate: it is the geocoder grading its own
 * homework, and it returns ROOFTOP for the wrong rooftop just as confidently.
 *
 * PALM BEACH KEEPS ITS ORIGINAL SEED AND FILENAME.
 *
 * County 60 has a sample already drawn and awaiting verification. Changing its
 * seed would make the drawn rows unreproducible, and changing its filename
 * would orphan the pending work. Both are pinned here rather than derived, so
 * the general scheme applies to new counties without disturbing the one in
 * flight.
 */

const path = require('node:path');

const DOCS = path.join(__dirname, '..', 'docs');

/** County 60's artefacts predate the per-county scheme and are held fixed. */
const LEGACY = Object.freeze({
  60: {
    csv: '07-accuracy-sample.csv',
    doc: '07-accuracy-gate.md',
    history: '07-draw-history.json',
    seed: 'safe-eats/AC-E2-GATE/2026-08-24',
  },
});

/** The drawn sample size. 100 supports the >=99/100 threshold the PRD sets. */
const SAMPLE_SIZE = 100;

function gatePaths(county) {
  const code = String(county);
  const legacy = LEGACY[code];

  return {
    county: code,
    csv: path.join(DOCS, legacy?.csv ?? `07-accuracy-sample-${code}.csv`),
    doc: path.join(DOCS, legacy?.doc ?? `07-accuracy-gate-${code}.md`),
    history: path.join(DOCS, legacy?.history ?? `07-draw-history-${code}.json`),
    // A distinct seed per county, so two counties never draw correlated
    // positions out of the same stream.
    seed: legacy?.seed ?? `safe-eats/AC-E2-GATE/county-${code}/2026-09-03`,
  };
}

module.exports = { gatePaths, SAMPLE_SIZE, DOCS };
