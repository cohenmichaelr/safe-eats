'use strict';

/**
 * Scores the AC-E2-GATE accuracy sample against the ≥99/100 rule.
 *
 * The verdicts this reads are produced by hand against satellite imagery — that
 * step is human judgement and is not automated anywhere in this repository. This
 * script only measures what a person recorded.
 *
 * It refuses to issue a gate verdict while any row is unverified. A blank row is
 * NOT a pass. The charter makes this the one gate that stops the project, so a
 * partially-filled worksheet reporting "99/99" would be the single most damaging
 * number this codebase could produce.
 *
 *   node scripts/score-gate.js            report progress or the final verdict
 *   node scripts/score-gate.js --record   also write the result into 07-accuracy-gate.md
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { gatePaths } = require('./gate-paths');

const GATE_COUNTY = process.env.SAFE_EATS_GATE_COUNTY || '60';
const CSV_PATH = gatePaths(GATE_COUNTY).csv;
const DOC_PATH = gatePaths(GATE_COUNTY).doc;

const THRESHOLD_WITHIN = 99;      // "at least 99 must fall within 50 metres"
const THRESHOLD_DISTANCE_M = 50;

const VALID_VERDICTS = new Set(['ok', 'off', 'unsure']);
const VALID_CAUSES = new Set([
  'street-interpolation', 'wrong-block', 'zip-centroid',
  'plaza-ambiguity', 'stale-address', 'wrong-city', 'other',
]);

/** Haversine, metres. Adequate at this scale; the gate is 50 m, not 50 cm. */
function distanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function loadRows() {
  const { parse } = require('csv-parse/sync');
  return parse(fs.readFileSync(CSV_PATH), { columns: true, bom: true, skip_empty_lines: true });
}

