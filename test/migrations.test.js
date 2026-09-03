'use strict';

/**
 * SE-101 — schema, constraints, spatial and search indexes, and the IFC-1
 * boundary.
 *
 * Every test here runs against a throwaway database built from `migrations/`,
 * never against safe-eats.db. That is deliberate beyond the usual hygiene: two
 * of these tests assert that a write is REFUSED, and a test that proves a guard
 * works by attempting the thing the guard exists to prevent must not be pointed
 * at the real data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrate, status, discover, MIGRATIONS_DIR } = require('../src/migrate');

/** A migrated, empty database in a temp directory, plus its cleanup. */
function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-mig-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

/** The minimum viable establishment row — identity only, no position. */
const EST = {
  establishment_id: '6000001|2010|100 MAIN ST, DELRAY BEACH, 33444',
  license_key: '6000001|2010',
  license_number: 'SEA6000001',
  name: 'TEST DINER',
  address: '100 MAIN ST',
  normalized_address: '100 MAIN ST, DELRAY BEACH, 33444',
  city: 'DELRAY BEACH',
  zip: '33444-1234',
  county_code: '60',
  county_name: 'PALM BEACH',
  district: '2',
  license_type_code: '2010',
  seats: 40,
  risk_level: 'Risk Level 2',
  first_seen_at: '2026-08-24T00:00:00.000Z',
  last_seen_at: '2026-08-24T00:00:00.000Z',
};

const COLUMNS = Object.keys(EST);
const insertEst = (db, overrides = {}) =>
  db
    .prepare(
      `INSERT INTO establishment (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c) => '@' + c).join(', ')})`
    )
    .run({ ...EST, ...overrides });

const cache = (db, addr, lat, lng) =>
  db
    .prepare(
      `INSERT INTO geocode_cache (normalized_address, lat, lng, quality, source, resolved_at)
       VALUES (?, ?, ?, 'Exact', 'census', '2026-08-24T00:00:00.000Z')`
    )
    .run(addr, lat, lng);

test('migration runner', async (t) => {
  await t.test('applies every migration to an empty database', (t) => {
    const db = freshDb(t);
    const done = migrate(db);

    assert.equal(done.length, discover().length);
    assert.ok(done.length >= 5, 'expected at least the five SE-101 migrations');
    assert.deepEqual(
      done.map((m) => m.version),
      [...done.map((m) => m.version)].sort((a, b) => a - b),
      'migrations must apply in version order'
    );
  });

  await t.test('is idempotent — a second run applies nothing', (t) => {
    const db = freshDb(t);
    migrate(db);
    assert.equal(migrate(db).length, 0);
  });

  await t.test('detects drift in an already-applied migration', (t) => {
    const db = freshDb(t);
    migrate(db);

    // Simulate the file changing after it was applied.
    db.prepare('UPDATE schema_migration SET checksum = ? WHERE version = 1').run('deadbeefdeadbeef');

    assert.throws(() => migrate(db), /drift/i);
  });

  await t.test('refuses to run when an applied migration is missing from disk', (t) => {
    const db = freshDb(t);
    migrate(db);

    db.prepare(
      `INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (999, 'ghost', 'x', '2026-01-01')`
    ).run();

    assert.throws(() => migrate(db), /no longer exists on disk/i);
  });

  await t.test('reports status without applying anything', (t) => {
    const db = freshDb(t);
    const before = status(db);
    assert.equal(before.inDb.length, 0);
    assert.ok(before.pending.length > 0);
    assert.equal(before.drifted.length, 0);

    migrate(db);
    const after = status(db);
    assert.equal(after.pending.length, 0);
    assert.equal(after.inDb.length, after.onDisk.length);
  });

  await t.test('every migration filename is numbered and snake_case', () => {
    for (const m of discover(MIGRATIONS_DIR)) {
      assert.match(m.file, /^\d{3}_[a-z0-9_]+\.sql$/);
    }
  });
});

