'use strict';

/**
 * City name canonicalisation — FR-407.
 *
 * The licence data carries 193 distinct city strings across three counties for
 * roughly 150 real places, and 100 establishments sit behind a misspelling.
 * Listed raw, the city filter is broken in a way that looks like it works: a
 * reader filtering Royal Palm Beach sees 106 and silently misses the 12 filed
 * under "ROYAL PLM BEACH" and "ROAYL PALM BEACH".
 *
 * WHY THIS MAP IS HAND-WRITTEN AND NOT COMPUTED
 *
 * The obvious approach is edit distance: group any rare spelling within two
 * characters of a common one. That was measured, and it is wrong — dangerously,
 * quietly wrong. Of 36 candidates it proposed, five merged genuinely different
 * cities:
 *
 *   DANIA (15)          -> Davie              Dania Beach is its own city
 *   OAKLAND (2)         -> Parkland           Oakland Park is its own city
 *   N MIAMI BEACH (2)   -> Miami Beach        North Miami Beach is its own city
 *   BAY HARBOR (1)      -> Bal Harbour        Bay Harbor Islands is its own place
 *   W MIAMI (1)         -> Miami              West Miami is its own city
 *
 * Shipping that would have filed fifteen Dania Beach restaurants under Davie —
 * inspection records attached to the wrong municipality, and no symptom on the
 * screen. Every one of those five has an obvious correct answer that a person
 * can see and an algorithm cannot, and each correct target already exists in the
 * data (DANIA BEACH 107, OAKLAND PARK 126, NORTH MIAMI BEACH 148, BAY HARBOR
 * ISLANDS 10, WEST MIAMI 9).
 *
 * So the aliases are enumerated, each one checked by eye against the county it
 * belongs to. `scripts/report-cities.js` lists anything unmapped, so a new
 * spelling in next week's extract surfaces as a question rather than as a
 * silently split filter.
 *
 * The raw value is never overwritten. `establishment.city` keeps exactly what
 * DBPR published; this maps it for display and filtering only.
 */

/** Whitespace and casing are safe to normalise for everything. */
const tidy = (value) => (value ?? '').toString().toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Explicit aliases, keyed by the tidied raw string. Every entry was read against
 * its county's real city list before being added.
 */
const ALIASES = Object.freeze({
  // ── Palm Beach ──────────────────────────────────────────────────────────
  'ROYAL PLM BEACH': 'ROYAL PALM BEACH',
  'ROAYL PALM BEACH': 'ROYAL PALM BEACH',
  'ROYAL PLM BCH': 'ROYAL PALM BEACH',
  'GREEN ACRES': 'GREENACRES',
  'GEENACRES': 'GREENACRES',
  'GREENACRES CITY': 'GREENACRES',
  'BOYTON BEACH': 'BOYNTON BEACH',
  'BOYNTON': 'BOYNTON BEACH',
  'WEST PLAM BEACH': 'WEST PALM BEACH',
  'W PALM BEACH': 'WEST PALM BEACH',       // West Palm Beach, not Palm Beach
  'PLAM BEACH GARDENS': 'PALM BEACH GARDENS',
  'TOWN O F PALM BEACH': 'PALM BEACH',
  'VILLAGE OF WELLINGTO': 'WELLINGTON',
  'VILLAGE OFWELLINGTON': 'WELLINGTON',
  'LAKE PARK FLORIDA': 'LAKE PARK',
  'VILLAGE OF GOLF': 'GOLF',

  // ── Broward ─────────────────────────────────────────────────────────────
  'FT LAUDERDALE': 'FORT LAUDERDALE',
  'FORTLAUDERDALE': 'FORT LAUDERDALE',
  'DANIA': 'DANIA BEACH',                  // NOT Davie
  'OAKLAND': 'OAKLAND PARK',               // NOT Parkland
  'CORAL SPRING': 'CORAL SPRINGS',
  'WILTON MANOR': 'WILTON MANORS',
  'POMPOANO BEACH': 'POMPANO BEACH',
  'POMPANP BEACH': 'POMPANO BEACH',
  'POMPANO BACH': 'POMPANO BEACH',
  'PEMBROKEPINES': 'PEMBROKE PINES',
  'PEMBROKE PINE': 'PEMBROKE PINES',
  'MIRMAR': 'MIRAMAR',
  'DEERFILD BEACH': 'DEERFIELD BEACH',

  // ── Dade ────────────────────────────────────────────────────────────────
  'OPA LOCKA': 'OPA-LOCKA',
  'OPALOCKA': 'OPA-LOCKA',
  'N MIAMI BEACH': 'NORTH MIAMI BEACH',    // NOT Miami Beach
  'W MIAMI': 'WEST MIAMI',                 // NOT Miami
  'BAY HARBOR': 'BAY HARBOR ISLANDS',      // NOT Bal Harbour
  'BAL HARBOR': 'BAL HARBOUR',
  'SUNNY ISLES BCH': 'SUNNY ISLES BEACH',
  'SWETWATER': 'SWEETWATER',
  'PALMETO BAY': 'PALMETTO BAY',
  'MIAMIA BEACH': 'MIAMI BEACH',
  'MIAMI BCH': 'MIAMI BEACH',
  'MIAMI SPRING': 'MIAMI SPRINGS',
  'MIAMI GARDERNS': 'MIAMI GARDENS',
});

/**
 * The canonical spelling for a raw city value.
 * Unknown values pass through tidied — never dropped, never guessed at.
 */
function canonicalCity(raw) {
  const key = tidy(raw);
  if (key === '') return null;
  return ALIASES[key] ?? key;
}

/** Title case for display: "WEST PALM BEACH" reads better as "West Palm Beach". */
function titleCase(value) {
  return (value ?? '')
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

module.exports = { canonicalCity, titleCase, ALIASES, tidy };
