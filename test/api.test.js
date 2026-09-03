'use strict';

/**
 * Read API — FR-401, FR-402, FR-403, E5 (MVP-SE-001 §6 tasks 7 and 8).
 *
 * Built against a throwaway database from `migrations/`, never safe-eats.db.
 * The fixture is deliberately awkward in the ways the real extract is: a
 * mobile-vendor licence that must not appear on the map, an establishment with
 * no coordinate, a multi-visit case whose outcome is on the last visit, and an
 * inspection old enough to have expired. Each of those has already been a wrong
 * answer once in this project's history.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrate } = require('../src/migrate');
const { createApp, parseBbox, parseLimit, DEFAULT_LIMIT, MAX_LIMIT } = require('../src/server');

/* ------------------------------------------------------------- fixture ---- */

const EST = {
  establishment_id: null,
  license_key: null,
  license_number: 'SEA6000001',
  name: 'TEST DINER',
  address: '100 MAIN ST',
  normalized_address: '100 MAIN ST, DELRAY BEACH, 33444',
  city: 'DELRAY BEACH',
  zip: '33444-1234',
  county_code: '60',
  county_name: 'Palm Beach',
  district: '2',
  license_type_code: '2010',
  seats: 40,
  risk_level: 'Risk Level 2',
  first_seen_at: '2026-08-24T00:00:00.000Z',
  last_seen_at: '2026-08-24T00:00:00.000Z',
};

const EST_COLUMNS = Object.keys(EST);

function addEstablishment(db, overrides, position) {
  const row = { ...EST, ...overrides };
  db.prepare(
    `INSERT INTO establishment (${EST_COLUMNS.join(', ')})
     VALUES (${EST_COLUMNS.map((c) => '@' + c).join(', ')})`
  ).run(row);

  // Position arrives the only way IFC-1a permits: through geocode_cache, then
  // projected onto the row by a statement that touches position columns alone.
  if (position) {
    db.prepare(
      `INSERT OR IGNORE INTO geocode_cache
         (normalized_address, lat, lng, quality, source, resolved_at)
       VALUES (?, ?, ?, 'Exact', 'census', '2026-08-24T00:00:00.000Z')`
    ).run(row.normalized_address, position.lat, position.lng);

    db.prepare('UPDATE establishment SET lat = ?, lng = ? WHERE establishment_id = ?')
      .run(position.lat, position.lng, row.establishment_id);
  }
  return row;
}

