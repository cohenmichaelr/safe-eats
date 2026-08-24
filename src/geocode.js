'use strict';

/**
 * Batch geocoder — FR-201, FR-203, FR-205.
 *
 * Tier 1 is the US Census Bureau batch geocoder: free, no key, and well suited to
 * the ZIP+4 US addresses the DBPR extract carries. A paid tier is deliberately NOT
 * wired here — decision OPEN-2 makes it conditional on Census coverage landing
 * under 95%, and that number does not exist until this has run.
 *
 * Two invariants from CLAUDE.md are structural here:
 *
 *   1. This is the ONLY module that writes establishment.lat/lng. ingest.js lists
 *      its upsert columns explicitly and omits them.
 *   2. Results land in geocode_cache first, keyed on normalized address, and are
 *      projected onto establishment from there. The cache is never truncated by an
 *      ingest, so coordinates accumulate across reloads instead of resetting —
 *      this is what keeps AUD F4 fixed rather than merely repaired.
 *
 *   node src/geocode.js            geocode every uncached address
 *   node src/geocode.js --limit N  stop after N addresses (smoke test)
 *   node src/geocode.js --retry    also retry addresses cached as unmatched
 */

const { open } = require('./db');

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const BENCHMARK = 'Public_AR_Current';

/** Census caps a batch at 10,000; smaller chunks fail faster and retry cheaper. */
const CHUNK_SIZE = 500;
const TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

const log = (...args) => console.log('[geocode]', ...args);

/**
 * Census returns one CSV row per input, with no header:
 *   id, input, Match|No_Match|Tie, Exact|Non_Exact, matched, "lon,lat", tigerId, L|R
 * The matched-address field contains commas, so this must be parsed as CSV.
 */
function parseCensusResponse(text) {
  const { parse } = require('csv-parse/sync');
  const rows = parse(text, { columns: false, relax_column_count: true, skip_empty_lines: true });
  const out = [];

  for (const row of rows) {
    const [id, , indicator, matchType, matchedAddress, lonLat, tigerId, side] = row;
    if (indicator !== 'Match') {
      out.push({ id, matched: false, reason: indicator || 'No_Match' });
      continue;
    }
    const [lonRaw, latRaw] = String(lonLat || '').split(',');
    const lng = Number.parseFloat(lonRaw);
    const lat = Number.parseFloat(latRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      out.push({ id, matched: false, reason: 'unparseable-coordinates' });
      continue;
    }
    out.push({
      id, matched: true, lat, lng,
      quality: `${matchType || 'Unknown'}${side ? `/${side}` : ''}`,
      matchedAddress, tigerId,
    });
  }
  return out;
}

/** Census wants a headerless CSV: id, street, city, state, zip. */
function toBatchCsv(records) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return records
    .map((r) => [r.id, r.street, r.city, r.state || 'FL', r.zip].map(esc).join(','))
    .join('\n');
}

