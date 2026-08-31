-- 004_name_search_index.sql — SE-101: trigram index on name.
--
-- The story asks for a pg_trgm index. SQLite's equivalent is FTS5 with the
-- `trigram` tokenizer (SQLite >= 3.34; verified available here on 3.49.2). Like
-- pg_trgm it indexes three-character sequences, so it answers substring and
-- misspelling-tolerant lookups rather than whole-word matches — which is what
-- restaurant search actually needs. "wendys" has to find "WENDY'S", and a diner
-- typing "starbuck" has to find "STARBUCKS #12345".
--
-- external content (`content='establishment'`): the index stores only the
-- tokens and reads columns back from the base table by rowid. No second copy of
-- the names, and no chance of the copy disagreeing with the original.
--
-- address and city are indexed alongside name because "pizza delray" is a
-- perfectly ordinary way to search, and splitting that across two indexes would
-- mean ranking two result sets against each other at request time.
--
-- Query shape:
--   SELECT e.* FROM establishment_fts f
--     JOIN establishment e ON e.rowid = f.rowid
--    WHERE establishment_fts MATCH :q ORDER BY rank;

CREATE VIRTUAL TABLE IF NOT EXISTS establishment_fts USING fts5(
  name,
  address,
  city,
  content='establishment',
  content_rowid='rowid',
  tokenize='trigram'
);

-- Build the index from what is already loaded.
INSERT INTO establishment_fts(establishment_fts) VALUES('rebuild');

-- External-content tables are not maintained automatically; these are the
-- triggers the FTS5 documentation prescribes. The 'delete' command replays the
-- old column values so FTS5 can retract exactly the tokens it added — passing
-- the new values, or omitting the delete on update, corrupts the index in a way
-- that only shows up as quietly missing search results.

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