function addInspection(db, row) {
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO inspection (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`
  ).run(row);
}

/**
 * Palm Beach in miniature. Coordinates are real county positions so the bbox
 * arithmetic is exercised at the magnitudes it will actually see.
 */
function seed(db) {
  // 1. On the map, passed its last inspection.
  addEstablishment(
    db,
    {
      establishment_id: '6000001|2010|100 MAIN ST, DELRAY BEACH, 33444',
      license_key: '6000001|2010',
      name: 'PASSING DINER',
    },
    { lat: 26.4615, lng: -80.0728 }
  );
  addInspection(db, {
    inspection_visit_id: 'V1',
    inspection_number: 'C1',
    license_key: '6000001|2010',
    inspection_date: '2026-08-01',
    inspection_class: 'Food',
    inspection_type: 'Routine - Food',
    disposition: 'Inspection Completed - No Further Action',
    signal: 'pass',
    visit_number: 1,
    total_violations: 2,
    high_violations: 0,
    intermediate_violations: 1,
    basic_violations: 1,
  });
  db.prepare('INSERT INTO violation (inspection_visit_id, violation_code, count) VALUES (?, ?, ?)')
    .run('V1', '08B-38-4', 1);
  db.prepare('INSERT INTO violation (inspection_visit_id, violation_code, count) VALUES (?, ?, ?)')
    .run('V1', '36-24-5', 1);

  // 2. A case with three visits. The outcome is on the LAST visit: the warning
  //    was cleared. Keying on the case id, or ordering by it, reports the
  //    warning forever — the failure DEC-007 was written to stop.
  addEstablishment(
    db,
    {
      establishment_id: '6000002|2010|200 ATLANTIC AVE, DELRAY BEACH, 33444',
      license_key: '6000002|2010',
      name: 'CALLBACK CAFE',
      address: '200 ATLANTIC AVE',
      normalized_address: '200 ATLANTIC AVE, DELRAY BEACH, 33444',
    },
    { lat: 26.4620, lng: -80.0700 }
  );
  addInspection(db, {
    inspection_visit_id: 'V2',
    inspection_number: 'C2',
    license_key: '6000002|2010',
    inspection_date: '2026-07-01',
    disposition: 'Warning Issued',
    signal: 'warning',
    visit_number: 1,
    total_violations: 6,
    high_violations: 3,
    intermediate_violations: 2,
    basic_violations: 1,
  });
  addInspection(db, {
    inspection_visit_id: 'V3',
    inspection_number: 'C2',
    license_key: '6000002|2010',
    inspection_date: '2026-07-20',
    disposition: 'Call Back - Extension given, pending',
    signal: 'warning',
    visit_number: 2,
    total_violations: 2,
    high_violations: 1,
    intermediate_violations: 1,
    basic_violations: 0,
  });
  addInspection(db, {
    inspection_visit_id: 'V4',
    inspection_number: 'C2',
    license_key: '6000002|2010',
    inspection_date: '2026-07-20',
    disposition: 'Call Back - Complied',
    signal: 'pass',
    visit_number: 3,
    total_violations: 0,
    high_violations: 0,
    intermediate_violations: 0,
    basic_violations: 0,
  });

  // 3. Enforcement action.
  addEstablishment(
    db,
    {
      establishment_id: '6000003|2010|300 CLEMATIS ST, WEST PALM BEACH, 33401',
      license_key: '6000003|2010',
      name: 'SERIOUS GRILL',
      city: 'WEST PALM BEACH',
      address: '300 CLEMATIS ST',
      normalized_address: '300 CLEMATIS ST, WEST PALM BEACH, 33401',
    },
    { lat: 26.7130, lng: -80.0530 }
  );
  addInspection(db, {
    inspection_visit_id: 'V5',
    inspection_number: 'C3',
    license_key: '6000003|2010',
    inspection_date: '2026-08-10',
    disposition: 'Emergency order recommended',
    signal: 'serious',
    visit_number: 1,
    total_violations: 12,
    high_violations: 7,
    intermediate_violations: 3,
    basic_violations: 2,
  });

  // 4. Last inspected in 2019 — beyond the 24-month horizon, so it must show as
  //    "no recent inspection" rather than as a five-year-old clean bill.
  addEstablishment(
    db,
    {
      establishment_id: '6000004|2010|400 OCEAN AVE, LANTANA, 33462',
      license_key: '6000004|2010',
      name: 'STALE SHACK',
      city: 'LANTANA',
      address: '400 OCEAN AVE',
      normalized_address: '400 OCEAN AVE, LANTANA, 33462',
    },
    { lat: 26.5860, lng: -80.0500 }
  );
  addInspection(db, {
    inspection_visit_id: 'V6',
    inspection_number: 'C4',
    license_key: '6000004|2010',
    inspection_date: '2019-03-04',
    disposition: 'Inspection Completed - No Further Action',
    signal: 'pass',
    visit_number: 1,
    total_violations: 0,
  });

  // 5. Never inspected.
  addEstablishment(
    db,
    {
      establishment_id: '6000005|2010|500 NORTHLAKE BLVD, LAKE PARK, 33403',
      license_key: '6000005|2010',
      name: 'UNINSPECTED KITCHEN',
      city: 'LAKE PARK',
      address: '500 NORTHLAKE BLVD',
      normalized_address: '500 NORTHLAKE BLVD, LAKE PARK, 33403',
    },
    { lat: 26.8080, lng: -80.0680 }
  );

  // 6. A mobile food dispensing vehicle inside the same box. Licensed at a
  //    commissary address, so its coordinate is not a claim about where you can
  //    eat — DEC-009 keeps it off the map.
  addEstablishment(
    db,
    {
      establishment_id: '6000006|2014|600 DEPOT RD, BOYNTON BEACH, 33426',
      license_key: '6000006|2014',
      license_type_code: '2014',
      name: 'TACO TRUCK',
      city: 'BOYNTON BEACH',
      address: '600 DEPOT RD',
      normalized_address: '600 DEPOT RD, BOYNTON BEACH, 33426',
      seats: null,
    },
    { lat: 26.5250, lng: -80.0660 }
  );

  // 7. No out-of-county row: ingest is district-wide but migration 002 put
  //    FR-104 in a CHECK constraint, so a Broward establishment cannot be stored
  //    at all. Asserted below rather than seeded here.

  // 8. In the population but not geocoded — the NFR-07 coverage gap. Absent from
  //    the map because it has no position, not because it was filtered out.
  addEstablishment(db, {
    establishment_id: '6000008|2010|800 HYPOLUXO RD, LAKE WORTH, 33463',
    license_key: '6000008|2010',
    name: 'UNGEOCODED PLACE',
    city: 'LAKE WORTH',
    address: '800 HYPOLUXO RD',
    normalized_address: '800 HYPOLUXO RD, LAKE WORTH, 33463',
  });

  db.prepare(
    `INSERT INTO ingest_run (source_url, dataset, started_at, finished_at, status,
                             rows_fetched, rows_after_filter, rows_written)
     VALUES ('https://example.invalid/hrfood2.csv', 'licenses',
             '2026-08-21T13:06:00.000Z', '2026-08-21T13:06:33.254Z', 'success', 9, 8, 8)`
  ).run();
}

/** A migrated, seeded database plus a listening app; both torn down after. */
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-api-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);

  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const get = async (url) => {
    const res = await fetch(base + url);
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  return { db, base, get };
}

/** A box around all of Palm Beach, comfortably excluding Broward. */
const COUNTY_BBOX = 'bbox=-80.35,26.30,-79.99,26.95';

/* ----------------------------------------------------------- GET /api/meta -- */

test('GET /api/meta — FR-601, FR-404', async (t) => {
  const { get } = await fixture(t);

  await t.test('serves the as-of date from the last successful ingest', async () => {
    const { status, body } = await get('/api/meta');
    assert.equal(status, 200);
    assert.equal(body.as_of, '2026-08-21T13:06:33.254Z');
  });

  await t.test('serves the signal palette so the client keeps no copy of it', async () => {
    const { body } = await get('/api/meta');
    const { SIGNAL_DISPLAY } = require('../src/signal');
    // Identity with src/signal.js is the assertion. A client-side duplicate of
    // this palette is a colour that drifts the first time the mapping changes.
    assert.deepEqual(body.signals, SIGNAL_DISPLAY);
    // FR-404: every state carries a shape as well as a colour.
    for (const [name, display] of Object.entries(body.signals)) {
      assert.ok(display.shape, `${name} has no shape`);
      assert.ok(display.color, `${name} has no colour`);
    }
  });

  await t.test('serves the window start, which is what a grey pin means', async () => {
    // After DEC-010 roughly 70% of pins say "no recent inspection". The page
    // cannot explain that honestly without naming the window it refers to.
    const { body } = await get('/api/meta');
    assert.equal(body.inspection_window_start, '2019-03-04');
  });

  await t.test('publishes the disposition mapping, not just applies it', async () => {
    // FR-601: the methodology page renders this table rather than restating the
    // mapping in prose, so a second hand-maintained copy cannot drift from
    // src/signal.js. Identity with DISPOSITION_MAP is the assertion.
    const { body } = await get('/api/meta');
    const { DISPOSITION_MAP } = require('../src/signal');
    assert.equal(body.dispositions.length, DISPOSITION_MAP.size);
    for (const { disposition, signal } of body.dispositions) {
      assert.equal(signal, DISPOSITION_MAP.get(disposition), `${disposition} disagrees with signal.js`);
    }
    // Nothing may map to a signal the legend cannot draw.
    for (const { signal } of body.dispositions) assert.ok(body.signals[signal], `${signal} has no display`);
  });

  await t.test('reports coverage over the displayed population only', async () => {
    const { body } = await get('/api/meta');
    // The fixture holds 6 displayable (type 2010, county 60) establishments: 5
    // positioned, 1 not; the taco truck is excluded. 4 have inspections.
    assert.deepEqual(body.coverage, { displayed: 6, positioned: 5, inspected: 4 });
  });

  await t.test('names both attributions', async () => {
    const { body } = await get('/api/meta');
    assert.match(body.attribution.data, /Business & Professional Regulation/);
    assert.match(body.attribution.basemap, /OpenStreetMap/);
  });
});

/* --------------------------------------------------------- GET /api/search -- */

test('GET /api/search — FR-407', async (t) => {
  const { get } = await fixture(t);

  await t.test('finds an establishment by name', async () => {
    const { status, body } = await get('/api/search?q=callback');
    assert.equal(status, 200);
    assert.deepEqual(body.establishments.map((e) => e.name), ['CALLBACK CAFE']);
  });

  await t.test('ignores punctuation the searcher did not type', async () => {
    // The whole point of normalising: a name stored with an apostrophe has to
    // be reachable from a query without one. Against the real data the trigram
    // index returned 2 of 25 Wendy's for exactly this reason.
    const { db, get: g } = await fixture(t);
    addEstablishment(db, {
      establishment_id: "6000009|2010|900 APOSTROPHE WAY, JUPITER, 33477",
      license_key: '6000009|2010',
      name: "WENDY'S",
      address: '900 APOSTROPHE WAY',
      city: 'JUPITER',
      normalized_address: '900 APOSTROPHE WAY, JUPITER, 33477',
    });

    for (const q of ['wendys', "wendy's", 'WENDYS']) {
      const { body } = await g(`/api/search?q=${encodeURIComponent(q)}`);
      assert.equal(body.total, 1, `"${q}" should find WENDY'S`);
    }
  });

  await t.test('matches address and city as well as name', async () => {
    const { body } = await get('/api/search?q=clematis');
    assert.deepEqual(body.establishments.map((e) => e.name), ['SERIOUS GRILL']);
  });

  await t.test('ranks a name match above an address match', async () => {
    const { db, get: g } = await fixture(t);
    addEstablishment(db, {
      establishment_id: '6000010|2010|10 OCEAN AVE, LANTANA, 33462',
      license_key: '6000010|2010',
      name: 'OCEAN GRILL',
      address: '10 OCEAN AVE',
      city: 'LANTANA',
      normalized_address: '10 OCEAN AVE, LANTANA, 33462',
    });
    // STALE SHACK lives on 400 OCEAN AVE, so both match "ocean" — but only one
    // is called it. Someone searching a name should not be led by a street.
    const { body } = await g('/api/search?q=ocean');
    assert.equal(body.establishments[0].name, 'OCEAN GRILL');
  });

  await t.test('filters by city', async () => {
    const { body } = await get('/api/search?city=WEST%20PALM%20BEACH');
    assert.deepEqual(body.establishments.map((e) => e.name), ['SERIOUS GRILL']);
  });

  await t.test('filters by inspection result', async () => {
    const { body } = await get('/api/search?signal=serious');
    assert.deepEqual(body.establishments.map((e) => e.name), ['SERIOUS GRILL']);
  });

  await t.test('combines text, city and result', async () => {
    const { body } = await get('/api/search?q=grill&city=WEST%20PALM%20BEACH&signal=serious');
    assert.equal(body.total, 1);
    assert.equal(body.establishments[0].name, 'SERIOUS GRILL');

    const { body: none } = await get('/api/search?q=grill&city=WEST%20PALM%20BEACH&signal=pass');
    assert.equal(none.total, 0, 'contradictory filters return nothing, not everything');
  });

  await t.test('respects the displayed population — DEC-009', async () => {
    // The taco truck matches the text but is not a displayable establishment.
    const { body } = await get('/api/search?q=taco');
    assert.equal(body.total, 0);
  });

  await t.test('search is not limited to the geocoded ones', async () => {
    // An establishment with no coordinate cannot be a pin, but it is still a
    // real licensed restaurant and a search for it should find it.
    const { body } = await get('/api/search?q=ungeocoded');
    assert.equal(body.total, 1);
    assert.equal(body.establishments[0].lat, null);
  });

  await t.test('no filters lists the displayed population', async () => {
    const { body } = await get('/api/search');
    assert.equal(body.total, 6);
  });

  await t.test('a query matching nothing is an empty list, not an error', async () => {
    const { status, body } = await get('/api/search?q=zzzznothinghere');
    assert.equal(status, 200);
    assert.equal(body.total, 0);
    assert.deepEqual(body.establishments, []);
  });

  await t.test('LIKE wildcards in the query do not match everything', async () => {
    // "%" is a wildcard in LIKE. Passed through unchanged it would silently
    // return the entire database for a nonsense query.
    const { body } = await get('/api/search?q=%25');
    assert.equal(body.total, 0, 'a bare wildcard should match nothing, not everything');
  });

  await t.test('rejects an unknown signal rather than ignoring it', async () => {
    const { status, body } = await get('/api/search?signal=excellent');
    assert.equal(status, 400);
    assert.match(body.error, /Unknown signal/);
  });

  await t.test('reports the total separately from what it returned', async () => {
    const { body } = await get('/api/search?limit=2');
    assert.equal(body.total, 6);
    assert.equal(body.count, 2);
    assert.equal(body.truncated, true);
    assert.equal(body.establishments.length, 2);
  });
});