test('FR-104 — county scope check constraint', async (t) => {
  // Migration 002 pinned this to county 60; migration 006 widened it to the
  // three counties the product now covers. The constraint still does work —
  // it is the difference between "counties we have vetted" and "whatever a
  // district file happened to contain", and Florida has 67 of them.

  await t.test('accepts every county in scope', (t) => {
    const db = freshDb(t);
    migrate(db);
    // The scope is the whole state since 007: the three originals, the far
    // corners of the range, and a county that used to be refused (Orange).
    for (const [i, county] of ['60', '16', '23', '11', '58', '77'].entries()) {
      assert.doesNotThrow(
        () => insertEst(db, { county_code: county, establishment_id: `600000${i}|2010|addr ${i}` }),
        `county ${county} should be storable`
      );
    }
  });

  await t.test('rejects what Florida does not have, at the table — DEC-017', (t) => {
    const db = freshDb(t);
    migrate(db);
    // The constraint did not go away when the scope widened, it changed what it
    // means. DBPR publishes ten out-of-state codes in the 700s (17 rows, zero
    // restaurants); with no county list left to vet, keeping those out is the
    // work it now does. 10 and 78 bracket the real range from either side.
    for (const county of ['701', '746', '10', '78', '0']) {
      assert.throws(
        () => insertEst(db, { county_code: county, establishment_id: `x|2010|${county}` }),
        /CHECK constraint failed/i,
        `county_code ${county} is not a Florida county and must not be storable`
      );
    }
  });

  await t.test('the constraint is declared on the table itself', (t) => {
    const db = freshDb(t);
    migrate(db);
    const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='establishment'`).get().sql;
    assert.match(ddl, /CHECK\s*\(\s*CAST\s*\(\s*county_code\s+AS\s+INTEGER\s*\)\s+BETWEEN\s+11\s+AND\s+77\s*\)/i);
  });

  await t.test('the rebuild kept every trigger and index', (t) => {
    // Migration 006 rebuilt the table, and a rebuild discards the triggers
    // attached to it. Losing the IFC-1 boundary here would be silent: the map
    // would keep working while ingest regained the ability to write coordinates.
    const db = freshDb(t);
    migrate(db);
    const triggers = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='establishment' ORDER BY name`
    ).all().map((r) => r.name);

    for (const name of [
      'establishment_fts_ad', 'establishment_fts_ai', 'establishment_fts_au',
      'establishment_rtree_ad', 'establishment_rtree_ai', 'establishment_rtree_au',
      'ifc1a_position_insert_requires_cache', 'ifc1a_position_update_requires_cache',
      'ifc1b_position_not_nulled', 'ifc1c_position_write_is_exclusive',
    ]) {
      assert.ok(triggers.includes(name), `${name} did not survive the rebuild`);
    }

    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='establishment' AND sql IS NOT NULL`
    ).all().map((r) => r.name);
    for (const name of ['idx_est_bbox', 'idx_est_norm', 'idx_est_name', 'idx_est_key']) {
      assert.ok(indexes.includes(name), `${name} did not survive the rebuild`);
    }
  });
});

test('IFC-1 — ETL owns identity, geocoding owns position', async (t) => {
  await t.test('IFC-1a — a position with no geocode_cache entry is refused', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);

    assert.throws(
      () => db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
              .run(26.46, -80.07, EST.establishment_id),
      /IFC-1a/
    );
  });

  await t.test('IFC-1a — a position that matches the cache is allowed', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);

    assert.doesNotThrow(() =>
      db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
        .run(26.46, -80.07, EST.establishment_id)
    );
    assert.equal(db.prepare('SELECT lat FROM establishment').get().lat, 26.46);
  });

  await t.test('IFC-1a — a coordinate near the cached one is still refused', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);

    // Not "close enough": the position must be the resolved position.
    assert.throws(
      () => db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
              .run(26.4600001, -80.07, EST.establishment_id),
      /IFC-1a/
    );
  });

  await t.test('IFC-1a — an INSERT cannot smuggle in a position either', (t) => {
    const db = freshDb(t);
    migrate(db);

    const cols = [...COLUMNS, 'lat', 'lng'];
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO establishment (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`
        ).run({ ...EST, lat: 26.46, lng: -80.07 }),
      /IFC-1a/
    );
  });

  await t.test('IFC-1b — an established coordinate cannot be nulled (AUD F4)', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);
    db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
      .run(26.46, -80.07, EST.establishment_id);

    assert.throws(
      () => db.prepare('UPDATE establishment SET lat = NULL, lng = NULL WHERE establishment_id = ?')
              .run(EST.establishment_id),
      /IFC-1b/
    );
    assert.equal(db.prepare('SELECT lat FROM establishment').get().lat, 26.46);
  });

  await t.test('IFC-1c — one statement may not write both identity and position', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);

    assert.throws(
      () => db.prepare('UPDATE establishment SET name = ?, lat = ?, lng = ? WHERE establishment_id = ?')
              .run('RENAMED DINER', 26.46, -80.07, EST.establishment_id),
      /IFC-1c/
    );
  });

  await t.test('the real ingest upsert shape is unaffected by all three', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);
    db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
      .run(26.46, -80.07, EST.establishment_id);

    // Identity-only upsert, exactly as src/ingest.js writes it: an explicit
    // column list that omits lat/lng. This must not trip IFC-1c, and — the point
    // of the whole exercise — must not lose the coordinate (AUD F4).
    assert.doesNotThrow(() =>
      db.prepare(
        `INSERT INTO establishment (${COLUMNS.join(', ')})
         VALUES (${COLUMNS.map((c) => '@' + c).join(', ')})
         ON CONFLICT(establishment_id) DO UPDATE SET
           name = excluded.name, seats = excluded.seats, last_seen_at = excluded.last_seen_at`
      ).run({ ...EST, name: 'TEST DINER & GRILL', seats: 44, last_seen_at: '2026-08-31T00:00:00.000Z' })
    );

    const row = db.prepare('SELECT name, seats, lat, lng FROM establishment').get();
    assert.equal(row.name, 'TEST DINER & GRILL');
    assert.equal(row.seats, 44);
    assert.equal(row.lat, 26.46, 'the coordinate must survive an ingest upsert');
  });
});

