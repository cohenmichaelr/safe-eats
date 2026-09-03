'use strict';

/**
 * Statewide scope and the gate labelling — DEC-017.
 *
 * The theme of every case here is the same: a claim the product has not earned
 * must not appear by accident. A missing status file, an unrecognised status, a
 * county nobody has scored — each has to resolve to "not verified", because the
 * failure that matters is a pin in an unchecked county looking exactly like a
 * pin in a checked one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createGates, loadGateStatus } = require('../src/gates');
const { COUNTIES, DISPLAYED_COUNTIES, countyName, displayedPredicate } = require('../src/display');
const { inScope, DISTRICTS } = require('../src/ingest');

function statusFile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-gates-'));
  const file = path.join(dir, 'status.json');
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return file;
}

test('county scope is the whole state', async (t) => {
  await t.test('all 67 counties, codes 11 to 77', () => {
    assert.equal(Object.keys(COUNTIES).length, 67);
    assert.equal(DISPLAYED_COUNTIES.length, 67);
    assert.equal(countyName('11'), 'Alachua');
    assert.equal(countyName('77'), 'Washington');
  });

  await t.test('the out-of-state codes are not counties', () => {
    // DBPR publishes ten of them (701-746). They carry 17 rows and no
    // restaurants, and they are what the CHECK in 007 exists to refuse.
    assert.equal(inScope('11'), true);
    assert.equal(inScope('77'), true);
    assert.equal(inScope('701'), false);
    assert.equal(inScope('10'), false);
    assert.equal(inScope(''), false);
    assert.equal(inScope(undefined), false);
  });

  await t.test('every district is fetched, because a county can span two', () => {
    // Okeechobee is 7 rows in district 4 and 84 in district 7. A
    // county-to-district map would drop the smaller half and look fine.
    assert.deepEqual(DISTRICTS, ['1', '2', '3', '4', '5', '6', '7']);
  });

  await t.test('the displayed predicate still refuses a county Florida lacks', () => {
    assert.throws(() => displayedPredicate('e', { counties: '99' }), /Not a displayed county/);
    assert.doesNotThrow(() => displayedPredicate('e', { counties: '58' }));
  });
});

test('gate status', async (t) => {
  await t.test('a passing county is verified and cites when', (t) => {
    const file = statusFile(t, {
      60: { status: 'pass', within: 99, total: 100, scored_at: '2026-09-03T00:00:00.000Z' },
    });
    const gates = createGates(file);

    assert.equal(gates.verified('60'), true);
    assert.equal(gates.verifiedAt('60'), '2026-09-03T00:00:00.000Z');
    assert.deepEqual(gates.scoreOf('60'), { within: 99, total: 100 });
  });

  await t.test('incomplete and failed are both "not verified"', (t) => {
    const gates = createGates(statusFile(t, {
      16: { status: 'incomplete', within: null, total: null },
      23: { status: 'fail', within: 91, total: 100 },
    }));

    assert.equal(gates.verified('16'), false, 'a partly-filled worksheet is not a pass');
    assert.equal(gates.verified('23'), false, 'and neither is a failure');
    assert.equal(gates.statusOf('23'), 'fail', 'though the report can still say which');
  });

  await t.test('a county nobody has scored is not verified', (t) => {
    const gates = createGates(statusFile(t, { 60: { status: 'pass' } }));
    assert.equal(gates.verified('12'), false);
    assert.equal(gates.statusOf('12'), 'not-drawn');
    assert.equal(gates.verifiedAt('12'), null);
  });

  await t.test('a missing or corrupt status file verifies nothing', (t) => {
    // The important direction: it must fail closed. A JSON parse error that
    // produced "everything is verified" would be the product claiming a
    // measurement nobody made.
    for (const gates of [
      createGates(path.join(os.tmpdir(), 'safe-eats-no-such-file.json')),
      createGates(statusFile(t, 'not json at all')),
      createGates(statusFile(t, '[]')),
    ]) {
      assert.equal(gates.verified('60'), false);
      assert.equal(gates.statusOf('60'), 'not-drawn');
    }
  });

  await t.test('an unrecognised status is not a pass', (t) => {
    const gates = createGates(statusFile(t, { 60: { status: 'probably fine' } }));
    assert.equal(gates.verified('60'), false);
  });

  await t.test('loadGateStatus returns an object even when there is nothing to load', () => {
    assert.deepEqual(loadGateStatus(path.join(os.tmpdir(), 'safe-eats-absent.json')), {});
  });
});