/* --------------------------------------------------------- bbox parsing ---- */

test('bbox parsing', async (t) => {
  await t.test('accepts west,south,east,north', () => {
    assert.deepEqual(parseBbox('-80.35,26.30,-79.99,26.95'), {
      west: -80.35, south: 26.3, east: -79.99, north: 26.95,
    });
  });

  await t.test('tolerates surrounding whitespace', () => {
    assert.deepEqual(parseBbox(' -80.35 , 26.30 , -79.99 , 26.95 ').west, -80.35);
  });

  await t.test('rejects the malformed cases', () => {
    for (const bad of [undefined, '', '1,2,3', '1,2,3,4,5', 'a,b,c,d', '1,2,,4', 'NaN,2,3,4']) {
      assert.throws(() => parseBbox(bad), /bbox/, `expected rejection of ${JSON.stringify(bad)}`);
    }
  });

  await t.test('rejects an empty component rather than reading it as zero', () => {
    // Number('') is 0, not NaN, so a finiteness check alone lets a missing
    // coordinate through as a box straddling the prime meridian. Each case here
    // is otherwise well-ordered, so only the empty-component check can reject it.
    for (const bad of ['-80.3,26.3,,26.9', ',26.3,-79.9,26.9', '-80.3, ,-79.9,26.9', '-80.3,26.3,-79.9,']) {
      assert.throws(() => parseBbox(bad), /empty/, `expected rejection of ${JSON.stringify(bad)}`);
    }
  });

  await t.test('rejects out-of-range and inverted boxes', () => {
    assert.throws(() => parseBbox('-80,-91,-79,26'), /latitude/);
    assert.throws(() => parseBbox('-181,26,-79,27'), /longitude/);
    assert.throws(() => parseBbox('-79,26,-80,27'), /west must not exceed east/);
    assert.throws(() => parseBbox('-80,27,-79,26'), /south must not exceed north/);
  });

  await t.test('limit defaults, caps, and rejects nonsense', () => {
    assert.equal(parseLimit(undefined), DEFAULT_LIMIT);
    assert.equal(parseLimit('10'), 10);
    assert.equal(parseLimit(String(MAX_LIMIT * 10)), MAX_LIMIT);
    for (const bad of ['0', '-1', '1.5', 'ten', '']) assert.throws(() => parseLimit(bad), /limit/);
  });

  await t.test('the default limit clears the whole displayable county', () => {
    // Measured 1 Sep 2026: 3,618 geocoded type-2010 establishments in county 60.
    // A default below that means an unqualified county-wide request returns a
    // truncated map — 1,500 did exactly that, dropping 58% of the restaurants
    // behind a flag most clients would never read. The margin is the guard.
    const DISPLAYABLE_POPULATION = 3618;
    assert.ok(
      DEFAULT_LIMIT > DISPLAYABLE_POPULATION,
      `DEFAULT_LIMIT ${DEFAULT_LIMIT} must exceed the ${DISPLAYABLE_POPULATION} displayable establishments`
    );
    assert.ok(MAX_LIMIT >= DEFAULT_LIMIT);
  });
});

