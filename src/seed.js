'use strict';

/**
 * Geocode cache seeding — task 12, FR-204, AUD F4.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A fresh Render disk is empty. The service boots, the scheduler sees no
 * successful ingest, and a refresh runs: both extracts load in about three
 * seconds, and then `geocode.js` re-resolves every address from scratch —
 * roughly 3,900 of them through the Census geocoder, and the 272 that only the
 * paid tier could resolve would have to be bought again.
 *
 * The establishments and inspections are cheap to rebuild because DBPR
 * republishes them. **The geocode cache is not.** It is the one artefact in
 * this system that cost time and money to produce and that nobody else holds a
 * copy of. Treating it as disposable is the same mistake as AUD F4, which lost
 * every accumulated coordinate on every import — just moved from SQL to
 * infrastructure.
 *
 * So the cache is committed to the repository as a CSV and restored on boot
 * when the table is empty. A deploy to a new disk, a new host, or a laptop
 * that has never run the geocoder all converge on the same coordinates.
 *
 * WHY BOOT AND NOT BUILD
 *
 * Render disks are "accessible by only a single service instance, and only at
 * runtime" — so nothing written during the build survives to where the database
 * lives. Seeding has to happen in the running process.
 *
 * WHY THIS DOES NOT VIOLATE INVARIANT 1
 *
 * Ingest still never writes coordinates. This writes `geocode_cache`, which is
 * geocoding's own table, and it writes rows that geocoding itself produced —
 * carrying their original `source`, `quality` and `resolved_at`. It is a
 * restore of provenance, not an invention of it, and it never touches
 * `establishment.lat/lng`: the IFC-1 triggers still stand between the cache and
 * any position on the map.
 */

const fs = require('node:fs');
const path = require('node:path');

const SEED_PATH = path.join(__dirname, '..', 'seed', 'geocode-cache.csv');

/** Minimal RFC4180-ish parser — the file is ours and its shape is fixed. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/**
 * Restore the committed cache if the table is empty.
 *
 * Deliberately a no-op when anything is already cached: a running instance has
 * a cache at least as good as the seed, and overwriting it with an older file
 * would throw away every resolution made since the seed was cut.
 *
 * @returns {{seeded: number, reason: string}}
 */
function seedGeocodeCache(db, { force = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM geocode_cache').get().n;
  if (existing > 0 && !force) {
    return { seeded: 0, reason: `cache already holds ${existing} row(s)` };
  }
  if (!fs.existsSync(SEED_PATH)) {
    return { seeded: 0, reason: 'no seed file committed' };
  }

  const rows = parseCsv(fs.readFileSync(SEED_PATH, 'utf8'));

  // DO NOTHING rather than DO UPDATE: if a row is somehow already present it was
  // resolved by this deployment, and a live resolution outranks a committed one.
  const insert = db.prepare(
    `INSERT INTO geocode_cache (normalized_address, lat, lng, quality, source, resolved_at)
     VALUES (@normalized_address, @lat, @lng, @quality, @source, @resolved_at)
     ON CONFLICT(normalized_address) DO NOTHING`
  );

  const load = db.transaction((all) => {
    let n = 0;
    for (const r of all) {
      if (!r.normalized_address) continue;
      insert.run({
        normalized_address: r.normalized_address,
        // Coarse rows are cached with null coordinates on purpose — they record
        // "asked, and the answer was not good enough", which is what stops the
        // geocoder paying to ask again. That distinction has to survive the trip.
        lat: r.lat === '' ? null : Number(r.lat),
        lng: r.lng === '' ? null : Number(r.lng),
        quality: r.quality || null,
        source: r.source || null,
        resolved_at: r.resolved_at || null,
      });
      n += 1;
    }
    return n;
  });

  return { seeded: load(rows), reason: 'restored from seed/geocode-cache.csv' };
}

module.exports = { seedGeocodeCache, SEED_PATH };
