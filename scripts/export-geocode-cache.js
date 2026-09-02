'use strict';

/**
 * Cut a committed seed of `geocode_cache` — see `src/seed.js` for why.
 *
 * Run after a geocoding session that resolved new addresses, especially one
 * that used the paid tier, and commit the result. The file is the only copy of
 * work that cost money; leaving it solely on one disk is how it gets lost.
 *
 *   node scripts/export-geocode-cache.js
 */

const fs = require('node:fs');
const path = require('node:path');

const { open } = require('../src/db');
const { SEED_PATH } = require('../src/seed');

const COLUMNS = ['normalized_address', 'lat', 'lng', 'quality', 'source', 'resolved_at'];

const escape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main() {
  const db = open({ readonly: true });

  // Ordered by address so the committed file has a stable diff: a re-export
  // after resolving twelve new addresses should show twelve added lines, not a
  // reshuffle nobody can review.
  const rows = db
    .prepare(`SELECT ${COLUMNS.join(', ')} FROM geocode_cache ORDER BY normalized_address`)
    .all();
  db.close();

  const csv = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => escape(r[c])).join(','))].join('\n');
  fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true });
  fs.writeFileSync(SEED_PATH, `${csv}\n`);

  const resolved = rows.filter((r) => r.lat !== null).length;
  const bySource = rows.reduce((acc, r) => ((acc[r.source || 'unknown'] = (acc[r.source || 'unknown'] || 0) + 1), acc), {});

  console.log(`\nWrote ${SEED_PATH}`);
  console.log(`  ${rows.length} cached address(es), ${resolved} with coordinates`);
  console.log(`  by source: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  ${(fs.statSync(SEED_PATH).size / 1024).toFixed(0)} KB\n`);
  console.log('  Commit this. It is the only copy of the paid resolutions.\n');
}

if (require.main === module) main();