/* ------------------------------------------------- GET /api/establishments -- */

test('GET /api/establishments — FR-401', async (t) => {
  const { db, get } = await fixture(t);

  await t.test('returns the geocoded, displayable establishments in the box', async () => {
    const { status, body } = await get(`/api/establishments?${COUNTY_BBOX}`);
    assert.equal(status, 200);
    assert.deepEqual(
      body.establishments.map((e) => e.name).sort(),
      ['CALLBACK CAFE', 'PASSING DINER', 'SERIOUS GRILL', 'STALE SHACK', 'UNINSPECTED KITCHEN']
    );
    assert.equal(body.count, 5);
    assert.equal(body.truncated, false);
  });

  await t.test('excludes non-2010 licence types — DEC-009', async () => {
    const { body } = await get(`/api/establishments?${COUNTY_BBOX}`);
    assert.ok(!body.establishments.some((e) => e.name === 'TACO TRUCK'));
  });

  await t.test('cannot store a county Florida does not have — FR-104, DEC-017', async () => {
    // The scope is now the whole state, so Orange County stores like any other.
    // The CHECK did not go away, it changed what it means: migration 007 rebuilt
    // the table with CAST(county_code AS INTEGER) BETWEEN 11 AND 77, the 67
    // contiguous Florida codes. What it still refuses is the ten out-of-state
    // codes DBPR publishes in the 700s — 17 rows, no restaurants — which is the
    // junk the constraint exists to keep out now that no county list is vetted.
    addEstablishment(db, {
      establishment_id: '5800007|2010|700 ORANGE AVE, ORLANDO, 32801',
      license_key: '5800007|2010',
      name: 'ORLANDO BISTRO',
      address: '700 ORANGE AVE',
      city: 'ORLANDO',
      county_code: '58',
      county_name: 'Orange',
      normalized_address: '700 ORANGE AVE, ORLANDO, 32801',
    });

    assert.throws(
      () => addEstablishment(db, {
        establishment_id: '7010001|2010|1 ELSEWHERE ST, ATLANTA, 30301',
        license_key: '7010001|2010',
        name: 'OUT OF STATE KITCHEN',
        address: '1 ELSEWHERE ST',
        city: 'ATLANTA',
        county_code: '701',
        county_name: 'Out of State',
        normalized_address: '1 ELSEWHERE ST, ATLANTA, 30301',
      }),
      /CHECK constraint failed/
    );

    // Orange stored, but it still draws no pin: the row has no coordinate, and
    // the map excludes those rather than inventing one.
    const { body } = await get('/api/establishments?bbox=-82,27,-80,29');
    assert.ok(!body.establishments.some((e) => e.city === 'ORLANDO'));
  });

  await t.test('excludes rows with no coordinate rather than inventing one', async () => {
    const { body } = await get('/api/establishments?bbox=-81,25.9,-79,27.5');
    assert.ok(!body.establishments.some((e) => e.name === 'UNGEOCODED PLACE'));
    assert.ok(body.establishments.every((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng)));
  });

  await t.test('honours the box: a tight box returns only what is inside it', async () => {
    const { body } = await get('/api/establishments?bbox=-80.08,26.45,-80.06,26.47');
    assert.deepEqual(body.establishments.map((e) => e.name).sort(), ['CALLBACK CAFE', 'PASSING DINER']);
  });

  await t.test('includes a pin lying exactly on the box edge', async () => {
    // PASSING DINER sits at 26.4615, -80.0728. A containment predicate against
    // the R*Tree's float32 rounding (min rounded down, max rounded up) can push
    // an edge point just outside its own box and drop it. The overlap form does
    // not. A restaurant that vanishes when you pan is the worst kind of bug here
    // because nothing on screen says anything is missing.
    const { body } = await get('/api/establishments?bbox=-80.0728,26.4615,-80.0728,26.4615');
    assert.deepEqual(body.establishments.map((e) => e.name), ['PASSING DINER']);
  });

  await t.test('an empty box is an empty list, not an error', async () => {
    const { status, body } = await get('/api/establishments?bbox=-80.9,26.99,-80.8,26.999');
    assert.equal(status, 200);
    assert.deepEqual(body.establishments, []);
    assert.equal(body.count, 0);
  });

  await t.test('reports the as-of date from the last successful ingest — FR-601', async () => {
    const { body } = await get(`/api/establishments?${COUNTY_BBOX}`);
    assert.equal(body.as_of, '2026-08-21T13:06:33.254Z');
  });

  await t.test('flags truncation rather than silently dropping pins', async () => {
    const { body } = await get(`/api/establishments?${COUNTY_BBOX}&limit=2`);
    assert.equal(body.count, 2);
    assert.equal(body.establishments.length, 2);
    assert.equal(body.truncated, true);
  });

  await t.test('rejects a malformed bbox with 400 and JSON', async () => {
    const { status, body } = await get('/api/establishments?bbox=nope');
    assert.equal(status, 400);
    assert.match(body.error, /bbox/);
  });
});

