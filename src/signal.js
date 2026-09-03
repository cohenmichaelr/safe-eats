'use strict';

/**
 * Disposition → safety signal — FR-301, MVP-SE-001 §5.
 *
 * Every disposition observed in the live DBPR extract is mapped explicitly.
 * An unrecognised value THROWS rather than defaulting: silently treating an
 * unknown disposition as passing is how a data-format change becomes a
 * false reassurance to someone deciding where to eat.
 */

const SIGNAL = Object.freeze({
  PASS: 'pass',
  WARNING: 'warning',
  SERIOUS: 'serious',
  UNKNOWN: 'unknown',
});

/** Keys are lowercased dispositions with collapsed whitespace. */
const DISPOSITION_MAP = new Map([
  // Resolved — no outstanding action.
  ['inspection completed - no further action', SIGNAL.PASS],
  ['call back - complied', SIGNAL.PASS],
  ['emergency order callback complied', SIGNAL.PASS],

  // Violations found; follow-up outstanding.
  ['warning issued', SIGNAL.WARNING],
  ['insp. completed - warning given, pending', SIGNAL.WARNING],
  ['call back - extension given, pending', SIGNAL.WARNING],
  ['emergency order callback time extension', SIGNAL.WARNING],

  // Escalated to enforcement.
  ['administrative complaint recommended', SIGNAL.SERIOUS],
  ['call back - admin. complaint recommended', SIGNAL.SERIOUS],
  // Rare (4 of 21,279 statewide inspections in FY2627 to date). Grouped with the
  // other enforcement referrals: it is a determination proceeding, not a clean
  // result. Conservative by design — see the fail-fast rationale above.
  ['administrative determination recommended', SIGNAL.SERIOUS],
  ['emergency order recommended', SIGNAL.SERIOUS],
  ['emergency order callback not complied', SIGNAL.SERIOUS],

  // Scheduled but not yet performed — carries no finding either way.
  ['assigned to inspector', SIGNAL.UNKNOWN],
]);

class UnknownDispositionError extends Error {
  constructor(disposition) {
    super(
      `Unmapped inspection disposition: ${JSON.stringify(disposition)}. ` +
        `Add it to DISPOSITION_MAP in src/signal.js after confirming its meaning with DBPR. ` +
        `Refusing to guess — an unmapped disposition must never default to "pass" (FR-301).`
    );
    this.name = 'UnknownDispositionError';
    this.disposition = disposition;
  }
}

const normalize = (value) => (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

/** Map one disposition. Throws on anything unrecognised. */
function toSignal(disposition) {
  const key = normalize(disposition);
  if (key === '') return SIGNAL.UNKNOWN;

  const signal = DISPOSITION_MAP.get(key);
  if (signal === undefined) throw new UnknownDispositionError(disposition);
  return signal;
}

/** Non-throwing probe, for reporting drift without aborting a read path. */
function isKnownDisposition(disposition) {
  const key = normalize(disposition);
  return key === '' || DISPOSITION_MAP.has(key);
}

/**
 * An establishment's displayed signal is that of its most recent inspection.
 * Inspections older than this are shown as "no recent inspection" rather than
 * as a current claim about the premises.
 */
const STALE_AFTER_MONTHS = 24;

function establishmentSignal(mostRecent, now = new Date()) {
  if (!mostRecent?.inspection_date) return SIGNAL.UNKNOWN;

  const inspected = new Date(mostRecent.inspection_date);
  if (Number.isNaN(inspected.getTime())) return SIGNAL.UNKNOWN;

  /*
   * UTC getters, deliberately. `new Date('2024-09-01')` parses as UTC midnight,
   * so reading a LOCAL month puts it in August anywhere west of Greenwich — and
   * an inspection exactly on the boundary would then be stale in Florida and
   * fresh in London, from the same data. Staleness must not depend on where the
   * server is, and the SQL form of this rule (staleCutoff, used by the signal
   * filter) compares the date string as written, which is the UTC reading.
   */
  const monthsAgo =
    (now.getUTCFullYear() - inspected.getUTCFullYear()) * 12
    + (now.getUTCMonth() - inspected.getUTCMonth());
  if (monthsAgo > STALE_AFTER_MONTHS) return SIGNAL.UNKNOWN;

  return mostRecent.signal ?? toSignal(mostRecent.disposition);
}

/**
 * The staleness boundary as a date, for callers that must express the same rule
 * in SQL — the statewide signal filter (DEC-017).
 *
 * `establishmentSignal` compares whole months; this returns the first date that
 * still counts as recent, so `inspection_date >= staleCutoff(now)` selects
 * exactly the rows that function does not call stale. Derived from the same
 * STALE_AFTER_MONTHS, so the rule has one home even though it is asked in two
 * languages — a second literal "24" in a query is how the map and the filter
 * would come to disagree about what "recent" means.
 */
function staleCutoff(now = new Date()) {
  const boundary = new Date(Date.UTC(now.getFullYear(), now.getMonth() - STALE_AFTER_MONTHS, 1));
  return boundary.toISOString().slice(0, 10);
}

/** Presentation metadata. Colour is never the only channel — FR-404. */
const SIGNAL_DISPLAY = Object.freeze({
  [SIGNAL.PASS]:    { label: 'Met standards',        shape: 'circle',   color: '#1a7f37' },
  [SIGNAL.WARNING]: { label: 'Violations found',     shape: 'triangle', color: '#bf8700' },
  [SIGNAL.SERIOUS]: { label: 'Enforcement action',   shape: 'square',   color: '#cf222e' },
  [SIGNAL.UNKNOWN]: { label: 'No recent inspection', shape: 'diamond',  color: '#6e7781' },
});

module.exports = {
  SIGNAL,
  SIGNAL_DISPLAY,
  DISPOSITION_MAP,
  UnknownDispositionError,
  STALE_AFTER_MONTHS,
  staleCutoff,
  toSignal,
  isKnownDisposition,
  establishmentSignal,
};
