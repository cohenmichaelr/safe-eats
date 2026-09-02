'use strict';

/**
 * The displayed population — DEC-009, FR-104, AC-E2-GATE.
 *
 * One definition of "which establishments Safe Eats shows", imported by both the
 * map API and `scripts/draw-sample.js`. It lived only in the sample script, which
 * meant the accuracy gate could measure a population the map did not render — the
 * exact drift commit 857098b was fixed to close. A gate that samples a different
 * set than it ships is not a gate, so the definition is shared rather than
 * duplicated.
 *
 *   county 60      — Palm Beach (District 2 also carries Broward and Martin)
 *   type 2010      — permanent food service; the other four types are mobile
 *                    vendors, caterers, temporary events and vending machines,
 *                    which are not premises a diner can walk into (DEC-009)
 *
 * Geocoding is NOT part of this predicate. A 2010 establishment without
 * coordinates is still in the population and still missing from the map; folding
 * "has a position" into the definition would hide the coverage gap NFR-07
 * measures. Callers that need pins add `AND lat IS NOT NULL` themselves.
 */

const DISPLAYED_COUNTY = '60';
const DISPLAYED_LICENSE_TYPES = Object.freeze(['2010']);

/**
 * SQL predicate plus its bound parameters, for composition into a WHERE clause.
 * Returned as placeholders rather than interpolated literals so the values stay
 * bound even though they are constants today — a later type addition should not
 * have to also become a string-concatenation review.
 *
 * @param {string} alias table alias the predicate is written against
 */
function displayedPredicate(alias = 'e') {
  const marks = DISPLAYED_LICENSE_TYPES.map(() => '?').join(', ');
  return {
    sql: `${alias}.county_code = ? AND ${alias}.license_type_code IN (${marks})`,
    params: [DISPLAYED_COUNTY, ...DISPLAYED_LICENSE_TYPES],
  };
}

module.exports = { DISPLAYED_COUNTY, DISPLAYED_LICENSE_TYPES, displayedPredicate };