/* --------------------------------------------------------------- signal ---- */

test('displayed signal — FR-301', async (t) => {
  const { get } = await fixture(t);
  const { body } = await get(`/api/establishments?${COUNTY_BBOX}`);
  const byName = Object.fromEntries(body.establishments.map((e) => [e.name, e]));

  await t.test('comes from the most recent VISIT, not the case — DEC-007', () => {
    // Case C2 opened with a warning and closed complied on visit 3. The
    // establishment passes; reporting the warning would be reporting a
    // resolved problem as a current one.
    assert.equal(byName['CALLBACK CAFE'].signal, 'pass');
    assert.equal(byName['CALLBACK CAFE'].last_inspection_date, '2026-07-20');
  });

  await t.test('carries pass, warning and serious through unchanged', () => {
    assert.equal(byName['PASSING DINER'].signal, 'pass');
    assert.equal(byName['SERIOUS GRILL'].signal, 'serious');
  });

  await t.test('ages out beyond 24 months', () => {
    assert.equal(byName['STALE SHACK'].signal, 'unknown');
  });

  await t.test('is unknown, never pass, when there is no inspection at all', () => {
    assert.equal(byName['UNINSPECTED KITCHEN'].signal, 'unknown');
    assert.equal(byName['UNINSPECTED KITCHEN'].last_inspection_date, null);
  });
});

