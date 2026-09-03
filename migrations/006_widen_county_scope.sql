-- 006_widen_county_scope.sql — expand from Palm Beach to three counties.
--
-- Migration 002 rebuilt `establishment` with CHECK (county_code = '60') and said
-- exactly how it would be undone:
--
--   "Reversal (OPEN-3, expansion beyond Palm Beach) is a later migration that
--    rebuilds again with the CHECK widened to an IN list or dropped entirely."
--
-- This is that migration. The list is widened rather than dropped, because the
-- constraint is still doing work: it is the difference between "the counties we
-- have vetted" and "whatever a district file happened to contain". Florida has
-- 67 counties and 54,296 displayable establishments; we are taking three.
--
--   16  Broward      4,887 displayable   district 2
--   23  Dade         7,106 displayable   district 1
--   60  Palm Beach   3,659 displayable   district 2
--
-- Measured 2 Sep 2026. Note that Dade comes from a DIFFERENT district file than
-- the other two — CLAUDE.md's "District 2 = Broward, Martin, Palm Beach" is true
-- of district 2's contents but is not a statement that a county lives in only
-- one district. Verified per county: for licence type 2010 every one of these
-- three is wholly contained in a single district, and the handful of rows that
-- appear elsewhere are other licence types.
--
-- WHY THIS FILE IS LONG
--
-- SQLite cannot alter a CHECK constraint, so the table must be rebuilt, and
-- DROP TABLE takes its indexes AND its triggers with it. Since 002 was written
-- the table has acquired ten triggers across migrations 003, 004 and 005 — the
-- R*Tree maintenance, the FTS5 maintenance, and the entire IFC-1 boundary that
-- keeps ingest from writing coordinates. Every one is recreated below, verbatim
-- from the live schema.
--
-- Losing them silently would be the worst outcome available here: the map would
-- keep working, the spatial index would drift, and IFC-1 would stop guarding the
-- boundary that exists because v1 destroyed every coordinate on every import.

-- ── rebuild with the widened constraint ──────────────────────────────────────

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

  -- FR-104, widened. Adding a county means editing this list in a new migration,
  -- which is the point: expansion stays a deliberate, reviewable act rather than
  -- a config value someone can widen by accident.
  CONSTRAINT establishment_county_in_scope CHECK (county_code IN ('16', '23', '60'))
);

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

DROP TABLE establishment;  -- guard-sql: allow — rebuild rename, data copied above

ALTER TABLE establishment_rebuild RENAME TO establishment;

-- ── indexes, exactly as 001 and 002 declared them ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_est_bbox    ON establishment(lat, lng);
CREATE INDEX IF NOT EXISTS idx_est_norm    ON establishment(normalized_address);
CREATE INDEX IF NOT EXISTS idx_est_name    ON establishment(name);
CREATE INDEX IF NOT EXISTS idx_est_key     ON establishment(license_key);

-- A county filter is now a real query rather than a constant.
CREATE INDEX IF NOT EXISTS idx_est_county  ON establishment(county_code, license_type_code);

-- ── R*Tree maintenance, from 003 ────────────────────────────────────────────
--
-- Without these the spatial index drifts, and a stale spatial index returns
-- confident wrong answers that a map cannot tell from right ones.

CREATE TRIGGER IF NOT EXISTS establishment_rtree_ai
AFTER INSERT ON establishment
WHEN NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL
BEGIN
  INSERT INTO establishment_rtree (id, min_lng, max_lng, min_lat, max_lat)
  VALUES (NEW.rowid, NEW.lng, NEW.lng, NEW.lat, NEW.lat);
END;

CREATE TRIGGER IF NOT EXISTS establishment_rtree_ad
AFTER DELETE ON establishment
BEGIN
  DELETE FROM establishment_rtree WHERE id = OLD.rowid;
END;

CREATE TRIGGER IF NOT EXISTS establishment_rtree_au
AFTER UPDATE OF lat, lng ON establishment
BEGIN
  DELETE FROM establishment_rtree WHERE id = OLD.rowid;
  INSERT INTO establishment_rtree (id, min_lng, max_lng, min_lat, max_lat)
  SELECT NEW.rowid, NEW.lng, NEW.lng, NEW.lat, NEW.lat
   WHERE NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL;
