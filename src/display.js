'use strict';

/**
 * The displayed population — DEC-009, DEC-015, FR-104, AC-E2-GATE.
 *
 * One definition of "which establishments Safe Eats shows", imported by both the
 * map API and `scripts/draw-sample.js`. It lived only in the sample script once,
 * which meant the accuracy gate could measure a population the map did not
 * render — the drift commit 857098b closed. A gate that samples a different set
 * than it ships is not a gate, so the definition is shared rather than copied.
 *
 *   counties       Palm Beach (60), Broward (16), Dade (23)
 *   type 2010      permanent food service; the other four types are mobile
 *                  vendors, caterers, temporary events and vending machines,
 *                  which are not premises a diner can walk into (DEC-009)
 *
 * Geocoding is NOT part of this predicate. A 2010 establishment without
 * coordinates is still in the population and still missing from the map; folding
 * "has a position" into the definition would hide the coverage gap NFR-07
 * measures. Callers that need pins add `AND lat IS NOT NULL` themselves.
 *
 * WHY COUNTY SCOPING IS A PARAMETER
 *
 * The accuracy gate is per county, not per product (DEC-015). Palm Beach has a
 * drawn sample awaiting hand verification, and adding Broward and Dade to the
 * displayed population would otherwise change the population that sample was
 * drawn from and invalidate the pending work. Scoping the gate to one county
 * keeps that draw exactly as it was, and gives each new county its own bar to
 * clear before it is shown.
 */

const COUNTIES = Object.freeze({
  60: 'Palm Beach',
  16: 'Broward',
  23: 'Dade',
});

const DISPLAYED_COUNTIES = Object.freeze(Object.keys(COUNTIES));
const DISPLAYED_LICENSE_TYPES = Object.freeze(['2010']);

/** Human label for a county code, for UI and reporting. */
const countyName = (code) => COUNTIES[String(code)] ?? String(code);

/**
 * SQL predicate plus its bound parameters, for composition into a WHERE clause.
 * Values stay bound rather than interpolated so that widening the scope never
 * becomes a string-concatenation review.
 *
 * @param {string} alias  table alias the predicate is written against
 * @param {object} [opts]
 * @param {string|string[]} [opts.counties]  narrow to one county or a subset —
 *   the accuracy gate uses this to hold a single county steady while the
 *   product covers three.
 */
function displayedPredicate(alias = 'e', { counties = DISPLAYED_COUNTIES } = {}) {
  const scope = (Array.isArray(counties) ? counties : [counties]).map(String);

  const unknown = scope.filter((c) => !(c in COUNTIES));
  if (unknown.length) {
    // A typo here would silently return an empty map rather than an error.
    throw new Error(`Not a displayed county: ${unknown.join(', ')}`);
  }

  const countyMarks = scope.map(() => '?').join(', ');
  const typeMarks = DISPLAYED_LICENSE_TYPES.map(() => '?').join(', ');

  return {
    sql: `${alias}.county_code IN (${countyMarks}) AND ${alias}.license_type_code IN (${typeMarks})`,
    params: [...scope, ...DISPLAYED_LICENSE_TYPES],
    counties: scope,
  };
}

module.exports = {
  COUNTIES,
  DISPLAYED_COUNTIES,
  DISPLAYED_LICENSE_TYPES,
  countyName,
  displayedPredicate,
};