/* -------------------------------------- GET /api/establishments/:id — E5 ---- */

test('GET /api/establishments/:establishmentId — E5', async (t) => {
  const { get } = await fixture(t);
  const CAFE = encodeURIComponent('6000002|2010|200 ATLANTIC AVE, DELRAY BEACH, 33444');

  await t.test('returns the establishment with its current signal', async () => {
    const { status, body } = await get(`/api/establishments/${CAFE}`);
    assert.equal(status, 200);
    assert.equal(body.establishment.name, 'CALLBACK CAFE');
    assert.equal(body.establishment.signal, 'pass');
    assert.equal(body.establishment.signal_display.label, 'Met standards');
    // Colour is never the only channel — FR-404.
    assert.ok(body.establishment.signal_display.shape);
    assert.equal(body.as_of, '2026-08-21T13:06:33.254Z');
  });

  await t.test('lists every visit newest first, with the case id preserved', async () => {
    const { body } = await get(`/api/establishments/${CAFE}`);
    assert.deepEqual(body.inspections.map((i) => i.visit_id), ['V4', 'V3', 'V2']);
    assert.deepEqual(body.inspections.map((i) => i.visit_number), [3, 2, 1]);
    assert.ok(body.inspections.every((i) => i.case_id === 'C2'));
    assert.equal(body.inspections[0].disposition, 'Call Back - Complied');
  });

  await t.test('breaks violations down over the four columns the source populates', async () => {
    const DINER = encodeURIComponent('6000001|2010|100 MAIN ST, DELRAY BEACH, 33444');
    const { body } = await get(`/api/establishments/${DINER}`);
    const v = body.inspections[0].violations;
    assert.deepEqual(
      { total: v.total, high: v.high, intermediate: v.intermediate, basic: v.basic },
      { total: 2, high: 0, intermediate: 1, basic: 1 }
    );
    assert.deepEqual(v.codes, [{ violation_code: '08B-38-4', count: 1 }, { violation_code: '36-24-5', count: 1 }]);
    // D-012: these are blank in 100% of source rows, so the panel is not built
    // on them and the payload must not pretend they carry a zero.
    assert.ok(!('critical' in v) && !('noncritical' in v));
  });

  await t.test('an establishment with no inspections returns an empty history, not a 404', async () => {
    const id = encodeURIComponent('6000005|2010|500 NORTHLAKE BLVD, LAKE PARK, 33403');
    const { status, body } = await get(`/api/establishments/${id}`);
    assert.equal(status, 200);
    assert.deepEqual(body.inspections, []);
    assert.equal(body.establishment.signal, 'unknown');
  });

  await t.test('404s for an unknown id', async () => {
    const { status, body } = await get('/api/establishments/no-such-place');
    assert.equal(status, 404);
    assert.match(body.error, /No such establishment/);
  });

  await t.test('404s for an establishment outside the displayed population', async () => {
    // The taco truck is in the database and has a coordinate. It has not been
    // through the accuracy gate, so it gets no detail page — DEC-009.
    const id = '6000006|2014|600 DEPOT RD, BOYNTON BEACH, 33426';
    const { status } = await get(`/api/establishments/${encodeURIComponent(id)}`);
    assert.equal(status, 404);
  });
});

