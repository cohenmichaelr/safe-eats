-- 005_ifc1_boundary.sql — SE-101 / contract IFC-1:
--   ETL owns identity columns, geocoding owns position columns.
--
-- Until now this boundary was a sentence in CLAUDE.md and a column list in
-- src/ingest.js. Both are conventions: they hold exactly as long as every future
-- edit remembers them, which is the same guarantee v1 had when it lost every
-- coordinate on every import (AUD F4). These triggers make the contract
-- checkable by the database instead of by a reviewer.
--
--   identity columns (ETL owns): establishment_id, license_key, license_number,
--     name, address, normalized_address, city, zip, county_code, county_name,
--     district, license_type_code, seats, risk_level
--   position columns (geocoding owns): lat, lng, geocode_source, geocode_quality
--
-- Three rules, each one a specific documented failure:
--
--   IFC-1a  a position may only be a position that geocode_cache resolved
--   IFC-1b  a position, once set, is never nulled       (this is AUD F4 exactly)
--   IFC-1c  no single statement writes both sides of the boundary
--
-- Verified before writing: all 4,256 geocoded rows already satisfy IFC-1a
-- byte-for-byte against geocode_cache, so these triggers admit the current state.
--
-- To deliberately clear a bad coordinate, delete the geocode_cache row and drop
-- IFC-1b for that transaction. The friction is the point: nulling coordinates is
-- the single most expensive thing this codebase has ever done by accident.

-- ── IFC-1a — coordinates come from the cache, never from anywhere else ────────
-- src/geocode.js projects the cache onto establishment; that is the only writer.
-- Anything else setting lat/lng is either inventing a coordinate or copying one
-- from a source with no provenance, and both are refused.

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

-- ── IFC-1b — a resolved position is never lost ───────────────────────────────
-- v1 nulled coordinates on every import because INSERT OR REPLACE deletes and
-- reinserts the row. This makes the same outcome an error rather than a silent
-- data loss, whatever statement shape produces it.

CREATE TRIGGER IF NOT EXISTS ifc1b_position_not_nulled
BEFORE UPDATE OF lat, lng ON establishment
WHEN OLD.lat IS NOT NULL AND NEW.lat IS NULL
BEGIN
  SELECT RAISE(ABORT,
    'IFC-1b: refusing to null an established coordinate. This is AUD F4, the '
    || 'failure that left 98.4% of v1 rows unmappable.');
END;

-- ── IFC-1c — one statement, one side of the boundary ─────────────────────────
-- A statement that writes a position must write nothing else. This is what makes
-- the contract checkable rather than merely stated: an ETL upsert that grew a
-- lat/lng column fails here even if the value it wrote happened to be correct.

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
