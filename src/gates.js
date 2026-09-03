'use strict';

/**
 * Which counties have passed their accuracy gate — DEC-015, DEC-017.
 *
 * The product displays all 67 counties and says, on each record, whether the
 * pin position in that county has been verified. This module answers that
 * question, and it answers it from `docs/07-gate-status.json`, which
 * `scripts/score-gate.js --all` writes from the same scoring that produces the
 * text report. The hand-verified worksheets remain the source of truth; this is
 * their projection, never a second opinion.
 *
 * THE DEFAULT IS UNVERIFIED, AND THAT IS THE WHOLE DESIGN
 *
 * A missing file, a malformed file, a county not listed, a status this code
 * does not recognise — every one of them resolves to "not verified". The
 * failure mode of a gate lookup must be to claim less than we know, never more.
 * An accuracy claim that appears because a JSON file failed to parse is exactly
 * the kind of confident wrongness this project exists to avoid.
 *
 * Read once at boot. The file changes when a person finishes verifying a
 * county, which is not a per-request event, and a server that re-reads it on
 * every request would be doing file I/O on the map's hot path for nothing.
 */

const fs = require('node:fs');
const path = require('node:path');

const STATUS_PATH = path.join(__dirname, '..', 'docs', '07-gate-status.json');

/** Only a scored PASS counts. `incomplete` and `fail` are both "not verified". */
const PASSED = 'pass';

function loadGateStatus(file = STATUS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing or unreadable is normal — no county has been scored yet — and it
    // is not a reason to refuse to serve a map.
    return {};
  }
}

function createGates(file = STATUS_PATH) {
  const status = loadGateStatus(file);

  const forCounty = (code) => status[String(code)] ?? null;

  return {
    /** True only for a county whose worksheet scored a PASS. */
    verified: (code) => forCounty(code)?.status === PASSED,

    /** When it passed, for the UI to cite. Null when it has not. */
    verifiedAt: (code) => (forCounty(code)?.status === PASSED ? forCounty(code).scored_at ?? null : null),

    /** `pass` | `fail` | `incomplete` | `not-drawn` — never null, for reporting. */
    statusOf: (code) => forCounty(code)?.status ?? 'not-drawn',

    /** The score itself, where one exists: { within, total }. */
    scoreOf: (code) => {
      const row = forCounty(code);
      return row?.within == null ? null : { within: row.within, total: row.total };
    },
  };
}

module.exports = { createGates, loadGateStatus, STATUS_PATH };
