/**
 * Population drift since the draw — DEC-016.
 *
 * The sample was drawn from the displayed population as it stood. A weekly
 * ingest keeps changing that population, so the gate needs a stated rule for
 * what happens in between, and it needs one that can actually be satisfied:
 * redrawing on every change means a weekly ingest resets verification weekly
 * and the gate is never completed. A rule that can never be met is not a gate.
 *
 * So verification proceeds against the frozen draw, with two guards.
 *
 * The first is a cap, and the reason is that drift is NOT neutral. The
 * establishments that join the population between draws are the ones that were
 * hard to place — they needed the paid tier, or several attempts. They are
 * therefore MORE likely to be misplaced than the average member, so leaving
 * them out biases the result optimistically. A small amount of that is
 * tolerable; an unbounded amount is a gate measuring a population that no
 * longer resembles what ships.
 *
 * The second is that this figure is printed next to every verdict. A gate
 * result that does not state the population it measured, and how far the live
 * one has moved since, is a claim with a hidden denominator.
 */
const MAX_DRIFT_PCT = 5;

function populationNow() {
  const crypto = require('node:crypto');
  const { open } = require('../src/db');
  const { displayedPredicate } = require('../src/display');

  const county = process.env.SAFE_EATS_GATE_COUNTY || '60';
  const db = open({ readonly: true });
  try {
    const d = displayedPredicate('e', { counties: county });
    const ids = db
      .prepare(
        `SELECT e.establishment_id FROM establishment e
          WHERE ${d.sql} AND e.lat IS NOT NULL AND e.lng IS NOT NULL
          ORDER BY e.establishment_id`
      )
      .all(...d.params)
      .map((r) => r.establishment_id);

    return {
      county,
      size: ids.length,
      fingerprint: crypto.createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16),
      ids: new Set(ids),
    };
  } finally {
    db.close();
  }
}

/** The draw this worksheet came from — the last entry in the history. */
function lastDraw() {
  const fs = require('node:fs');
  const { gatePaths } = require('./gate-paths');
  const file = gatePaths(process.env.SAFE_EATS_GATE_COUNTY || '60').history;
  if (!fs.existsSync(file)) return null;
  const history = JSON.parse(fs.readFileSync(file, 'utf8'));
  return history[history.length - 1] ?? null;
}

/**
 * @param {string[]} sampledIds  the establishment ids on the worksheet
 * @returns drift facts, or null when the database cannot be read
 */
function measureDrift(sampledIds) {
  let now;
  try {
    now = populationNow();
  } catch {
    return null; // scoring must still work without a database to hand
  }

  const draw = lastDraw();
  const drawnSize = draw?.populationSize ?? null;
  const grew = drawnSize === null ? null : now.size - drawnSize;
  const pct = drawnSize ? Math.abs(grew / drawnSize) * 100 : null;

  const gone = sampledIds.filter((id) => !now.ids.has(id));

  return {
    county: now.county,
    drawnAt: draw?.drawnAt ?? null,
    drawnFingerprint: draw?.populationFingerprint ?? null,
    drawnSize,
    nowFingerprint: now.fingerprint,
    nowSize: now.size,
    grew,
    pct,
    gone,
    withinBound: pct === null ? true : pct <= MAX_DRIFT_PCT,
  };
}

module.exports = { measureDrift, MAX_DRIFT_PCT };
