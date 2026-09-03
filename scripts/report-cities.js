'use strict';

/**
 * City spellings with no alias — the report `src/cities.js` promises.
 *
 * That module canonicalises city names by hand, and explains at length why:
 * edit distance, measured, merged five genuinely different cities (DANIA into
 * Davie, OAKLAND into Parkland). Hand-written aliases are safe but they are
 * only as complete as somebody's attention, and statewide the surface grew from
 * 201 spellings across three counties to whatever 67 counties publish.
 *
 * So this lists what is unmapped, loudest first, per county. A spelling here is
 * not necessarily wrong — most are simply the real name of a place nobody has
 * had to alias. What matters is the pattern the module warns about: a rare
 * spelling sitting beside a common one it plainly belongs to, splitting one
 * city's establishments across two filter entries with no symptom on screen.
 *
 * It decides nothing. Adding an alias stays a human act, checked by eye against
 * the county it belongs to.
 *
 *   node scripts/report-cities.js                 counties with suspicious pairs
 *   node scripts/report-cities.js --county 39     one county, every spelling
 *   node scripts/report-cities.js --all           every county, every spelling
 */

const { open } = require('../src/db');
const { displayedPredicate, countyName } = require('../src/display');
const { ALIASES, tidy } = require('../src/cities');

/**
 * Cheap similarity, used only to ORDER the report — never to change data.
 * Levenshtein distance capped at 2, plus the prefix/abbreviation shapes that
 * dominate this data ("FT LAUDERDALE", "MIAMI BCH").
 */
function looksRelated(a, b) {
  if (a === b) return false;
  if (a.replace(/\s/g, '') === b.replace(/\s/g, '')) return true;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (long.startsWith(short) && long.length - short.length <= 6) return true;

  if (Math.abs(a.length - b.length) > 2) return false;

  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length] <= 2;
}

function main() {
  const argv = process.argv.slice(2);
  const countyFlag = argv.indexOf('--county');
  const onlyCounty = countyFlag >= 0 ? argv[countyFlag + 1] : null;
  const showAll = argv.includes('--all');

  const db = open({ readonly: true });
  const displayed = displayedPredicate('e');

  const rows = db
    .prepare(
      `SELECT e.county_code, e.city, COUNT(*) AS n
         FROM establishment e
        WHERE ${displayed.sql} AND e.city IS NOT NULL AND TRIM(e.city) <> ''
     GROUP BY e.county_code, e.city
     ORDER BY e.county_code, n DESC`
    )
    .all(...displayed.params);

  /*
   * Grouped on the tidied spelling, not the raw one. `tidy` is what
   * canonicalCity keys on, so two raw values differing only in case or spacing
   * are already one entry in the filter — reporting them separately would
   * invite an alias for a split that does not exist.
   */
  const byCounty = new Map();
  for (const row of rows) {
    if (onlyCounty && String(row.county_code) !== String(onlyCounty)) continue;
    const bucket = byCounty.get(row.county_code) ?? new Map();
    const key = tidy(row.city);
    bucket.set(key, (bucket.get(key) ?? 0) + row.n);
    byCounty.set(row.county_code, bucket);
  }

  let flagged = 0;
  const lines = ['Unmapped city spellings — src/cities.js', ''];

  for (const [county, counts] of [...byCounty.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const cities = [...counts.entries()]
      .map(([city, n]) => ({ city, n }))
      .sort((a, b) => b.n - a.n);
    const unmapped = cities.filter((c) => !(c.city in ALIASES));

    // The pairs worth a person's time: a rare spelling next to a common one it
    // resembles. Everything else is just a city with a name.
    const suspicious = [];
    for (const rare of unmapped) {
      for (const common of cities) {
        if (common.n >= rare.n * 5 && looksRelated(rare.city, common.city)) {
          suspicious.push({ rare, common });
          break;
        }
      }
    }

    if (!suspicious.length && !showAll && !onlyCounty) continue;

    lines.push(`${countyName(county)} (${county}) — ${cities.length} spellings, ${unmapped.length} unmapped`);
    for (const { rare, common } of suspicious) {
      flagged += 1;
      lines.push(`  ? ${rare.city} (${rare.n})  looks like  ${common.city} (${common.n})`);
    }
    if (showAll || onlyCounty) {
      for (const c of unmapped) lines.push(`    ${String(c.n).padStart(5)}  ${c.city}`);
    }
    lines.push('');
  }

  lines.push(
    flagged
      ? `${flagged} pair(s) worth a look. Each needs a person to check it against the county's real ` +
        'city list before an alias is added — see the five that edit distance got wrong in src/cities.js.'
      : 'No suspicious pairs. Every rare spelling stands on its own.'
  );

  console.log(lines.join('\n'));
  db.close();
}

if (require.main === module) main();

module.exports = { looksRelated };
