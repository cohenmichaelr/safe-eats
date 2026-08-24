'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SAFE_EATS_DB || path.join(__dirname, '..', 'safe-eats.db');

/**
 * Schema — MVP-SE-001 §4.
 *
 * Two invariants are enforced structurally rather than by convention:
 *
 * 1. `establishment.lat/lng` are written ONLY by geocode.js. The ingest upsert in
 *    ingest.js lists its columns explicitly and omits them. v1 used
 *    `INSERT OR REPLACE`, which deletes and reinserts the row, nulling every
 *    accumulated coordinate on each import (AUD F4) — that is why only 1.6% of
 *    64,110 rows ever had coordinates.
 *
 * 2. `geocode_cache` is keyed on normalized address and is never truncated by an
 *    ingest. Coordinates survive a full source reload, so geocoding accumulates
 *    instead of resetting.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS establishment (
  -- license_key + normalized_address. The two extracts disagree about identity:
  -- the licence file has no License ID and its License Number is not unique
  -- (SEA6021991 covers two businesses at one address, different suites), so the
  -- address is needed to keep both. See MVP-SE-001 §4 and DEC-006.
  establishment_id    TEXT PRIMARY KEY,
  -- '<digits>|<licenseTypeCode>' — the join key to inspection.
  -- The licence file writes "SEA6021991"; the inspection file writes "6021991".
  -- Joining on the raw strings matches ZERO rows. Do not "simplify" this away.
  license_key         TEXT NOT NULL,
  license_number      TEXT,
  name                TEXT NOT NULL,
  address             TEXT,
  normalized_address  TEXT,
  city                TEXT,
  zip                 TEXT,
  county_code         TEXT,
  county_name         TEXT,
  district            TEXT,
  license_type_code   TEXT,
  seats               INTEGER,
  risk_level          TEXT,
  -- geocode.js only. Never in an ingest upsert column list.
  lat                 REAL,
  lng                 REAL,
  geocode_source      TEXT,
  geocode_quality     TEXT,
  first_seen_at       TEXT,
  last_seen_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_est_bbox    ON establishment(lat, lng);
CREATE INDEX IF NOT EXISTS idx_est_norm    ON establishment(normalized_address);
CREATE INDEX IF NOT EXISTS idx_est_name    ON establishment(name);
CREATE INDEX IF NOT EXISTS idx_est_key     ON establishment(license_key);

CREATE TABLE IF NOT EXISTS inspection (
  -- "Inspection Visit ID", the only genuinely unique column in the extract.
  -- "Inspection Number" is a CASE id: one case carries several visits
  -- (e.g. visit 2 "Extension given, pending" then visit 3 "Complied").
  -- Keying on it collapsed 1,305 visits to 1,037 and lost the callback outcome,
  -- which is precisely what determines the current signal.
  inspection_visit_id TEXT PRIMARY KEY,
  inspection_number   TEXT,        -- case id; several visits share it
  license_key         TEXT,        -- joins establishment.license_key
  source_license_id   TEXT,        -- "License ID" as published in this extract
  inspection_date     TEXT,        -- ISO 8601; source is MM/DD/YYYY
  inspection_class    TEXT,
  inspection_type     TEXT,
  disposition         TEXT,        -- verbatim from source
  signal              TEXT,        -- derived; see src/signal.js
  visit_number        INTEGER,
  critical_violations     INTEGER,
  noncritical_violations  INTEGER,
  total_violations        INTEGER,
  high_violations         INTEGER,
  intermediate_violations INTEGER,
  basic_violations        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_insp_key    ON inspection(license_key, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_insp_date   ON inspection(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_insp_case   ON inspection(inspection_number);

CREATE TABLE IF NOT EXISTS violation (
  inspection_visit_id TEXT NOT NULL,
  violation_code      TEXT NOT NULL,
  count               INTEGER,
  PRIMARY KEY (inspection_visit_id, violation_code)
);

CREATE INDEX IF NOT EXISTS idx_viol_insp   ON violation(inspection_visit_id);

CREATE TABLE IF NOT EXISTS geocode_cache (
  normalized_address  TEXT PRIMARY KEY,
  lat                 REAL,
  lng                 REAL,
  quality             TEXT,
  source              TEXT,
  resolved_at         TEXT
);

CREATE TABLE IF NOT EXISTS ingest_run (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url          TEXT,
  dataset             TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  status              TEXT,        -- 'success' | 'failed'
  rows_fetched        INTEGER,
  rows_after_filter   INTEGER,
  rows_written        INTEGER,
  failure_stage       TEXT,
  failure_reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_time    ON ingest_run(started_at DESC);
`;

function open({ readonly = false } = {}) {
  const db = new Database(DB_PATH, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (!readonly) db.exec(SCHEMA);
  return db;
}

/**
 * The as-of date shown to users (FR-601). Derived from the newest successful
 * ingest, never from `now` — if the pipeline stops, the displayed date must stop
 * with it rather than implying freshness the data does not have.
 */
function dataAsOf(db) {
  const row = db
    .prepare(`SELECT finished_at FROM ingest_run WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`)
    .get();
  return row?.finished_at ?? null;
}

module.exports = { open, dataAsOf, DB_PATH, SCHEMA };