/* ------------------------------------------------------------- FR-403 ----- */

test('the request path makes no external call — FR-403, invariant 5', async (t) => {
  const { get } = await fixture(t);

  // v1 called Google Places per result on every viewport (AUD F6). If a future
  // edit reintroduces enrichment on the read path, these requests stop working
  // instead of quietly getting slower and billable.
  const realFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = realFetch; });

  const { status } = await get(`/api/establishments?${COUNTY_BBOX}`);
  assert.equal(status, 200);

  globalThis.fetch = (...args) => {
    calls.push(args[0]);
    return realFetch(...args);
  };
  await get(`/api/establishments?${COUNTY_BBOX}`);
  await get(`/api/establishments/${encodeURIComponent('6000001|2010|100 MAIN ST, DELRAY BEACH, 33444')}`);

  // The only fetches are the test client's own two requests to our own server.
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => String(url).startsWith('http://127.0.0.1:')), String(calls));
});

/* ------------------------------------------------- statewide search (DEC-017) */

test('search at statewide scale', async (t) => {
  await t.test('the county filter is a WHERE clause, not a post-filter', async (t) => {
    const { db, get } = await fixture(t);
    addEstablishment(db, {
      establishment_id: 'orange|2010|1 ORANGE AVE',
      license_key: 'orange|2010',
      name: 'ORLANDO DINER',
      address: '1 ORANGE AVE',
      normalized_address: '1 ORANGE AVE, ORLANDO, 32801',
      city: 'ORLANDO',
      county_code: '58',
      county_name: 'Orange',
    }, { lat: 28.54, lng: -81.38 });

    const all = await get('/api/search?q=diner');
    const orange = await get('/api/search?q=diner&county=58');
    const palm = await get('/api/search?q=diner&county=60');

    assert.ok(all.body.total >= 2);
    assert.equal(orange.body.total, 1);
    assert.equal(orange.body.establishments[0].county, 'Orange');
    assert.ok(!palm.body.establishments.some((e) => e.county_code === '58'));
  });

  await t.test('the city filter keeps every spelling that canonicalises to it', async (t) => {
    // The reason this could not simply become `city = ?`: the 12 Royal Palm
    // Beach establishments filed under ROYAL PLM BEACH must still be found, or
    // the filter silently hides them — which is what src/cities.js exists for.
    const { db, get } = await fixture(t);
    addEstablishment(db, {
      establishment_id: 'rpb|2010|1 ROYAL PLM',
      license_key: 'rpb|2010',
      name: 'ROYAL CAFE',
      address: '1 ROYAL PLM WAY',
      normalized_address: '1 ROYAL PLM WAY, ROYAL PLM BEACH, 33411',
      city: 'ROYAL PLM BEACH',
      zip: '33411',
    }, { lat: 26.7, lng: -80.23 });

    const { body } = await get('/api/search?city=Royal%20Palm%20Beach');
    assert.equal(body.total, 1, 'the misspelling is reached by the canonical name');
    assert.equal(body.establishments[0].city, 'ROYAL PLM BEACH', 'and the raw value is preserved');
    assert.equal(body.establishments[0].city_label, 'Royal Palm Beach');
  });

  await t.test('the row cap is applied by the query, and reported', async (t) => {
    const { get } = await fixture(t);
    const { body } = await get('/api/search?limit=1');

    assert.equal(body.establishments.length, 1);
    assert.ok(body.total > 1, 'total is the true count, not the page size');
    assert.equal(body.truncated, true);
  });

  await t.test('a punctuation-only query still matches nothing', async (t) => {
    const { get } = await fixture(t);
    const { body } = await get('/api/search?q=%25%25%25');
    assert.equal(body.total, 0);
    assert.equal(body.establishments.length, 0);
  });

  await t.test('an unknown county is refused rather than ignored', async (t) => {
    const { get } = await fixture(t);
    const { status } = await get('/api/search?county=99');
    assert.equal(status, 400);
  });

  await t.test('the four signals partition the displayed population', async (t) => {
    /*
     * The filter is a WHERE clause, and this is what proves it is the right one:
     * every displayed establishment lands in exactly one bucket. The earlier
     * over-fetch approach could not satisfy this — it answered "serious"
     * statewide with 4 of 1,269, all early in the alphabet, because the window
     * filled before the filter ran.
     */
    const { get } = await fixture(t);
    const all = await get('/api/search?limit=1');

    let sum = 0;
    for (const signal of ['pass', 'warning', 'serious', 'unknown']) {
      const { body } = await get(`/api/search?signal=${signal}&limit=50`);
      assert.ok(body.establishments.every((e) => e.signal === signal), `${signal} rows are ${signal}`);
      sum += body.total;
    }

    assert.equal(sum, all.body.total, 'every establishment has exactly one signal');
  });

  await t.test('a stale pass is filtered as unknown, not as a pass', async (t) => {
    // The staleness rule expressed in SQL has to agree with the one the map
    // applies in JavaScript, or the filter and the pin disagree on screen.
    const { get } = await fixture(t);
    const stale = await get('/api/search?q=stale&signal=unknown');
    const asPass = await get('/api/search?q=stale&signal=pass');

    assert.ok(stale.body.establishments.some((e) => e.name === 'STALE SHACK'));
    assert.ok(!asPass.body.establishments.some((e) => e.name === 'STALE SHACK'));
  });
});

