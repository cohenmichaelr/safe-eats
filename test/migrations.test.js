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

test('FR-104 — county-60 check constraint', async (t) => {
  await t.test('accepts county 60', (t) => {
    const db = freshDb(t);
    migrate(db);
    assert.doesNotThrow(() => insertEst(db));
  });

  await t.test('rejects any other county at the table, not just at the filter', (t) => {
    const db = freshDb(t);
    migrate(db);
    assert.throws(
      () => insertEst(db, { county_code: '16', establishment_id: 'x|2010|y' }),
      /CHECK constraint failed/i
    );
  });

  await t.test('the constraint is declared on the table itself', (t) => {
    const db = freshDb(t);
    migrate(db);
    const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='establishment'`).get().sql;
    assert.match(ddl, /CHECK\s*\(\s*county_code\s*=\s*'60'\s*\)/i);
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
