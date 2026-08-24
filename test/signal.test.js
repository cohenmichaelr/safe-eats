'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  SIGNAL,
  SIGNAL_DISPLAY,
  DISPOSITION_MAP,
  UnknownDispositionError,
  toSignal,
  isKnownDisposition,
  establishmentSignal,
} = require('../src/signal');

/**
 * Every disposition present in the live DBPR extracts across all seven districts
 * for FY2627 to date, with observed statewide frequency. If the ingest throws on
 * a disposition, it belongs in this list and in DISPOSITION_MAP.
 */
const OBSERVED_STATEWIDE = [
  ['Inspection Completed - No Further Action', 13215, SIGNAL.PASS],
  ['Warning Issued', 2882, SIGNAL.WARNING],
  ['Call Back - Complied', 2388, SIGNAL.PASS],
  ['Administrative complaint recommended', 1321, SIGNAL.SERIOUS],
  ['Call Back - Admin. complaint recommended', 490, SIGNAL.SERIOUS],
  ['Call Back - Extension given, pending', 438, SIGNAL.WARNING],
  ['Emergency order recommended', 236, SIGNAL.SERIOUS],
  ['Emergency Order Callback Complied', 171, SIGNAL.PASS],
  ['Emergency Order Callback Not Complied', 90, SIGNAL.SERIOUS],
  ['Emergency Order Callback Time Extension', 37, SIGNAL.WARNING],
  ['Administrative determination recommended', 4, SIGNAL.SERIOUS],
  ['Insp. Completed - Warning Given, Pending', 1, SIGNAL.WARNING],
];

describe('FR-301 — every observed disposition maps explicitly', () => {
  for (const [disposition, frequency, expected] of OBSERVED_STATEWIDE) {
    test(`${disposition} (n=${frequency}) → ${expected}`, () => {
      assert.equal(toSignal(disposition), expected);
    });
  }

  test('covers every disposition seen in the live extracts', () => {
    const unmapped = OBSERVED_STATEWIDE.filter(([d]) => !isKnownDisposition(d));
    assert.deepEqual(unmapped, [], 'every observed disposition must be mapped');
  });

  test('matching is case- and whitespace-insensitive', () => {
    assert.equal(toSignal('  WARNING ISSUED  '), SIGNAL.WARNING);
    assert.equal(toSignal('Call Back -   Complied'), SIGNAL.PASS);
  });
});

describe('FR-301 — unknown dispositions abort rather than defaulting', () => {
  test('throws on an unrecognised disposition', () => {
    assert.throws(() => toSignal('Cordially Invited To Improve'), UnknownDispositionError);
  });

  test('the error names the disposition and refuses to guess', () => {
    try {
      toSignal('Brand New Disposition');
      assert.fail('should have thrown');
    } catch (error) {
      assert.match(error.message, /Brand New Disposition/);
      assert.match(error.message, /never default to "pass"/);
    }
  });

  test('an unknown disposition never silently becomes a pass', () => {
    for (const value of ['Closed', 'Failed', 'Pending Review', 'N/A']) {
      assert.throws(() => toSignal(value), UnknownDispositionError, `${value} must not map silently`);
    }
  });

  test('a blank disposition is unknown, not an error', () => {
    assert.equal(toSignal(''), SIGNAL.UNKNOWN);
    assert.equal(toSignal(null), SIGNAL.UNKNOWN);
  });
});

describe('establishment signal reflects the most recent inspection', () => {
  const now = new Date('2026-08-21T00:00:00Z');

  test('uses the most recent inspection signal', () => {
    const signal = establishmentSignal(
      { inspection_date: '2026-08-01', signal: SIGNAL.SERIOUS, disposition: 'Emergency order recommended' },
      now
    );
    assert.equal(signal, SIGNAL.SERIOUS);
  });

  test('an inspection older than 24 months reads as no recent inspection', () => {
    const signal = establishmentSignal(
      { inspection_date: '2022-07-01', signal: SIGNAL.PASS, disposition: 'Inspection Completed - No Further Action' },
      now
    );
    assert.equal(
      signal,
      SIGNAL.UNKNOWN,
      'v1 served 2022 data as current; stale results must not read as a pass'
    );
  });

  test('an inspection just inside the window is still reported', () => {
    const signal = establishmentSignal({ inspection_date: '2024-10-01', signal: SIGNAL.PASS }, now);
    assert.equal(signal, SIGNAL.PASS);
  });

  test('missing or unparseable dates are unknown', () => {
    assert.equal(establishmentSignal(null, now), SIGNAL.UNKNOWN);
    assert.equal(establishmentSignal({ inspection_date: null }, now), SIGNAL.UNKNOWN);
    assert.equal(establishmentSignal({ inspection_date: 'not a date' }, now), SIGNAL.UNKNOWN);
  });
});

describe('FR-404 — signal is not carried by colour alone', () => {
  test('every signal has a distinct shape as well as a colour', () => {
    const signals = Object.values(SIGNAL);
    const shapes = signals.map((s) => SIGNAL_DISPLAY[s].shape);
    assert.equal(new Set(shapes).size, signals.length, 'shapes must be unique per signal');
  });

  test('every signal has a human-readable label', () => {
    for (const signal of Object.values(SIGNAL)) {
      assert.ok(SIGNAL_DISPLAY[signal].label.length > 0);
    }
  });

});

describe('safety invariants of the mapping itself', () => {
  test('no enforcement disposition is ever mapped to pass', () => {
    const enforcementWords = /complaint|determination|emergency order recommended|not complied/i;

    for (const [disposition, signal] of DISPOSITION_MAP) {
      if (enforcementWords.test(disposition)) {
        assert.notEqual(
          signal,
          SIGNAL.PASS,
          `"${disposition}" indicates enforcement and must not read as a pass`
        );
      }
    }
  });

  test('a "complied" callback resolves an earlier problem and may pass', () => {
    assert.equal(toSignal('Call Back - Complied'), SIGNAL.PASS);
    assert.equal(toSignal('Emergency Order Callback Complied'), SIGNAL.PASS);
  });

  test('every mapped value is a defined signal', () => {
    const valid = new Set(Object.values(SIGNAL));
    for (const [disposition, signal] of DISPOSITION_MAP) {
      assert.ok(valid.has(signal), `"${disposition}" maps to an unrecognised signal`);
    }
  });

  test('the mapping covers all 12 dispositions observed statewide', () => {
    assert.equal(DISPOSITION_MAP.size, OBSERVED_STATEWIDE.length + 1); // + 'assigned to inspector'
  });
});
