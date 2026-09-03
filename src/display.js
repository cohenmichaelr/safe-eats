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
 *   counties       all 67 (DEC-017); before that, Palm Beach, Broward and Dade
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

/**
 * Every Florida county, code → name, taken from the extract's own
 * `Location County` values rather than typed from an atlas (DEC-017).
 *
 * The codes are contiguous, 11 to 77, which is 67 values for 67 counties — the
 * property `migrations/007_statewide_counties.sql` leans on to express
 * "a Florida county" as a range.
 * DBPR also publishes ten out-of-state codes (701–746) carrying 17 rows and no
 * restaurants at all; the range is what keeps them out.
 */
const COUNTIES = Object.freeze({
  11: 'Alachua',
  12: 'Baker',
  13: 'Bay',
  14: 'Bradford',
  15: 'Brevard',
  16: 'Broward',
  17: 'Calhoun',
  18: 'Charlotte',
  19: 'Citrus',
  20: 'Clay',
  21: 'Collier',
  22: 'Columbia',
  23: 'Dade',
  24: 'DeSoto',
  25: 'Dixie',
  26: 'Duval',
  27: 'Escambia',
  28: 'Flagler',
  29: 'Franklin',
  30: 'Gadsden',
  31: 'Gilchrist',
  32: 'Glades',
  33: 'Gulf',
  34: 'Hamilton',
  35: 'Hardee',
  36: 'Hendry',
  37: 'Hernando',
  38: 'Highlands',
  39: 'Hillsborough',
  40: 'Holmes',
  41: 'Indian River',
  42: 'Jackson',
  43: 'Jefferson',
  44: 'Lafayette',
  45: 'Lake',
  46: 'Lee',
  47: 'Leon',
  48: 'Levy',
  49: 'Liberty',
  50: 'Madison',
  51: 'Manatee',
  52: 'Marion',
  53: 'Martin',
  54: 'Monroe',
  55: 'Nassau',
  56: 'Okaloosa',
  57: 'Okeechobee',
  58: 'Orange',
  59: 'Osceola',
  60: 'Palm Beach',
  61: 'Pasco',
  62: 'Pinellas',
  63: 'Polk',
  64: 'Putnam',
  65: 'St. Johns',
  66: 'St. Lucie',
  67: 'Santa Rosa',
  68: 'Sarasota',
  69: 'Seminole',
  70: 'Sumter',
  71: 'Suwannee',
  72: 'Taylor',
  73: 'Union',
  74: 'Volusia',
  75: 'Wakulla',
  76: 'Walton',
  77: 'Washington',
});

const DISPLAYED_COUNTIES = Object.freeze(Object.keys(COUNTIES));
const DISPLAYED_LICENSE_TYPES = Object.freeze(['2010']);

/**
 * Licence type labels, from the DEC-009 census of what the extract contains.
 * Only the raw browser uses these — the map shows 2010 alone and never has to
 * name the others. An unmapped code renders as the code itself rather than a
 * guess: `2012` appears exactly once in the loaded data and this project does
 * not invent a label for a row it has not identified.
 */
const LICENSE_TYPES = Object.freeze({
  2010: 'Permanent food service',
  2013: 'Caterer',
  2014: 'Mobile food dispensing vehicle',
  2015: 'Vending machine',
  2016: 'Temporary event',
});

const licenseTypeName = (code) => LICENSE_TYPES[String(code)] ?? String(code ?? '');

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
  LICENSE_TYPES,
  countyName,
  licenseTypeName,
  displayedPredicate,
};