async function postChunk(records, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('benchmark', BENCHMARK);
    form.append(
      'addressFile',
      new Blob([toBatchCsv(records)], { type: 'text/csv' }),
      'addresses.csv',
    );

    const res = await fetch(ENDPOINT, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // A Census outage returns an HTML error page with a 200. Same lesson as AUD F1:
    // check the payload, not the status line.
    if (/^\s*<(?:!doctype|html)/i.test(text)) {
      throw new Error('Census returned a markup document, not CSV');
    }
    return parseCensusResponse(text);
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    const backoff = 2000 * attempt;
    log(`chunk failed (${err.message}); retry ${attempt + 1}/${MAX_ATTEMPTS} in ${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
    return postChunk(records, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Addresses needing a lookup: one representative row per distinct normalized
 * address, excluding anything already cached.
 */
function pendingAddresses(db, { retry = false, limit = 0 } = {}) {
  // Default: anything not yet in the cache at all.
  // --retry:  additionally re-attempt rows cached as unmatched (lat IS NULL),
  //           while still skipping addresses already resolved.
  const uncached = retry
    ? '(c.normalized_address IS NULL OR c.lat IS NULL)'
    : 'c.normalized_address IS NULL';

  const sql = `
    SELECT e.normalized_address AS key,
           MIN(e.address) AS street,
           MIN(e.city)    AS city,
           MIN(e.zip)     AS zip
      FROM establishment e
      LEFT JOIN geocode_cache c ON c.normalized_address = e.normalized_address
     WHERE e.normalized_address IS NOT NULL
       AND e.normalized_address <> ''
       AND ${uncached}
     GROUP BY e.normalized_address
     ORDER BY e.normalized_address
     ${limit > 0 ? `LIMIT ${Number(limit)}` : ''}
  `;
  return db.prepare(sql).all();
}

function writeCache(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO geocode_cache (normalized_address, lat, lng, quality, source, resolved_at)
    VALUES (@normalized_address, @lat, @lng, @quality, @source, @resolved_at)
    ON CONFLICT(normalized_address) DO UPDATE SET
      lat         = excluded.lat,
      lng         = excluded.lng,
      quality     = excluded.quality,
      source      = excluded.source,
      resolved_at = excluded.resolved_at
  `);
  const run = db.transaction((batch) => { for (const r of batch) stmt.run(r); });
  run(rows);
}

/**
 * Project the cache onto establishment. This is the only write to lat/lng in the
 * codebase; an unmatched cache row leaves the columns null rather than zeroed.
 */
function projectOntoEstablishments(db) {
  const result = db.prepare(`
    UPDATE establishment
       SET lat             = (SELECT c.lat     FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           lng             = (SELECT c.lng     FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           geocode_source  = (SELECT c.source  FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           geocode_quality = (SELECT c.quality FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address)
     WHERE EXISTS (
       SELECT 1 FROM geocode_cache c
        WHERE c.normalized_address = establishment.normalized_address
          AND c.lat IS NOT NULL
     )
  `).run();
  return result.changes;
}

function coverage(db) {
  const total = db.prepare('SELECT COUNT(*) n FROM establishment').get().n;
  const done = db.prepare('SELECT COUNT(*) n FROM establishment WHERE lat IS NOT NULL').get().n;
  return { total, done, pct: total === 0 ? 0 : (100 * done) / total };
}

async function main() {
  const argv = process.argv.slice(2);
  const retry = argv.includes('--retry');
  const limitFlag = argv.indexOf('--limit');
  const limit = limitFlag >= 0 ? Number(argv[limitFlag + 1]) || 0 : 0;

  const db = open();
  const pending = pendingAddresses(db, { retry, limit });
  log(`${pending.length} address(es) to resolve (tier 1: Census ${BENCHMARK})`);

  if (pending.length === 0) {
    const c = coverage(db);
    log(`nothing to do — coverage ${c.done}/${c.total} (${c.pct.toFixed(1)}%)`);
    return;
  }

  const resolvedAt = new Date().toISOString();
  let matched = 0;
  let unmatched = 0;

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE);
    const records = chunk.map((row, j) => ({
      id: String(i + j),
      street: row.street,
      city: row.city,
      zip: (row.zip || '').slice(0, 5),
    }));

    const started = Date.now();
    const results = await postChunk(records);
    const byId = new Map(results.map((r) => [String(r.id), r]));

    const cacheRows = chunk.map((row, j) => {
      const r = byId.get(String(i + j));
      if (r?.matched) {
        matched += 1;
        return {
          normalized_address: row.key,
          lat: r.lat, lng: r.lng,
          quality: r.quality, source: 'census', resolved_at: resolvedAt,
        };
      }
      unmatched += 1;
      return {
        normalized_address: row.key,
        lat: null, lng: null,
        quality: r?.reason || 'No_Match', source: 'census', resolved_at: resolvedAt,
      };
    });

    writeCache(db, cacheRows);
    log(
      `chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(pending.length / CHUNK_SIZE)} — ` +
      `${cacheRows.filter((r) => r.lat !== null).length}/${chunk.length} matched ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  const updated = projectOntoEstablishments(db);
  const c = coverage(db);

  log(`matched ${matched}, unmatched ${unmatched}`);
  log(`establishment rows updated: ${updated}`);
  log(`coverage: ${c.done}/${c.total} (${c.pct.toFixed(2)}%) — Gate 1 bar is 95%`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[geocode] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { parseCensusResponse, toBatchCsv, pendingAddresses, coverage };