function num(v) {
  const n = Number.parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function score(rows) {
  const problems = [];
  const unverified = [];
  const evaluated = [];

  for (const r of rows) {
    const n = r.n;
    const verdict = String(r.verdict ?? '').trim().toLowerCase();

    if (!verdict) { unverified.push(n); continue; }
    if (!VALID_VERDICTS.has(verdict)) {
      problems.push(`row ${n}: verdict ${JSON.stringify(verdict)} is not ok/off/unsure`);
      continue;
    }

    const gLat = num(r.geocoded_lat);
    const gLng = num(r.geocoded_lng);
    const tLat = num(r.true_lat);
    const tLng = num(r.true_lng);
    const cause = String(r.cause ?? '').trim().toLowerCase();

    let distance = null;
    if (tLat !== null && tLng !== null) {
      distance = distanceMetres(gLat, gLng, tLat, tLng);
    }

    if (verdict === 'ok') {
      evaluated.push({ n, verdict, within: true, distance, cause: null, row: r });
      continue;
    }

    // off / unsure both require a measured true position.
    if (distance === null) {
      problems.push(`row ${n}: verdict "${verdict}" needs true_lat/true_lng to measure the distance`);
      continue;
    }
    if (!cause) {
      problems.push(`row ${n}: verdict "${verdict}" needs a cause`);
      continue;
    }
    if (!VALID_CAUSES.has(cause)) {
      problems.push(`row ${n}: cause ${JSON.stringify(cause)} is not in the taxonomy`);
      continue;
    }

    evaluated.push({
      n, verdict, distance, cause, row: r,
      within: distance <= THRESHOLD_DISTANCE_M,
    });
  }

  return {
    problems, unverified, evaluated, total: rows.length,
    drift: measureDrift(rows.map((r) => r.establishment_id).filter(Boolean)),
  };
}

const { measureDrift, MAX_DRIFT_PCT } = require('./gate-drift');

const NL = String.fromCharCode(10);

function report(result) {
  const { problems, unverified, evaluated, total } = result;
  const out = [];

  out.push(`AC-E2-GATE — ${total}-row sample, threshold >=${THRESHOLD_WITHIN} within ${THRESHOLD_DISTANCE_M} m`);
  out.push('');

  // DEC-016. Printed before anything else, and printed even when the run is
  // incomplete: the population a gate measured is part of the result, not a
  // footnote to it.
  const drift = result.drift;
  if (drift) {
    out.push(`  population  county ${drift.county} · drawn ${drift.drawnSize} (${drift.drawnFingerprint}) · now ${drift.nowSize} (${drift.nowFingerprint})`);
    if (drift.pct !== null) {
      out.push(`  drift       ${drift.grew >= 0 ? '+' : ''}${drift.grew} (${drift.pct.toFixed(2)}%) since ${String(drift.drawnAt).slice(0, 10)} — bound is ${MAX_DRIFT_PCT}%`);
    }
    if (drift.gone.length) {
      out.push(`  MISSING     ${drift.gone.length} sampled establishment(s) are no longer in the population`);
    }
    out.push('');
  } else {
    // Scoring still works from the worksheet alone — but a verdict that cannot
    // name the population it measured must say so, or it reads as a stronger
    // claim than it is.
    out.push('  population  NOT CHECKED — the database could not be read.');
    out.push('              Drift against the drawn population is unknown for this run.');
    out.push('');
  }

  if (problems.length) {
    out.push(`  ${problems.length} worksheet problem(s):`);
    for (const p of problems.slice(0, 20)) out.push(`    - ${p}`);
    if (problems.length > 20) out.push(`    … and ${problems.length - 20} more`);
    out.push('');
  }

  if (unverified.length) {
    out.push(`  VERIFICATION INCOMPLETE — ${unverified.length} of ${total} rows have no verdict.`);
    out.push(`  verified so far: ${evaluated.length}/${total}`);
    out.push(`  rows outstanding: ${unverified.slice(0, 25).join(', ')}${unverified.length > 25 ? ', …' : ''}`);
    out.push('');
    out.push('  No gate verdict is issued while rows are unverified. A blank row is not a pass.');
    return { text: out.join('\n'), complete: false, pass: null };
  }

  if (problems.length) {
    out.push('  No gate verdict is issued while the worksheet has problems.');
    return { text: out.join('\n'), complete: false, pass: null };
  }

  if (drift && !drift.withinBound) {
    out.push(`  POPULATION MOVED TOO FAR — ${drift.pct.toFixed(2)}% drift exceeds the ${MAX_DRIFT_PCT}% bound.`);
    out.push('  The sample no longer represents what is displayed. Redraw before the next');
    out.push('  release assessment. Establishments that join between draws are the ones that');
    out.push('  were hard to place, so leaving them out flatters the result (DEC-016).');
    return { text: out.join(NL), complete: false, pass: null };
  }

  if (drift && drift.gone.length) {
    out.push(`  SAMPLED ROWS HAVE LEFT THE POPULATION — ${drift.gone.length} of ${total}.`);
    out.push('  A verdict on establishments the product no longer displays is not a verdict');
    out.push('  on the product. Redraw.');
    return { text: out.join(NL), complete: false, pass: null };
  }

  const within = evaluated.filter((e) => e.within);
  const failures = evaluated.filter((e) => !e.within);
  const pass = within.length >= THRESHOLD_WITHIN;

  out.push(`  within ${THRESHOLD_DISTANCE_M} m : ${within.length}/${total}`);
  out.push(`  beyond            : ${failures.length}/${total}`);

  const measured = evaluated.filter((e) => e.distance !== null).map((e) => e.distance).sort((a, b) => a - b);
  if (measured.length) {
    const median = measured[Math.floor(measured.length / 2)];
    out.push(`  measured offsets  : n=${measured.length}, median ${median.toFixed(1)} m, max ${measured[measured.length - 1].toFixed(1)} m`);
  }

  // A human said "wrong building" but the point is still inside the threshold.
  const disagreements = evaluated.filter((e) => e.verdict !== 'ok' && e.within);
  if (disagreements.length) {
    out.push('');
    out.push(`  ${disagreements.length} row(s) judged wrong-building but measured within ${THRESHOLD_DISTANCE_M} m —`);
    out.push('  counted as within, since the rule is distance. Worth reading before remediation:');
    for (const d of disagreements) out.push(`    row ${d.n}: ${d.distance.toFixed(1)} m, ${d.cause}`);
  }

  if (failures.length) {
    out.push('');
    out.push('  failures by cause:');
    const byCause = new Map();
    for (const f of failures) byCause.set(f.cause, [...(byCause.get(f.cause) || []), f]);
    for (const [cause, list] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const dists = list.map((f) => f.distance);
      const median = dists.slice().sort((a, b) => a - b)[Math.floor(dists.length / 2)];
      out.push(`    ${String(list.length).padStart(3)}  ${cause.padEnd(21)} median ${median.toFixed(0)} m  rows ${list.map((f) => f.n).join(', ')}`);
    }
  }

  out.push('');
  out.push(pass
    ? `  GATE PASS — ${within.length}/${total} within ${THRESHOLD_DISTANCE_M} m, threshold is ${THRESHOLD_WITHIN}.`
    : `  GATE FAIL — ${within.length}/${total} within ${THRESHOLD_DISTANCE_M} m, threshold is ${THRESHOLD_WITHIN}. ` +
      `Per the charter, v1.0 does not launch on this result; the cause distribution above directs remediation.`);

  return { text: out.join('\n'), complete: true, pass, within: within.length, failures, total };
}

function record(result, rendered) {
  if (!rendered.complete) {
    console.error('\nrefusing to record: verification is incomplete.');
    process.exit(1);
  }
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const doc = fs.readFileSync(DOC_PATH, 'utf8')
    .replace(
      /\*\*Status: sample drawn, verification NOT started\.\*\*/,
      `**Status: ${rendered.pass ? 'PASS' : 'FAIL'} — ${rendered.within}/${rendered.total} within ${THRESHOLD_DISTANCE_M} m, scored ${at}.**`,
    );
  fs.writeFileSync(DOC_PATH, `${doc.trimEnd()}\n\n## Result — ${at}\n\n\`\`\`\n${rendered.text}\n\`\`\`\n`);
  console.log(`\nrecorded -> ${path.relative(ROOT, DOC_PATH)}`);
}

/**
 * Every county's gate at once — DEC-015 makes this a per-county bar, and
 * tracking three of them one command at a time is how one quietly gets
 * forgotten. Runs the scorer per county in a child process so each reads its
 * own worksheet, its own draw history, and its own population.
 */
function reportAll() {
  const { execFileSync } = require('node:child_process');
  const { DISPLAYED_COUNTIES, countyName } = require('../src/display');

  const lines = ['AC-E2-GATE — all counties', ''];
  let allPassed = true;

  for (const county of DISPLAYED_COUNTIES) {
    let text = '';
    let passed = false;
    try {
      text = execFileSync(process.execPath, [__filename], {
        env: { ...process.env, SAFE_EATS_GATE_COUNTY: county },
        encoding: 'utf8',
      });
      passed = true;
    } catch (err) {
      // A non-zero exit is the normal state for an unfinished gate, so the
      // output still has to be read rather than treated as a crash.
      text = err.stdout || String(err.message);
    }

    const outstanding = /(\d+) of (\d+) rows have no verdict/.exec(text);
    const verified = /verified so far: (\d+)\/(\d+)/.exec(text);
    const drift = /drift\s+([+-]?\d+) \(([\d.]+)%\)/.exec(text);
    const within = /within 50 m\s*: (\d+)\/(\d+)/.exec(text);
    const noSheet = /No worksheet at/.test(text);

    let status;
    if (noSheet) status = 'NOT DRAWN';
    else if (within) status = `${passed ? 'PASS' : 'FAIL'} — ${within[1]}/${within[2]} within 50 m`;
    else if (outstanding) status = `${Number(outstanding[2]) - Number(outstanding[1])}/${outstanding[2]} verified`;
    else status = 'no verdict';

    allPassed = allPassed && passed && Boolean(within);

    lines.push(
      `  ${countyName(county).padEnd(12)} ${status.padEnd(30)}` +
        (drift ? `drift ${drift[1]} (${drift[2]}%)` : '')
    );
  }

  lines.push('');
  lines.push(
    allPassed
      ? '  All counties pass. Each may carry an accuracy claim of its own.'
      : '  Not every county has a passing gate. A county without one is displayed on the\n' +
        "  strength of another county's method, not on a measurement of its own."
  );

  console.log(lines.join('\n'));
  process.exitCode = allPassed ? 0 : 1;
}

function main() {
  if (process.argv.includes('--all')) return reportAll();

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`No worksheet at ${path.relative(ROOT, CSV_PATH)} — run scripts/draw-sample.js first.`);
    process.exit(1);
  }
  const result = score(loadRows());
  const rendered = report(result);
  console.log(rendered.text);

  if (process.argv.includes('--record')) record(result, rendered);

  // Exit non-zero unless the gate has been scored and passed.
  process.exit(rendered.complete && rendered.pass ? 0 : 1);
}

if (require.main === module) main();

module.exports = { distanceMetres, score, report, THRESHOLD_WITHIN, THRESHOLD_DISTANCE_M };
