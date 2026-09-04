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

  await t.test('a populated cache is topped up, never overwritten — DEC-017', (t) => {
    // The row already on the disk was resolved by this deployment and outranks
    // the committed one; the rest of the seed still lands. Before statewide this
    // declined entirely, which would have left the deployed service to
    // re-geocode 64 counties it could have been handed.
    const db = freshDb(t);
    db.prepare(
      `INSERT INTO geocode_cache (normalized_address, lat, lng, quality, source, resolved_at)
       VALUES ('100 MAIN ST, DELRAY BEACH, 33444', 26.4, -80.0, 'Exact', 'hand', '2026-01-01T00:00:00.000Z')`
    ).run();

    const { seeded, reason } = seedGeocodeCache(db);
    assert.ok(seeded > 0, 'the addresses it has never seen must still arrive');
    assert.match(reason, /topped up/);

    const kept = db
      .prepare("SELECT lat, source FROM geocode_cache WHERE normalized_address = '100 MAIN ST, DELRAY BEACH, 33444'")
      .get();
    assert.equal(kept.source, 'hand', 'the live row must survive the top-up');
    assert.equal(kept.lat, 26.4);
  });

  await t.test('seeding twice does not duplicate or clobber', (t) => {
    const db = freshDb(t);
    const first = seedGeocodeCache(db).seeded;
    const again = seedGeocodeCache(db).seeded;

    assert.equal(again, 0, 'every address is already present, so nothing is inserted');
    assert.equal(cached(db), first);
  });

  await t.test('an existing row wins over the seed', (t) => {
    // Live resolutions outrank committed ones: the file is a floor, not a truth.
    const db = freshDb(t);
    const seedRows = seedGeocodeCache(db).seeded;
    const victim = db.prepare('SELECT * FROM geocode_cache LIMIT 1').get();

    db.prepare('UPDATE geocode_cache SET lat = 1.5, source = ? WHERE normalized_address = ?')
      .run('manual', victim.normalized_address);

    seedGeocodeCache(db);

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

test('a cached failure is not a resolution to protect', async (t) => {
  /*
   * The bug this exists to prevent, found on the deployed service: the disk had
   * these addresses cached with lat NULL from an earlier seed — "asked, no good
   * answer" — and the newer committed seed carried real coordinates for them,
   * bought from the paid tier. DO NOTHING kept the failures, and coverage sat at
   * 88.32% with the answers sitting in the repository.
   */
  const db = freshDb(t);

  seedGeocodeCache(db);
  const total = cached(db);

  // Rewrite the cache as one that only ever recorded failures.
  db.prepare("UPDATE geocode_cache SET lat = NULL, lng = NULL, quality = 'No_Match' WHERE lat IS NOT NULL").run();

  // ...except one row, a live resolution such as a hand correction.
  const keeper = db.prepare('SELECT normalized_address FROM geocode_cache LIMIT 1').get().normalized_address;
  db.prepare("UPDATE geocode_cache SET lat = 1.5, lng = 2.5, source = 'hand' WHERE normalized_address = ?").run(keeper);

  const { seeded } = seedGeocodeCache(db);

  assert.ok(seeded > 0, 'the seed must fill in what the cache recorded as unresolved');
  assert.equal(cached(db), total, 'and must not duplicate a single address');

  const restored = db.prepare('SELECT COUNT(*) AS n FROM geocode_cache WHERE lat IS NOT NULL').get().n;
  assert.ok(restored > 1, `expected many rows resolved from the seed, got ${restored}`);

  const kept = db.prepare('SELECT lat, source FROM geocode_cache WHERE normalized_address = ?').get(keeper);
  assert.equal(kept.source, 'hand', 'a live coordinate still outranks the committed one');
  assert.equal(kept.lat, 1.5);
});
