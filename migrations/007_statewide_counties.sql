-- 007_statewide_counties.sql - from three counties to all 67.
--
-- 006 widened the CHECK from Palm Beach alone to an IN list of three, and said
-- what a further expansion would cost: another rebuild. This is it, and it is
-- the last one this constraint will need, because the scope it now expresses is
-- the whole state.
--
--   counties       67, codes 11 (Alachua) to 77 (Washington), contiguous
--   displayable    54,296 type-2010 establishments  (measured 3 Sep 2026)
--   all types      69,512
--
-- WHAT THE MEASUREMENT CHANGED
--
-- 006 recorded that each of its three counties had all of its type-2010 rows in
-- a single district file, and derived the fetch list from that. Across all 67
-- that is false: seven counties are split, and Okeechobee is the clearest -
-- 7 rows in district 4 and 84 in district 7. A county-to-district map would
-- silently drop the smaller half. So src/ingest.js now fetches all seven
-- district files and filters by county code, and the map is deleted rather
-- than extended. See DEC-017.
--
-- WHY THIS FILE IS LONG - unchanged from 006, and worth repeating
--
-- SQLite cannot alter a CHECK constraint, so the table must be rebuilt, and the
-- rebuild takes its indexes AND its triggers with it. All ten are recreated
-- below, copied from 006 rather than retyped: the R*Tree maintenance, the FTS5
-- maintenance, and the entire IFC-1 boundary that keeps ingest from writing
-- coordinates.
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

  -- FR-104, widened to the whole state. A range rather than 67 literals, because
  -- the codes are contiguous and the range is exactly the claim being made:
  -- "a Florida county". It still refuses the ten out-of-state codes DBPR
  -- publishes (701-746, 17 rows, zero restaurants), which is the junk this
  -- constraint exists to keep out now that there is no county list left to vet.
  CONSTRAINT establishment_county_in_scope
    CHECK (CAST(county_code AS INTEGER) BETWEEN 11 AND 77)
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
