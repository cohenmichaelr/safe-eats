'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const { open } = require('./db');
const { toSignal } = require('./signal');
const {
  IngestError,
  assertValidExtract,
  assertRowFloor,
} = require('./validate');

/**
 * DBPR ingest — FR-101, FR-102, FR-104, FR-106..FR-109.
 *
 * Statewide since DEC-017: all seven district extracts are fetched and every
 * Florida county code (11-77) is kept. A county is NOT confined to one district
 * file — see the scope comment below for the seven that are split.
 *
 * Do NOT revert to www.myfloridalicense.com/dbpr/hr/inspections/ — that host
 * serves a WordPress page which v1 saved as .csv for three years (AUD F1).
 */
const BASE = 'https://www2.myfloridalicense.com/sto/file_download/extracts';

/**
 * Counties in scope — all 67, and no district map (DEC-017).
 *
 * 006 derived the fetch list from a county-to-district map, on the measurement
 * that each of its three counties had all of its type-2010 rows in one district
 * file. Across the whole state that is false. Measured 3 Sep 2026, seven
 * counties are split, and the smaller half is the half a map would silently
 * drop:
 *
 *   57  Okeechobee     7 rows in d4,  84 in d7
 *   22  Columbia       1 in d4,      138 in d5
 *   15  Brevard     1,462 in d4,       1 in d5
 *   39  Hillsborough 3,348 in d3,      1 in d7
 *   63  Polk         1,329 in d3,      4 in d4
 *   70  Sumter         247 in d3,      1 in d5
 *   74  Volusia      1,426 in d4,      1 in d5
 *
 * So every district is fetched and the row's own county code decides what is
 * kept. That is 33 MB a week rather than 10, and it is the difference between
 * a complete county and a county missing the rows DBPR happened to file
 * elsewhere. A narrowed run (SAFE_EATS_COUNTY_CODES, which the /admin.html
 * dropdown sets) costs the same fetch: correct beats clever here, and the
 * alternative is reintroducing the map this comment exists to explain away.
 *
 * The codes are contiguous, 11 (Alachua) to 77 (Washington). DBPR also
 * publishes ten out-of-state codes in the 700s carrying 17 rows and no
 * restaurants; they are excluded here and by the CHECK in migration 007.
 */
const COUNTY_MIN = 11;
const COUNTY_MAX = 77;

const inScope = (code) => {
  const n = Number.parseInt((code ?? '').toString().trim(), 10);
  return Number.isFinite(n) && n >= COUNTY_MIN && n <= COUNTY_MAX;
};

/** Narrowing override — one county, or a list. Empty means the whole state. */
const COUNTY_CODES = (process.env.SAFE_EATS_COUNTY_CODES || '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

const NARROWED = COUNTY_CODES.length > 0;

/** Whether a row's county is wanted by this run. */
const wanted = (code) => {
  const value = (code ?? '').toString().trim();
  return NARROWED ? COUNTY_CODES.includes(value) : inScope(value);
};

const DISTRICTS = ['1', '2', '3', '4', '5', '6', '7'];

/** Retained for callers that still expect a single county — the accuracy gate. */
const COUNTY_CODE = COUNTY_CODES[0] ?? '60';
const DISTRICT = DISTRICTS[0];

/**
 * Row floors guard the fetched file, so they are per district. Measured across
 * all seven on 3 Sep 2026, the smallest of each kind is district 6: 5,314
 * licence rows and 1,891 inspection rows. The floors sit well under both, where
 * only a broken payload falls through — which is the job (AUD F1/F2).
 */
const sourcesFor = (district) => ({
  licenses: {
    dataset: `active-licenses-d${district}`,
    district,
    url: `${BASE}/hrfood${district}.csv`,
    expectedColumns: ['License Number', 'Business Name', 'Location Street Address', 'Location County Code'],
    rowFloor: 3000,
  },
  inspections: {
    dataset: `inspections-d${district}`,
    district,
    url: `${BASE}/${district}fdinspi.csv`,
    expectedColumns: ['License Number', 'Inspection Disposition', 'Inspection Date', 'County Number'],
    rowFloor: 1000,
  },
});

/** The single-district shape the tests and probe scripts still import. */
const SOURCES = sourcesFor(DISTRICT);

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'raw');

const log = (...args) => console.log(`[ingest]`, ...args);