test('spatial index — the GiST equivalent', async (t) => {
  await t.test('a geocoded row enters the index and is found by bbox', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);
    db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
      .run(26.46, -80.07, EST.establishment_id);

    const hit = db.prepare(
      `SELECT e.name FROM establishment e JOIN establishment_rtree r ON r.id = e.rowid
        WHERE r.min_lng >= ? AND r.max_lng <= ? AND r.min_lat >= ? AND r.max_lat <= ?`
    ).all(-80.1, -80.0, 26.4, 26.5);
    assert.equal(hit.length, 1);
  });

  await t.test('an ungeocoded row is absent rather than placed at 0,0', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM establishment_rtree').get().n, 0);
  });

  await t.test('the index follows a delete', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db);
    cache(db, EST.normalized_address, 26.46, -80.07);
    db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
      .run(26.46, -80.07, EST.establishment_id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM establishment_rtree').get().n, 1);

    db.prepare('DELETE FROM establishment WHERE establishment_id = ?').run(EST.establishment_id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM establishment_rtree').get().n, 0);
  });

  await t.test('the query planner actually uses it', (t) => {
    const db = freshDb(t);
    migrate(db);
    const plan = db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT e.name FROM establishment e JOIN establishment_rtree r ON r.id = e.rowid
        WHERE r.min_lng >= ? AND r.max_lng <= ? AND r.min_lat >= ? AND r.max_lat <= ?`
    ).all(-80.1, -80.0, 26.4, 26.5);

    assert.ok(
      plan.some((s) => /VIRTUAL TABLE INDEX/.test(s.detail)),
      `expected an r-tree index scan, got: ${plan.map((s) => s.detail).join(' | ')}`
    );
  });
});

test('name search index — the pg_trgm equivalent', async (t) => {
  await t.test('matches a substring in the middle of a name', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db, { name: 'JOES ORIGINAL PIZZERIA' });

    const hits = db.prepare(
      `SELECT e.name FROM establishment_fts f JOIN establishment e ON e.rowid = f.rowid
        WHERE establishment_fts MATCH ?`
    ).all('pizzer');
    assert.equal(hits.length, 1);
  });

  await t.test('matches across a punctuation difference', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db, { name: "WENDY'S 1947" });

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM establishment_fts WHERE establishment_fts MATCH ?`).get('wendy').n,
      1
    );
  });

  await t.test('indexes address and city, so "pizza delray" is one query', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db, { name: 'JOES PIZZA' });

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM establishment_fts WHERE establishment_fts MATCH ?`).get('delray').n,
      1
    );
  });

  await t.test('follows a rename rather than serving the stale name', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db, { name: 'OLD NAME BISTRO' });

    db.prepare('UPDATE establishment SET name = ? WHERE establishment_id = ?')
      .run('NEW NAME BISTRO', EST.establishment_id);

    const q = (s) => db.prepare(`SELECT COUNT(*) n FROM establishment_fts WHERE establishment_fts MATCH ?`).get(s).n;
    assert.equal(q('old name'), 0, 'the old name must not still match');
    assert.equal(q('new name'), 1);
  });

  await t.test('follows a delete', (t) => {
    const db = freshDb(t);
    migrate(db);
    insertEst(db, { name: 'GONE SOON CAFE' });
    db.prepare('DELETE FROM establishment WHERE establishment_id = ?').run(EST.establishment_id);

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM establishment_fts WHERE establishment_fts MATCH ?`).get('gone soon').n,
      0
    );
  });
});