test('GET /api/cities — the per-county filter options (DEC-017)', async (t) => {
  await t.test('returns one county at a time, canonicalised', async (t) => {
    const { db, get } = await fixture(t);
    addEstablishment(db, {
      establishment_id: 'rpb2|2010|2 ROYAL PLM',
      license_key: 'rpb2|2010',
      name: 'ROYAL DELI',
      address: '2 ROYAL PLM WAY',
      normalized_address: '2 ROYAL PLM WAY, ROYAL PLM BEACH, 33411',
      city: 'ROYAL PLM BEACH',
    }, { lat: 26.71, lng: -80.24 });
    addEstablishment(db, {
      establishment_id: 'orange2|2010|9 ORANGE AVE',
      license_key: 'orange2|2010',
      name: 'ORLANDO GRILL',
      address: '9 ORANGE AVE',
      normalized_address: '9 ORANGE AVE, ORLANDO, 32801',
      city: 'ORLANDO',
      county_code: '58',
      county_name: 'Orange',
    }, { lat: 28.55, lng: -81.39 });

    const palm = await get('/api/cities?county=60');
    const names = palm.body.cities.map((c) => c.city);

    assert.ok(names.includes('ROYAL PALM BEACH'), 'the misspelling is counted under the real name');
    assert.ok(!names.includes('ROYAL PLM BEACH'), 'and not as a town of its own');
    assert.ok(!names.includes('ORLANDO'), "another county's cities do not leak in");
    assert.equal(palm.body.cities.find((c) => c.city === 'ROYAL PALM BEACH').label, 'Royal Palm Beach');
  });

  await t.test('an unknown county is refused', async (t) => {
    const { get } = await fixture(t);
    assert.equal((await get('/api/cities?county=99')).status, 400);
  });

  await t.test('meta no longer carries every city in the state', async (t) => {
    // 942 entries, ~64 KB, on the first paint of a phone map — for a menu that
    // only ever shows one county. The route above replaced it.
    const { get } = await fixture(t);
    assert.equal((await get('/api/meta')).body.cities, undefined);
  });
});
