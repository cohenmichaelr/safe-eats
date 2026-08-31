-- 003_spatial_index.sql — SE-101: spatial index on position.
--
-- The story asks for a GiST index on geometry. SQLite's equivalent is the R*Tree
-- module, which is compiled into the better-sqlite3 build (verified: SQLite
-- 3.49.2, rtree available). It indexes bounding boxes rather than points, so a
-- point is stored as a degenerate box with min = max on both axes.
--
-- This is what FR-401's `?bbox=` query will range-scan. The B-tree on (lat, lng)
-- from 001 stays: it is still the right index for a lat-first equality or
-- ordering probe, and it is what makes the JOIN below cheap. They are not
-- redundant — one answers "which rows are inside this rectangle", the other
-- answers "give me this row's position".
--
-- Query shape:
--   SELECT e.* FROM establishment e
--     JOIN establishment_rtree r ON r.id = e.rowid
--    WHERE r.min_lng >= :w AND r.max_lng <= :e
--      AND r.min_lat >= :s AND r.max_lat <= :n;

CREATE VIRTUAL TABLE IF NOT EXISTS establishment_rtree USING rtree(
  id,                 -- establishment.rowid
  min_lng, max_lng,
  min_lat, max_lat
);

-- Backfill. Ungeocoded rows are absent by design: an establishment with no
-- position is not a point in space, and giving it one — 0,0 or a county centroid —
-- is precisely the class of invention AUD F5 punished.
INSERT INTO establishment_rtree (id, min_lng, max_lng, min_lat, max_lat)
SELECT rowid, lng, lng, lat, lat
  FROM establishment
 WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Keep it in step with the base table. Without these the index silently drifts,
-- which is worse than not having it: a stale spatial index returns confident
-- wrong answers, and a map cannot tell the difference.

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

-- Delete-then-insert rather than UPDATE: the row may be moving into the index
-- (first geocode) or out of it (position cleared), and one statement pair covers
-- all four transitions.
CREATE TRIGGER IF NOT EXISTS establishment_rtree_au
AFTER UPDATE OF lat, lng ON establishment
BEGIN
  DELETE FROM establishment_rtree WHERE id = OLD.rowid;
  INSERT INTO establishment_rtree (id, min_lng, max_lng, min_lat, max_lat)
  SELECT NEW.rowid, NEW.lng, NEW.lng, NEW.lat, NEW.lat
   WHERE NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL;
END;
