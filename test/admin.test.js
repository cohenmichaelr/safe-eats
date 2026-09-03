'use strict';

/**
 * The manual refresh trigger — /admin.html and its two routes.
 *
 * What is worth testing here is not that a refresh works (scripts/refresh.js
 * owns that, and it aborts loudly when it does not). It is everything around
 * it that could silently do the wrong thing:
 *
 *   - a typo'd county must be a 400, not a run that quietly refreshes nothing
 *   - two refreshes must never run at once, however they were triggered
 *
 * The routes are open by decision, so there is nothing here about who may call
 * them. The runner is injected, so no test ever spawns a real ingest.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrate } = require('../src/migrate');
const { createApp } = require('../src/server');
const { createRefreshRunner, outcomeFor } = require('../src/refresh-runner');
const { COUNTIES } = require('../src/display');

/** A runner-shaped double that records what it was asked to do. */
function fakeRunner() {
  const calls = [];
  let running = false;
  let run = null;

  return {
    calls,
    finish: (outcome = 'ok') => {
      running = false;
      run = { ...run, running: false, outcome, exit_code: outcome === 'ok' ? 0 : 1 };
    },
    start(options) {
      calls.push(options);
      if (running) return { started: false, reason: 'A refresh is already running.', run };
      // Validation is the real runner's, and the route must surface it.
      for (const c of options.counties ?? []) {
        if (!(String(c) in COUNTIES)) {
          const err = new Error(`Not a displayed county: ${c}`);
          err.status = 400;
          throw err;
        }
      }
      running = true;
      run = { running: true, trigger: options.trigger, counties: options.counties, log: [] };
      return { started: true, run };
    },
    state: () => run,
    isRunning: () => running,
    stop() {},
  };
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-admin-'));
  const db = new Database(path.join(dir, 'test.db'));
  migrate(db);

  const runner = fakeRunner();
  const server = createApp(db, { refreshRunner: runner }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = async (method, url, { body, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  return { db, runner, call };
}

test('manual refresh', async (t) => {
  await t.test('status lists the counties that can be refreshed', async (t) => {
    const { call } = await fixture(t);
    const { status, body } = await call('GET', '/api/admin/refresh');

    assert.equal(status, 200);
    assert.deepEqual(
      body.counties.map((c) => c.code).sort(),
      ['16', '23', '60'],
      'the dropdown is fed from the displayed population, not a hand-kept list'
    );
    assert.equal(body.run, null, 'nothing has run in this process yet');
    assert.equal(body.as_of, null, 'and nothing has ever been ingested');
  });

  await t.test('a county selection reaches the runner as that county alone', async (t) => {
    const { call, runner } = await fixture(t);
    const { status } = await call('POST', '/api/admin/refresh', { body: { county: '16' } });

    assert.equal(status, 202, 'accepted — the answer to "did it work" comes from polling');
    assert.deepEqual(runner.calls[0].counties, ['16']);
    assert.equal(runner.calls[0].trigger, 'manual');
  });

  await t.test('"all" means every county, expressed as no narrowing', async (t) => {
    const { call, runner } = await fixture(t);
    await call('POST', '/api/admin/refresh', { body: { county: 'all' } });
    assert.deepEqual(runner.calls[0].counties, []);
  });

  await t.test('an unknown county is refused, not silently refreshed', async (t) => {
    // The failure this closes: a typo'd code loads zero rows for that county,
    // every step exits 0, and the page reports a successful refresh of nothing.
    const { call } = await fixture(t);
    const { status, body } = await call('POST', '/api/admin/refresh', { body: { county: '99' } });

    assert.equal(status, 400);
    assert.match(body.error, /Not a displayed county/);
  });

  await t.test('a second refresh is refused while one is running', async (t) => {
    const { call } = await fixture(t);
    await call('POST', '/api/admin/refresh', { body: { county: '60' } });
    const { status, body } = await call('POST', '/api/admin/refresh', { body: { county: '60' } });

    assert.equal(status, 409, 'two ingests writing the same rows is not a reachable state');
    assert.match(body.error, /already running/);
    assert.equal(body.run.running, true, 'and the caller is told what to watch instead');
  });

  await t.test('skipping geocoding is passed through, not reinvented', async (t) => {
    const { call, runner } = await fixture(t);
    await call('POST', '/api/admin/refresh', { body: { county: 'all', skip_geocode: true } });
    assert.equal(runner.calls[0].skipGeocode, true);
  });

});

test('refresh outcomes follow the exit-code contract', () => {
  // Exit 2 is "the data is fine, something else wants eyes" (the basemap
  // canary). Reporting it as a failure would train the operator to ignore it.
  assert.equal(outcomeFor(0), 'ok');
  assert.equal(outcomeFor(1), 'failed');
  assert.equal(outcomeFor(2), 'needs-look');
  assert.equal(outcomeFor(null), 'failed');
});

test('the runner refuses to start two refreshes', async (t) => {
  // The real runner this time, against a script that exits on its own — the
  // guard is the point, not the refresh.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-runner-'));
  const script = path.join(dir, 'slow.js');
  fs.writeFileSync(script, 'setTimeout(() => process.exit(0), 400);');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createRefreshRunner({ script, cwd: dir, echo: () => {} });

  const first = runner.start({ counties: ['60'] });
  assert.equal(first.started, true);
  assert.equal(first.run.counties[0], '60');

  const second = runner.start({ counties: [] });
  assert.equal(second.started, false);
  assert.match(second.reason, /already running/);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(runner.isRunning(), false);
  assert.equal(runner.state().outcome, 'ok');
  assert.equal(runner.state().exit_code, 0);

  // And once it is done, another may start.
  assert.equal(runner.start({ counties: [] }).started, true);
  runner.stop();
});

/**
 * The raw data browser — /data.html and /api/admin/data.
 *
 * The map's API is tested for what it hides (test/api.test.js: mobile vendors
 * off the map, expired inspections, the visit that carries the outcome). This
 * one is tested for the opposite: it must hide nothing, because it is what you
 * open when the map looks wrong. A raw browser that quietly filters is worse
 * than none — it would confirm a bug is absent by not showing it.
 */
test('raw data browser', async (t) => {
  /** Rows the map deliberately does not show, so "raw" can be checked. */
  function seedRaw(db) {
    const insert = (row) =>
      db.prepare(
        `INSERT INTO establishment (establishment_id, license_key, license_number, name,
            address, normalized_address, city, zip, county_code, county_name, district,
            license_type_code, seats, risk_level, first_seen_at, last_seen_at)
         VALUES (@establishment_id, @license_key, @license_number, @name,
            @address, @normalized_address, @city, @zip, @county_code, @county_name, @district,
            @license_type_code, @seats, @risk_level, @first_seen_at, @last_seen_at)`
      ).run(row);

    const base = {
      license_number: 'SEA6000001',
      address: '100 MAIN ST',
      normalized_address: '100 MAIN ST, DELRAY BEACH, 33444',
      city: 'DELRAY BEACH',
      zip: '33444',
      county_code: '60',
      county_name: 'Palm Beach',
      district: '2',
      seats: 40,
      risk_level: 'Risk Level 2',
      first_seen_at: '2026-08-24T00:00:00.000Z',
      last_seen_at: '2026-08-24T00:00:00.000Z',
    };

    insert({ ...base, establishment_id: 'diner', license_key: '1|2010', name: "WENDY'S DINER", license_type_code: '2010' });
    insert({ ...base, establishment_id: 'truck', license_key: '2|2014', name: 'TACO TRUCK', license_type_code: '2014' });
    insert({ ...base, establishment_id: 'broward', license_key: '3|2010', name: 'BROWARD CAFE',
             license_type_code: '2010', county_code: '16', county_name: 'Broward' });

    db.prepare(
      `INSERT INTO inspection (inspection_visit_id, inspection_number, license_key, inspection_date,
          disposition, signal, visit_number, total_violations, high_violations)
       VALUES ('v1', 'c1', '1|2010', '2026-06-01', 'Inspection Completed - No Further Action', 'pass', 1, 2, 0)`
    ).run();
    db.prepare(`INSERT INTO violation (inspection_visit_id, violation_code, count) VALUES ('v1', '22', 2)`).run();
  }

  await t.test('a mobile vendor the map hides is present in the raw rows', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);

    const { status, body } = await call('GET', '/api/admin/data');
    assert.equal(status, 200);
    assert.equal(body.total, 3, 'every licence type, not just the displayed one');
    assert.ok(body.rows.some((r) => r.establishment_id === 'truck'), 'the food truck must be here');
  });

  await t.test('the facets are counted from the data, not hardcoded', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);

    const { body } = await call('GET', '/api/admin/data');
    const types = Object.fromEntries(body.types.map((row) => [row.code, row]));
    assert.equal(types['2010'].n, 2);
    assert.equal(types['2014'].name, 'Mobile food dispensing vehicle');
  });

  await t.test('search matches punctuation-insensitively, like the map does', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);

    const { body } = await call('GET', '/api/admin/data?q=wendys');
    assert.equal(body.total, 1, '"wendys" must reach the row stored as WENDY\'S');
    assert.equal(body.rows[0].establishment_id, 'diner');
  });

  await t.test('a punctuation-only query matches nothing, not everything', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);
    const { body } = await call('GET', '/api/admin/data?q=%25%25');
    assert.equal(body.total, 0, 'a nonsense query answered with the whole database reads as working');
  });

  await t.test('filters narrow by county, type and whether a row is geocoded', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);

    assert.equal((await call('GET', '/api/admin/data?county=16')).body.total, 1);
    assert.equal((await call('GET', '/api/admin/data?type=2014')).body.total, 1);
    assert.equal((await call('GET', '/api/admin/data?geocoded=no')).body.total, 3, 'nothing is geocoded here');
    assert.equal((await call('GET', '/api/admin/data?geocoded=yes')).body.total, 0);
  });

  await t.test('an unknown county is a 400', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);
    assert.equal((await call('GET', '/api/admin/data?county=99')).status, 400);
  });

  await t.test('the record carries every visit, its violations, and why it is off the map', async (t) => {
    const { db, call } = await fixture(t);
    seedRaw(db);

    const diner = await call('GET', '/api/admin/data/diner');
    assert.equal(diner.status, 200);
    assert.equal(diner.body.inspections.length, 1);
    assert.deepEqual(diner.body.inspections[0].violations, [{ violation_code: '22', count: 2 }]);
    assert.equal(diner.body.establishment.displayed, true);

    const truck = await call('GET', '/api/admin/data/truck');
    assert.equal(truck.body.establishment.displayed, false, 'and it says so rather than leaving it inferred');
    assert.equal(truck.body.establishment.license_type_name, 'Mobile food dispensing vehicle');

    assert.equal((await call('GET', '/api/admin/data/nope')).status, 404);
  });

});