// ── helpers ──────────────────────────────────────────────────────────────────

/** MM/DD/YYYY → YYYY-MM-DD, so dates sort and compare as strings. */
function toIsoDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((value || '').trim());
  if (!match) return null;
  const [, m, d, y] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Address normalization for the geocode cache key (FR-201).
 * Deliberately conservative: uppercase, collapse whitespace, strip punctuation,
 * drop the ZIP+4 suffix. Aggressive abbreviation expansion is deferred — it
 * risks collapsing genuinely distinct addresses.
 */
function normalizeAddress(street, city, zip) {
  const clean = (value) =>
    (value || '')
      .toString()
      .toUpperCase()
      .replace(/[.,#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const zip5 = (zip || '').toString().trim().slice(0, 5);
  return [clean(street), clean(city), zip5].filter(Boolean).join(', ');
}

const toInt = (value) => {
  const n = Number.parseInt((value ?? '').toString().trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * The join key between the two extracts, and the reason this function exists:
 *
 *   licence extract    "License Number" = "SEA6021991"   (alpha rank prefix)
 *   inspection extract "License Number" = "6021991"      (digits only)
 *
 * Joining the raw strings matches ZERO of 1,017 Palm Beach inspections. Stripping
 * the prefix matches 1,003 (98.6%); the 14 remaining orphans are inspections of
 * licences that have since lapsed and are absent from the active-licence extract.
 *
 * Digits alone collide (4,298 distinct for 4,304 licences) because the same number
 * is issued under different rank prefixes, so the licence type code is appended.
 */
function licenseKey(licenseNumber, licenseTypeCode) {
  const digits = (licenseNumber ?? '').toString().replace(/[^0-9]/g, '');
  const type = (licenseTypeCode ?? '').toString().replace(/[^0-9]/g, '');
  return `${digits}|${type}`;
}

async function fetchExtract(source) {
  log(`fetching ${source.dataset} → ${source.url}`);
  const response = await fetch(source.url, {
    headers: { Accept: 'text/csv,*/*', 'User-Agent': 'safe-eats-ingest/2.0' },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new IngestError(`HTTP ${response.status} ${response.statusText}`, {
      url: source.url,
      stage: 'fetch',
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // FR-105 — archive raw bytes BEFORE parsing, so a bad payload is inspectable.
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(ARCHIVE_DIR, `${source.dataset}-${stamp}.csv`);
  fs.writeFileSync(archivePath, buffer);

  // FR-106/107 — throws. Never warns. This is the v1 failure, structurally closed.
  assertValidExtract(buffer, {
    contentType: response.headers.get('content-type'),
    url: source.url,
    expectedColumns: source.expectedColumns,
  });

  log(`  ${(buffer.length / 1_048_576).toFixed(2)} MB · archived ${path.basename(archivePath)}`);
  return buffer;
}

/**
 * `relax_quotes` is required, and it forces the trimming to move into JS.
 *
 * District 5's licence file contains a quoted field with unescaped inner
 * quotes — a nickname, `"GARLAND "CRAIG" BRIGHAM"`. RFC 4180 wants those
 * doubled; DBPR does not double them. Without `relax_quotes` the parser aborts
 * the whole file, so one person's nickname would stop an entire district from
 * loading. That is the abort-don't-degrade invariant working exactly as
 * intended, and also completely useless to a reader in Miami.
 *
 * `relax_quotes` and `trim` cannot be combined — together they raise
 * CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE on precisely those rows. So every
 * value is trimmed here instead, which is what `trim: true` was doing anyway.
 *
 * The relaxed row keeps its stray quotes inside the value rather than being
 * dropped or silently shifting its columns, which is the behaviour to want:
 * a slightly ugly business name beats a missing establishment.
 */
function parseCsv(buffer) {
  const rows = parse(buffer, {
    columns: (header) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  });

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (typeof row[key] === 'string') row[key] = row[key].trim();
    }
  }
  return rows;
}

// ── establishments ───────────────────────────────────────────────────────────

function loadEstablishments(db, rows, runId, source) {
  const inCounty = rows.filter((r) => wanted(r['Location County Code']));

  /*
   * Two floors, and the difference matters.
   *
   * The first guards the PAYLOAD, before a row is written: a district file that
   * arrives short is broken whatever our county scope is. That is the AUD F1/F2
   * check and it never relaxes.
   *
   * The second guards the FILTER, and it can only apply to a statewide run.
   * Every district file carries thousands of in-scope rows when the scope is
   * all 67 counties, so a filter that returns almost nothing means the county
   * column moved. But a narrowed run (SAFE_EATS_COUNTY_CODES, set by the
   * /admin.html dropdown) legitimately matches nothing in six of the seven
   * files, so demanding 3,000 there would fail every single-county refresh.
   * Its floor is instead "the run as a whole wrote something", asserted once in
   * main() — the deliberate operator narrowing is what buys the relaxation, and
   * the payload guard above still stands between us and an HTML error page.
   */
  assertRowFloor(rows.length, source.rowFloor, { source: `${source.dataset} payload` });
  if (!NARROWED) {
    assertRowFloor(inCounty.length, source.rowFloor, {
      source: `${source.dataset} in-scope establishments`,
    });
  }

  /**
   * AUD F4 — the column list is explicit and omits lat/lng/geocode_*.
   * ON CONFLICT DO UPDATE preserves the row; INSERT OR REPLACE would delete and
   * reinsert it, discarding every coordinate. Never change this to REPLACE.
   */
  const upsert = db.prepare(`
    INSERT INTO establishment (
      establishment_id, license_key, license_number, name, address, normalized_address,
      city, zip, county_code, county_name, district,
      license_type_code, seats, risk_level, first_seen_at, last_seen_at
    ) VALUES (
      @establishment_id, @license_key, @license_number, @name, @address, @normalized_address,
      @city, @zip, @county_code, @county_name, @district,
      @license_type_code, @seats, @risk_level, @now, @now
    )
    ON CONFLICT(establishment_id) DO UPDATE SET
      license_key        = excluded.license_key,
      license_number     = excluded.license_number,
      name               = excluded.name,
      address            = excluded.address,
      normalized_address = excluded.normalized_address,
      city               = excluded.city,
      zip                = excluded.zip,
      county_code        = excluded.county_code,
      county_name        = excluded.county_name,
      district           = excluded.district,
      license_type_code  = excluded.license_type_code,
      seats              = excluded.seats,
      risk_level         = excluded.risk_level,
      last_seen_at       = excluded.last_seen_at
  `);

  const now = new Date().toISOString();
  let written = 0;

  db.transaction(() => {
    for (const row of inCounty) {
      const licenseNumber = (row['License Number'] || '').trim();
      if (!licenseNumber) continue;

      const street = row['Location Street Address'];
      const city = row['Location City'];
      const zip = row['Location Zip Code'];
      const key = licenseKey(licenseNumber, row['License Type Code']);
      const normalized = normalizeAddress(street, city, zip);

      upsert.run({
        // Address is part of the identity so that two businesses sharing one
        // licence number at different suites both survive the load.
        establishment_id: `${key}|${normalized}`,
        license_key: key,
        license_number: licenseNumber,
        name: (row['Business Name'] || row['Mailing Name'] || 'UNKNOWN').trim(),
        address: (street || '').trim(),
        normalized_address: normalized,
        city: (city || '').trim(),
        zip: (zip || '').trim(),
        // From the row, not from configuration. With more than one county in
        // scope, stamping a constant here would file every Broward restaurant
        // under Palm Beach — and the map would look entirely correct.
        county_code: (row['Location County Code'] || '').trim(),
        county_name: (row['Location County'] || '').trim(),
        district: (row['District'] || '').trim(),
        license_type_code: (row['License Type Code'] || '').trim(),
        seats: toInt(row['Number of Seats or Rental Units']),
        risk_level: (row['Base Risk Level'] || '').trim(),
        now,
      });
      written += 1;
    }
  })();

  // Coordinates flow in from the cache — never from this ingest (AUD F4).
  const rehydrated = db.prepare(`
    UPDATE establishment
       SET lat = (SELECT lat FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           lng = (SELECT lng FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           geocode_source  = (SELECT source  FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address),
           geocode_quality = (SELECT quality FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address)
     WHERE EXISTS (SELECT 1 FROM geocode_cache c WHERE c.normalized_address = establishment.normalized_address)
  `).run();

  db.prepare(
    `UPDATE ingest_run SET rows_fetched = ?, rows_after_filter = ?, rows_written = ? WHERE id = ?`
  ).run(rows.length, inCounty.length, written, runId);

  log(`  establishments: ${rows.length} fetched → ${inCounty.length} in scope → ${written} written`);
  log(`  coordinates rehydrated from cache: ${rehydrated.changes}`);
  return written;
}

// ── inspections ──────────────────────────────────────────────────────────────

function loadInspections(db, rows, runId, source) {
  const inCounty = rows.filter((r) => wanted(r['County Number']));

  // Same pair of floors, same reasoning as loadEstablishments.
  assertRowFloor(rows.length, source.rowFloor, { source: `${source.dataset} payload` });
  if (!NARROWED) {
    assertRowFloor(inCounty.length, source.rowFloor, {
      source: `${source.dataset} in-scope inspections`,
    });
  }

  const upsert = db.prepare(`
    INSERT INTO inspection (
      inspection_visit_id, inspection_number, license_key, source_license_id, inspection_date,
      inspection_class, inspection_type, disposition, signal, visit_number,
      critical_violations, noncritical_violations, total_violations,
      high_violations, intermediate_violations, basic_violations
    ) VALUES (
      @inspection_visit_id, @inspection_number, @license_key, @source_license_id, @inspection_date,
      @inspection_class, @inspection_type, @disposition, @signal, @visit_number,
      @critical_violations, @noncritical_violations, @total_violations,
      @high_violations, @intermediate_violations, @basic_violations
    )
    ON CONFLICT(inspection_visit_id) DO UPDATE SET
      inspection_number       = excluded.inspection_number,
      license_key             = excluded.license_key,
      inspection_date         = excluded.inspection_date,
      disposition             = excluded.disposition,
      signal                  = excluded.signal,
      critical_violations     = excluded.critical_violations,
      noncritical_violations  = excluded.noncritical_violations,
      total_violations        = excluded.total_violations,
      high_violations         = excluded.high_violations,
      intermediate_violations = excluded.intermediate_violations,
      basic_violations        = excluded.basic_violations
  `);

  // FR-105 — unpivot the 58 wide "Violation NN" columns into rows.
  const insertViolation = db.prepare(
    `INSERT INTO violation (inspection_visit_id, violation_code, count)
     VALUES (?, ?, ?)
     ON CONFLICT(inspection_visit_id, violation_code) DO UPDATE SET count = excluded.count`
  );

  let written = 0;
  let violationsWritten = 0;

  db.transaction(() => {
    for (const row of inCounty) {
      // Visit ID, not Inspection Number — see the schema comment on `inspection`.
      const visitId = (row['Inspection Visit ID'] || '').trim();
      if (!visitId) continue;

      // Throws on an unmapped disposition — FR-301.
      const signal = toSignal(row['Inspection Disposition']);

      upsert.run({
        inspection_visit_id: visitId,
        inspection_number: (row['Inspection Number'] || '').trim(),
        license_key: licenseKey(row['License Number'], row['License Type Code']),
        source_license_id: (row['License ID'] || '').trim(),
        inspection_date: toIsoDate(row['Inspection Date']),
        inspection_class: (row['Inspection Class'] || '').trim(),
        inspection_type: (row['Inspection Type'] || '').trim(),
        disposition: (row['Inspection Disposition'] || '').trim(),
        signal,
        visit_number: toInt(row['Visit Number']),
        critical_violations: toInt(row['Number of Critical Violations']),
        noncritical_violations: toInt(row['Number of Noncritical Violations']),
        total_violations: toInt(row['Number of Total Violations']),
        high_violations: toInt(row['Number of High Priority Violations']),
        intermediate_violations: toInt(row['Number of Intermediate Violations']),
        basic_violations: toInt(row['Number of Basic Violations']),
      });
      written += 1;

      for (const [key, value] of Object.entries(row)) {
        if (!key.startsWith('Violation ')) continue;
        const count = toInt(value);
        if (!count) continue; // 0 and blank are both "not cited"
        insertViolation.run(visitId, key.replace('Violation ', '').trim(), count);
        violationsWritten += 1;
      }
    }
  })();

  db.prepare(
    `UPDATE ingest_run SET rows_fetched = ?, rows_after_filter = ?, rows_written = ? WHERE id = ?`
  ).run(rows.length, inCounty.length, written, runId);

  log(`  inspections: ${rows.length} fetched → ${inCounty.length} in county → ${written} written`);
  log(`  violations unpivoted: ${violationsWritten}`);
  return written;
}

// ── orchestration ────────────────────────────────────────────────────────────

async function ingestSource(db, source, loader) {
  const startedAt = new Date().toISOString();
  const runId = db
    .prepare(
      `INSERT INTO ingest_run (source_url, dataset, started_at, status) VALUES (?, ?, ?, 'running')`
    )
    .run(source.url, source.dataset, startedAt).lastInsertRowid;

  try {
    const buffer = await fetchExtract(source);
    const rows = parseCsv(buffer);
    const written = loader(db, rows, runId, source);

    db.prepare(
      `UPDATE ingest_run SET finished_at = ?, status = 'success' WHERE id = ?`
    ).run(new Date().toISOString(), runId);

    return written;
  } catch (error) {
    // FR-109 — record the failure. FR-107 — leave production data untouched.
    db.prepare(
      `UPDATE ingest_run SET finished_at = ?, status = 'failed', failure_stage = ?, failure_reason = ? WHERE id = ?`
    ).run(new Date().toISOString(), error.stage || 'unknown', error.message, runId);
    throw error;
  }
}

async function main() {
  const db = open();
  const scope = NARROWED ? `counties ${COUNTY_CODES.join(', ')}` : `all counties (${COUNTY_MIN}-${COUNTY_MAX})`;
  log(`${scope} · districts ${DISTRICTS.join(', ')} · db ${require('./db').DB_PATH}`);

  try {
    // Every district, always. Licences first across all districts, then
    // inspections: an inspection whose establishment has not loaded yet would
    // still write, but the run reads better in that order and a licence failure
    // stops us before touching inspections at all.
    let written = 0;
    for (const district of DISTRICTS) {
      written += await ingestSource(db, sourcesFor(district).licenses, loadEstablishments);
    }
    for (const district of DISTRICTS) {
      await ingestSource(db, sourcesFor(district).inspections, loadInspections);
    }

    /*
     * The narrowed run's floor, and the only one it gets (see loadEstablishments).
     * A refresh scoped to a county that matched nothing anywhere is a typo'd
     * county code or a county column that moved — either way it is a failure,
     * not an empty success. Nothing was written in that case, so the abort still
     * leaves prior data and its as-of date untouched.
     */
    if (NARROWED) {
      assertRowFloor(written, 1, { source: `Counties ${COUNTY_CODES.join('/')} establishments` });
    }

    const stats = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM establishment) AS establishments,
                (SELECT COUNT(*) FROM inspection)    AS inspections,
                (SELECT COUNT(*) FROM violation)     AS violations,
                (SELECT COUNT(*) FROM establishment WHERE lat IS NOT NULL) AS geocoded`
      )
      .get();

    log('─'.repeat(58));
    for (const row of db.prepare(
      `SELECT county_code, county_name, COUNT(*) AS n,
              SUM(CASE WHEN license_type_code = '2010' THEN 1 ELSE 0 END) AS displayable
         FROM establishment GROUP BY county_code, county_name ORDER BY n DESC`
    ).all()) {
      log(`  ${String(row.county_code).padStart(2)} ${(row.county_name || '').padEnd(12)} ${String(row.n).padStart(6)} licensed, ${String(row.displayable).padStart(6)} displayable`);
    }
    log(`establishments ${stats.establishments} · inspections ${stats.inspections} · violations ${stats.violations}`);
    log(`geocoded ${stats.geocoded}/${stats.establishments} — run \`npm run geocode\` next`);
    log('ingest complete');
  } catch (error) {
    console.error(`\n[ingest] ABORTED at stage "${error.stage || 'unknown'}"`);
    console.error(`[ingest] ${error.message}`);
    console.error(`[ingest] Existing data was NOT modified. See the ingest_run table.`);
    process.exitCode = 1; // non-zero: a scheduled run must be able to detect this
  } finally {
    db.close();
  }
}

if (require.main === module) main();

module.exports = {
  normalizeAddress, toIsoDate, licenseKey,
  SOURCES, sourcesFor, COUNTY_CODE, COUNTY_CODES, DISTRICT, DISTRICTS,
  COUNTY_MIN, COUNTY_MAX, inScope, wanted, NARROWED,
};
