-- 002_county_check_constraint.sql — SE-101: county-60 check constraint.
--
-- FR-104 says the loaded set is Palm Beach, county code 60. Until now that was
-- enforced only by a filter in src/ingest.js — a rule living in one procedure,
-- one edit away from being bypassed by any other writer. This moves it into the
-- table, where it holds regardless of which code path does the writing.
--
-- SQLite has no ALTER TABLE ADD CONSTRAINT, so a CHECK can only be added by
-- rebuilding the table (the documented 12-step procedure). That is why this file
-- contains a DROP: it is the rename half of a rebuild, not a deletion. The data
-- is copied first and the whole file runs inside one transaction, so a failure
-- at any point leaves the original table untouched.
--
-- Verified before writing this migration: county_code = '60' for all 4,305 rows,
-- so the constraint admits every row that exists today.
--
-- Reversal (OPEN-3, expansion beyond Palm Beach) is a later migration that
-- rebuilds again with the CHECK widened to an IN list or dropped entirely.
-- Deliberately not written as `IN ('60')` today — a single-county product should
-- say so in one obvious place.

CREATE TABLE establishment_rebuild (
  establishment_id    TEXT PRIMARY KEY,
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
  lat                 REAL,
  lng                 REAL,
  geocode_source      TEXT,
  geocode_quality     TEXT,
  first_seen_at       TEXT,
  last_seen_at        TEXT,

  -- FR-104. The whole point of this migration.
  CONSTRAINT establishment_is_palm_beach CHECK (county_code = '60')
);

-- Explicit column lists on both sides, per the same rule that forbids
-- INSERT OR REPLACE: a positional copy silently reorders if either side changes.
INSERT INTO establishment_rebuild (
  establishment_id, license_key, license_number, name, address, normalized_address,
  city, zip, county_code, county_name, district, license_type_code, seats, risk_level,
  lat, lng, geocode_source, geocode_quality, first_seen_at, last_seen_at
)
SELECT
  establishment_id, license_key, license_number, name, address, normalized_address,
  city, zip, county_code, county_name, district, license_type_code, seats, risk_level,
  lat, lng, geocode_source, geocode_quality, first_seen_at, last_seen_at
FROM establishment;

DROP TABLE establishment;  -- guard-sql: allow — rebuild rename, data already copied above

ALTER TABLE establishment_rebuild RENAME TO establishment;

-- DROP TABLE took the indexes with it; recreate them exactly as 001 declared them.
CREATE INDEX IF NOT EXISTS idx_est_bbox    ON establishment(lat, lng);
CREATE INDEX IF NOT EXISTS idx_est_norm    ON establishment(normalized_address);
CREATE INDEX IF NOT EXISTS idx_est_name    ON establishment(name);
CREATE INDEX IF NOT EXISTS idx_est_key     ON establishment(license_key);
