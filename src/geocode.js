'use strict';

/**
 * Batch geocoder — FR-201, FR-203, FR-205.
 *
 * Two tiers, in cost order.
 *
 * Tier 1 is the US Census Bureau batch geocoder: free, no key, and well suited to
 * the ZIP+4 US addresses the DBPR extract carries. It resolved 92.82%.
 *
 * Tier 2 is the Google Geocoding API, gated behind decision OPEN-2 ("only if
 * Census coverage lands under 95%"). That condition fired, so it is wired — but it
 * runs ONLY over what tier 1 could not resolve, and only when asked with
 * --fallback. It took coverage to 98.86%. Re-running tier 1 costs nothing;
 * re-running tier 2 costs money, which is why it is not part of the default path.
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
 *   node src/geocode.js --fallback tier 2 over tier-1 failures (COSTS MONEY)
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

/* ─────────────────────────────── tier 2: paid fallback (OPEN-2) ─────────── */

/**
 * Google Geocoding API, run only over addresses Census could not resolve.
 *
 * Enabled by decision OPEN-2, whose trigger condition ("Census coverage under
 * 95%") fired at 92.82%.
 *
 * ACCEPTED   ROOFTOP, RANGE_INTERPOLATED
 * REJECTED   GEOMETRIC_CENTER, APPROXIMATE
 *
 * The rejection is the important half. Google always returns *something*; for an
 * address it cannot place it falls back to a street, locality or postcode
 * centroid, which can sit kilometres from the establishment. For a lookup tool
 * that is harmless. For a proximity tool measured by a 50 m gate it is worse than
 * no pin at all, because a missing pin is visibly missing whereas a centroid pin
 * looks authoritative. Coarse results are cached with their quality recorded and
 * lat/lng left null, so they count as uncovered rather than as bad coordinates.
 */
const PAID_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
const ACCEPTED_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED']);
const PAID_CONCURRENCY = 5;

/** Google echoes the key in the request URL; never let it reach a log. */
function redactKey(text) {
  return String(text).replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
}

async function geocodeOnePaid(address, apiKey) {
  const url = new URL(PAID_ENDPOINT);
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'country:US|administrative_area:FL');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();

  if (body.status === 'OVER_QUERY_LIMIT') {
    const err = new Error('OVER_QUERY_LIMIT');
    err.retryable = true;
    throw err;
  }
  if (body.status === 'REQUEST_DENIED') {
    throw new Error(`REQUEST_DENIED — ${redactKey(body.error_message || 'check that the Geocoding API is enabled for this key')}`);
  }
  if (body.status === 'ZERO_RESULTS') return { matched: false, reason: 'google:ZERO_RESULTS' };
  if (body.status !== 'OK') {
    throw new Error(`${body.status}${body.error_message ? ` — ${redactKey(body.error_message)}` : ''}`);
  }

  const top = body.results?.[0];
  const locationType = top?.geometry?.location_type || 'UNKNOWN';

  if (!ACCEPTED_LOCATION_TYPES.has(locationType)) {
    // Deliberately not a coordinate. See the comment above.
    return { matched: false, reason: `google:${locationType}-too-coarse` };
  }
  return {
    matched: true,
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    quality: `google:${locationType}`,
  };
}

/** Addresses Census left unresolved, with components re-derived from establishment. */
function unresolvedAddresses(db) {
  return db.prepare(`
    SELECT c.normalized_address AS key,
           MIN(e.address) AS street,
           MIN(e.city)    AS city,
           MIN(e.zip)     AS zip
      FROM geocode_cache c
      JOIN establishment e ON e.normalized_address = c.normalized_address
     WHERE c.lat IS NULL
     GROUP BY c.normalized_address
     ORDER BY c.normalized_address
  `).all();
}

async function runPaidFallback(db, { limit = 0 } = {}) {
  require('dotenv').config({ quiet: true });
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set — cannot run the paid fallback');
  }

  const all = unresolvedAddresses(db);
  const pending = limit > 0 ? all.slice(0, limit) : all;
  log(`tier 2 (Google Geocoding): ${pending.length} unresolved address(es)`);
  log(`  accepting ${[...ACCEPTED_LOCATION_TYPES].join(', ')}; coarser results are recorded as uncovered`);
  if (pending.length === 0) return { matched: 0, coarse: 0, zero: 0 };

  const resolvedAt = new Date().toISOString();
  const stats = { matched: 0, coarse: 0, zero: 0, failed: 0 };
  const cacheRows = [];
  let cursor = 0;

  async function worker() {
    while (cursor < pending.length) {
      const row = pending[cursor];
      cursor += 1;
      const address = `${row.street}, ${row.city}, FL ${String(row.zip || '').slice(0, 5)}`;

      let result;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          result = await geocodeOnePaid(address, apiKey);
          break;
        } catch (err) {
          if (!err.retryable || attempt === MAX_ATTEMPTS) {
            if (!err.retryable) throw err; // config errors must stop the run
            stats.failed += 1;
            result = { matched: false, reason: 'google:OVER_QUERY_LIMIT' };
            break;
          }
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      if (result.matched) {
        stats.matched += 1;
        cacheRows.push({
          normalized_address: row.key,
          lat: result.lat, lng: result.lng,
          quality: result.quality, source: 'google', resolved_at: resolvedAt,
        });
      } else {
        if (result.reason.includes('too-coarse')) stats.coarse += 1;
        else stats.zero += 1;
        cacheRows.push({
          normalized_address: row.key,
          lat: null, lng: null,
          quality: result.reason, source: 'google', resolved_at: resolvedAt,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: PAID_CONCURRENCY }, worker));
  writeCache(db, cacheRows);

  log(`tier 2 result — matched ${stats.matched}, too coarse ${stats.coarse}, no result ${stats.zero}`);
  return stats;
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

  // Tier 2 runs on its own: it only ever touches what tier 1 failed to resolve.
  if (argv.includes('--fallback')) {
    await runPaidFallback(db, { limit });
    const updated = projectOntoEstablishments(db);
    const c = coverage(db);
    log(`establishment rows updated: ${updated}`);
    log(`coverage: ${c.done}/${c.total} (${c.pct.toFixed(2)}%) — Gate 1 bar is 95%`);
    return;
  }

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

module.exports = {
  parseCensusResponse, toBatchCsv, pendingAddresses, coverage,
  redactKey, ACCEPTED_LOCATION_TYPES,
};
