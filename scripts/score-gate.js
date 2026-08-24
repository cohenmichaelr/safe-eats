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
const CSV_PATH = path.join(ROOT, 'docs', '07-accuracy-sample.csv');
const DOC_PATH = path.join(ROOT, 'docs', '07-accuracy-gate.md');

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

  return { problems, unverified, evaluated, total: rows.length };
}

function report(result) {
  const { problems, unverified, evaluated, total } = result;
  const out = [];

  out.push(`AC-E2-GATE — ${total}-row sample, threshold >=${THRESHOLD_WITHIN} within ${THRESHOLD_DISTANCE_M} m`);
  out.push('');

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

function main() {
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

module.exports = { distanceMetres, score, THRESHOLD_WITHIN, THRESHOLD_DISTANCE_M };
