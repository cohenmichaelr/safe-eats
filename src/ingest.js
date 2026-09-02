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
 * Palm Beach County is District 2, county code 60 (District 2 = Broward, Martin,
 * Palm Beach). Verified against the live extracts on 21 Aug 2026.
 *
 * Do NOT revert to www.myfloridalicense.com/dbpr/hr/inspections/ — that host
 * serves a WordPress page which v1 saved as .csv for three years (AUD F1).
 */
const BASE = 'https://www2.myfloridalicense.com/sto/file_download/extracts';
const DISTRICT = process.env.SAFE_EATS_DISTRICT || '2';
const COUNTY_CODE = process.env.SAFE_EATS_COUNTY_CODE || '60';

const SOURCES = {
  licenses: {
    dataset: 'active-licenses',
    url: `${BASE}/hrfood${DISTRICT}.csv`,
    expectedColumns: ['License Number', 'Business Name', 'Location Street Address', 'Location County Code'],
    rowFloor: 3000,
  },
  inspections: {
    dataset: 'inspections',
    url: `${BASE}/${DISTRICT}fdinspi.csv`,
    expectedColumns: ['License Number', 'Inspection Disposition', 'Inspection Date', 'County Number'],
    rowFloor: 500,
  },
};

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

function parseCsv(buffer) {
  return parse(buffer, {
    columns: (header) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });
}

// ── establishments ───────────────────────────────────────────────────────────

function loadEstablishments(db, rows, runId) {
  const inCounty = rows.filter((r) => (r['Location County Code'] || '').trim() === COUNTY_CODE);

  // FR-104 — a zero-row filter result is a failure, not an empty success.
  assertRowFloor(inCounty.length, SOURCES.licenses.rowFloor, {
    source: `County ${COUNTY_CODE} establishments`,
  });

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
        county_code: COUNTY_CODE,
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

  log(`  establishments: ${rows.length} fetched → ${inCounty.length} in county ${COUNTY_CODE} → ${written} written`);
  log(`  coordinates rehydrated from cache: ${rehydrated.changes}`);
  return written;
}

// ── inspections ──────────────────────────────────────────────────────────────

function loadInspections(db, rows, runId) {
  const inCounty = rows.filter((r) => (r['County Number'] || '').trim() === COUNTY_CODE);

  assertRowFloor(inCounty.length, SOURCES.inspections.rowFloor, {
    source: `County ${COUNTY_CODE} inspections`,
  });

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
    const written = loader(db, rows, runId);

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
  log(`district ${DISTRICT} · county code ${COUNTY_CODE} · db ${require('./db').DB_PATH}`);

  try {
    await ingestSource(db, SOURCES.licenses, loadEstablishments);
    await ingestSource(db, SOURCES.inspections, loadInspections);

    const stats = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM establishment) AS establishments,
                (SELECT COUNT(*) FROM inspection)    AS inspections,
                (SELECT COUNT(*) FROM violation)     AS violations,
                (SELECT COUNT(*) FROM establishment WHERE lat IS NOT NULL) AS geocoded`
      )
      .get();

    log('─'.repeat(58));
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

module.exports = { normalizeAddress, toIsoDate, licenseKey, SOURCES, COUNTY_CODE, DISTRICT };