END;

-- ── FTS5 maintenance, from 004 ──────────────────────────────────────────────
--
-- External-content FTS is not maintained automatically. Losing these shows up
-- only as quietly missing search results.

CREATE TRIGGER IF NOT EXISTS establishment_fts_ai
AFTER INSERT ON establishment
BEGIN
  INSERT INTO establishment_fts (rowid, name, address, city)
  VALUES (NEW.rowid, NEW.name, NEW.address, NEW.city);
END;

CREATE TRIGGER IF NOT EXISTS establishment_fts_ad
AFTER DELETE ON establishment
BEGIN
  INSERT INTO establishment_fts (establishment_fts, rowid, name, address, city)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.address, OLD.city);
END;

CREATE TRIGGER IF NOT EXISTS establishment_fts_au
AFTER UPDATE OF name, address, city ON establishment
BEGIN
  INSERT INTO establishment_fts (establishment_fts, rowid, name, address, city)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.address, OLD.city);
  INSERT INTO establishment_fts (rowid, name, address, city)
  VALUES (NEW.rowid, NEW.name, NEW.address, NEW.city);
END;

-- ── IFC-1 boundary, from 005 ────────────────────────────────────────────────
--
-- The reason v2 cannot repeat AUD F4. Copied verbatim from the live schema
-- rather than retyped: a boundary transcribed by hand is a boundary weakened
-- by hand.

CREATE TRIGGER IF NOT EXISTS ifc1a_position_insert_requires_cache
BEFORE INSERT ON establishment
WHEN NEW.lat IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM geocode_cache c
    WHERE c.normalized_address = NEW.normalized_address
      AND c.lat = NEW.lat AND c.lng = NEW.lng
 )
BEGIN
  SELECT RAISE(ABORT,
    'IFC-1a: lat/lng must come from geocode_cache for this normalized_address. '
    || 'Ingest does not write coordinates — see CLAUDE.md invariant 1 and AUD F4.');
END;

CREATE TRIGGER IF NOT EXISTS ifc1a_position_update_requires_cache
BEFORE UPDATE OF lat, lng ON establishment
WHEN NEW.lat IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM geocode_cache c
    WHERE c.normalized_address = NEW.normalized_address
      AND c.lat = NEW.lat AND c.lng = NEW.lng
 )
BEGIN
  SELECT RAISE(ABORT,
    'IFC-1a: lat/lng must come from geocode_cache for this normalized_address. '
    || 'Ingest does not write coordinates — see CLAUDE.md invariant 1 and AUD F4.');
END;

CREATE TRIGGER IF NOT EXISTS ifc1b_position_not_nulled
BEFORE UPDATE OF lat, lng ON establishment
WHEN OLD.lat IS NOT NULL AND NEW.lat IS NULL
BEGIN
  SELECT RAISE(ABORT,
    'IFC-1b: refusing to null an established coordinate. This is AUD F4, the '
    || 'failure that left 98.4% of v1 rows unmappable.');
END;

CREATE TRIGGER IF NOT EXISTS ifc1c_position_write_is_exclusive
BEFORE UPDATE OF lat, lng ON establishment
WHEN NEW.license_key        IS NOT OLD.license_key
  OR NEW.license_number     IS NOT OLD.license_number
  OR NEW.name               IS NOT OLD.name
  OR NEW.address            IS NOT OLD.address
  OR NEW.normalized_address IS NOT OLD.normalized_address
  OR NEW.city               IS NOT OLD.city
  OR NEW.zip                IS NOT OLD.zip
  OR NEW.county_code        IS NOT OLD.county_code
  OR NEW.county_name        IS NOT OLD.county_name
  OR NEW.district           IS NOT OLD.district
  OR NEW.license_type_code  IS NOT OLD.license_type_code
  OR NEW.seats              IS NOT OLD.seats
  OR NEW.risk_level         IS NOT OLD.risk_level
BEGIN
  SELECT RAISE(ABORT,
    'IFC-1c: a statement may not write both identity and position columns. '
    || 'ETL owns identity, geocoding owns position — split the write.');
END;
