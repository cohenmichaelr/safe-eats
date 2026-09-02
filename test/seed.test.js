'use strict';

/**
 * Geocode cache seeding — task 12, FR-204.
 *
 * The cache is the one artefact here that cost money and that nobody else holds
 * a copy of. These tests exist because losing it is not a visible failure: the
 * map still works, it just quietly re-buys 272 paid lookups and re-asks the
 * Census geocoder 3,900 questions it has already answered.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrate } = require('../src/migrate');
const { seedGeocodeCache, SEED_PATH } = require('../src/seed');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-seed-'));
  const db = new Database(path.join(dir, 'test.db'));
  migrate(db);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

const cached = (db) => db.prepare('SELECT COUNT(*) AS n FROM geocode_cache').get().n;

test('geocode cache seeding', async (t) => {
  await t.test('an empty cache is restored from the committed seed', (t) => {
    const db = freshDb(t);
    assert.equal(cached(db), 0);

    const { seeded } = seedGeocodeCache(db);
    assert.ok(seeded > 3000, `expected the committed seed to be substantial, got ${seeded}`);
    assert.equal(cached(db), seeded);
  });

  await t.test('coarse rejections survive, coordinates and all', (t) => {
    // A row cached with null coordinates records "we asked, and the answer was
    // not good enough for a 50m gate". That is what stops the paid geocoder
    // paying to ask the same question again, so it has to survive the trip —
    // dropping these would look like a smaller seed file and cost real money.
    const db = freshDb(t);
    seedGeocodeCache(db);

    const coarse = db.prepare('SELECT COUNT(*) AS n FROM geocode_cache WHERE lat IS NULL').get().n;
    assert.ok(coarse > 0, 'expected some cached-but-unresolved addresses');

    const row = db.prepare('SELECT * FROM geocode_cache WHERE lat IS NULL LIMIT 1').get();
    assert.equal(row.lng, null, 'a null latitude must not arrive with a longitude');
    assert.ok(row.quality, 'the reason it was rejected must survive');
  });

  await t.test('provenance survives — source and timestamp are not invented', (t) => {
    const db = freshDb(t);
    seedGeocodeCache(db);

    const sources = db.prepare('SELECT DISTINCT source FROM geocode_cache ORDER BY source').all().map((r) => r.source);
    assert.ok(sources.includes('census'), `expected census resolutions, got ${sources}`);

    const row = db.prepare("SELECT * FROM geocode_cache WHERE source = 'census' LIMIT 1").get();
    assert.match(row.resolved_at, /^\d{4}-\d{2}-\d{2}T/, 'resolved_at must be the original ISO timestamp');
  });

  await t.test('a populated cache is left alone', (t) => {
    // A running instance has a cache at least as good as the seed. Overwriting
    // it would discard every resolution made since the file was cut.
    const db = freshDb(t);
    db.prepare(
      `INSERT INTO geocode_cache (normalized_address, lat, lng, quality, source, resolved_at)
       VALUES ('100 MAIN ST, DELRAY BEACH, 33444', 26.4, -80.0, 'Exact', 'census', '2026-01-01T00:00:00.000Z')`
    ).run();

    const { seeded, reason } = seedGeocodeCache(db);
    assert.equal(seeded, 0);
    assert.match(reason, /already holds/);
    assert.equal(cached(db), 1, 'the live cache must not be replaced by the seed');
  });

  await t.test('seeding twice does not duplicate or clobber', (t) => {
    const db = freshDb(t);
    const first = seedGeocodeCache(db).seeded;
    const again = seedGeocodeCache(db).seeded;

    assert.equal(again, 0, 'the second run should decline, the cache being populated');
    assert.equal(cached(db), first);
  });

  await t.test('an existing row wins over the seed under --force', (t) => {
    // Live resolutions outrank committed ones: the file is a floor, not a truth.
    const db = freshDb(t);
    const seedRows = seedGeocodeCache(db).seeded;
    const victim = db.prepare('SELECT * FROM geocode_cache LIMIT 1').get();

    db.prepare('UPDATE geocode_cache SET lat = 1.5, source = ? WHERE normalized_address = ?')
      .run('manual', victim.normalized_address);

    seedGeocodeCache(db, { force: true });

    const after = db.prepare('SELECT * FROM geocode_cache WHERE normalized_address = ?').get(victim.normalized_address);
    assert.equal(after.lat, 1.5, 'a live row must not be overwritten by the seed');
    assert.equal(after.source, 'manual');
    assert.equal(cached(db), seedRows, 'forcing must not duplicate rows');
  });

  await t.test('the committed seed file exists and is not empty', () => {
    // The whole mechanism is inert without it, and inert silently.
    assert.ok(fs.existsSync(SEED_PATH), `${SEED_PATH} should be committed`);
    assert.ok(fs.statSync(SEED_PATH).size > 10_000, 'the seed looks truncated');
  });
});
