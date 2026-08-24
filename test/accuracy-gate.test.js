'use strict';

/**
 * Tests for the AC-E2-GATE scorer.
 *
 * The gate decides whether v1.0 launches, so the property that matters most is
 * the refusal: an incomplete worksheet must never produce a passing number.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  distanceMetres, score, THRESHOLD_WITHIN, THRESHOLD_DISTANCE_M,
} = require('../scripts/score-gate.js');

/** A row as the CSV parser hands it over. */
function row(n, over = {}) {
  return {
    n: String(n),
    establishment_id: `E${n}`,
    business_name: `PLACE ${n}`,
    geocoded_lat: '26.700000',
    geocoded_lng: '-80.100000',
    verdict: '', true_lat: '', true_lng: '', cause: '', notes: '',
    ...over,
  };
}

const okRows = (count) => Array.from({ length: count }, (_, i) => row(i + 1, { verdict: 'ok' }));

test('distanceMetres — known separations', () => {
  assert.equal(Math.round(distanceMetres(26.7, -80.1, 26.7, -80.1)), 0);

  // 0.001 degree of latitude is ~111 m.
  const northSouth = distanceMetres(26.7, -80.1, 26.701, -80.1);
  assert.ok(northSouth > 110 && northSouth < 112, `got ${northSouth}`);

  // ~50 m north — straddles the threshold, so it must land close to it.
  const fifty = distanceMetres(26.7, -80.1, 26.70045, -80.1);
  assert.ok(fifty > 48 && fifty < 52, `got ${fifty}`);
});

test('the threshold constants match the PRD', () => {
  assert.equal(THRESHOLD_WITHIN, 99);
  assert.equal(THRESHOLD_DISTANCE_M, 50);
});

test('an unverified worksheet yields no verdict', () => {
  const result = score([row(1), row(2), row(3)]);
  assert.equal(result.unverified.length, 3);
  assert.equal(result.evaluated.length, 0);
});

test('a partially verified worksheet still yields no verdict', () => {
  const rows = [...okRows(99), row(100)];
  const result = score(rows);
  assert.equal(result.unverified.length, 1,
    'one blank row must keep the sample incomplete');
  assert.equal(result.evaluated.length, 99);
});

test('a blank row is not counted as a pass', () => {
  // 99 ok + 1 blank must NOT be reportable as 99/100.
  const result = score([...okRows(99), row(100)]);
  const within = result.evaluated.filter((e) => e.within).length;
  assert.equal(within, 99);
  assert.ok(result.unverified.length > 0,
    'the blank row must be surfaced rather than silently dropped');
});

test('verdict ok counts as within without coordinates', () => {
  const result = score([row(1, { verdict: 'ok' })]);
  assert.equal(result.problems.length, 0);
  assert.equal(result.evaluated[0].within, true);
});

test('verdict off beyond the threshold is a failure', () => {
  const result = score([row(1, {
    verdict: 'off', true_lat: '26.702000', true_lng: '-80.100000', cause: 'wrong-block',
  })]);
  assert.equal(result.problems.length, 0);
  assert.equal(result.evaluated[0].within, false);
  assert.ok(result.evaluated[0].distance > 200);
  assert.equal(result.evaluated[0].cause, 'wrong-block');
});

test('verdict off inside the threshold counts as within — the rule is distance', () => {
  const result = score([row(1, {
    verdict: 'off', true_lat: '26.70020', true_lng: '-80.100000', cause: 'plaza-ambiguity',
  })]);
  assert.equal(result.evaluated[0].within, true, 'a ~22 m offset is inside 50 m');
});

test('off without a measured true position is a worksheet problem', () => {
  const result = score([row(1, { verdict: 'off', cause: 'wrong-block' })]);
  assert.match(result.problems[0], /needs true_lat\/true_lng/);
  assert.equal(result.evaluated.length, 0);
});

test('off without a cause is a worksheet problem', () => {
  const result = score([row(1, {
    verdict: 'off', true_lat: '26.702', true_lng: '-80.1',
  })]);
  assert.match(result.problems[0], /needs a cause/);
});

test('a cause outside the taxonomy is rejected', () => {
  const result = score([row(1, {
    verdict: 'off', true_lat: '26.702', true_lng: '-80.1', cause: 'looked-wrong',
  })]);
  assert.match(result.problems[0], /not in the taxonomy/);
});

test('an unrecognised verdict is rejected rather than coerced', () => {
  for (const v of ['yes', 'pass', 'y', 'good']) {
    const result = score([row(1, { verdict: v })]);
    assert.match(result.problems[0], /is not ok\/off\/unsure/, `${v} should be rejected`);
    assert.equal(result.evaluated.length, 0);
  }
});

test('a complete sample at exactly the threshold', () => {
  const rows = [
    ...okRows(99),
    row(100, { verdict: 'off', true_lat: '26.705', true_lng: '-80.1', cause: 'zip-centroid' }),
  ];
  const result = score(rows);
  assert.equal(result.unverified.length, 0);
  assert.equal(result.problems.length, 0);
  assert.equal(result.evaluated.filter((e) => e.within).length, 99);
});

test('a complete sample one below the threshold', () => {
  const rows = [
    ...okRows(98),
    row(99, { verdict: 'off', true_lat: '26.705', true_lng: '-80.1', cause: 'zip-centroid' }),
    row(100, { verdict: 'off', true_lat: '26.706', true_lng: '-80.1', cause: 'wrong-block' }),
  ];
  const result = score(rows);
  assert.equal(result.evaluated.filter((e) => e.within).length, 98);
  assert.ok(98 < THRESHOLD_WITHIN, 'this sample must read as a gate failure');
});

test('unsure is treated like off — it needs measurement, not benefit of the doubt', () => {
  const missing = score([row(1, { verdict: 'unsure' })]);
  assert.match(missing.problems[0], /needs true_lat\/true_lng/);

  const measured = score([row(1, {
    verdict: 'unsure', true_lat: '26.705', true_lng: '-80.1', cause: 'plaza-ambiguity',
  })]);
  assert.equal(measured.evaluated[0].within, false);
});
