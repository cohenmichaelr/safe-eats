'use strict';

/**
 * D-005 — is the inspection extract a sliding window or an accumulating snapshot?
 *
 * The profile on 24 Aug 2026 found every one of the 1,305 loaded visits inside
 * 2026-07-01 → 2026-08-20, a 51-day window. That leaves 74% of displayable
 * establishments with no signal at all, which decides what the map mostly looks
 * like. One pull cannot tell the two explanations apart:
 *
 *   sliding      the state publishes a rolling recent-activity feed. History is
 *                accumulated by fetching often and never deleting. Old visits
 *                fall out of the extract; ours survive because ingest upserts.
 *   snapshot     the extract is a fiscal-year-to-date file that happens to be
 *                young. It will grow on its own, and the window's start date
 *                stays put.
 *
 * The test is a second observation. If the earliest date has moved forward and
 * the oldest visits we hold are gone from the file, it slides; if the start date
 * is unchanged and every held visit is still present, it accumulates.
 *
 * This script WRITES NOTHING. It opens the database read-only and holds the
 * fetched CSV in a temp file. That is deliberate: a real ingest would add and
 * drop establishments, and the AC-E2-GATE population fingerprint
 * (`da7b5b4397e4ceca`) is currently pinned to a sample awaiting hand
 * verification. Answering a question about history must not silently redraw it.
 *
 *   node scripts/probe-window.js [--save <path>]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const { open } = require('../src/db');
const { SOURCES, COUNTY_CODE, toIsoDate, licenseKey } = require('../src/ingest');
const { displayedPredicate } = require('../src/display');
const { assertValidExtract } = require('../src/validate');

const source = SOURCES.inspections;

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

async function fetchExtract() {
  const started = Date.now();
  const res = await fetch(source.url, { redirect: 'follow' });
  const body = Buffer.from(await res.arrayBuffer());

  console.log(`  HTTP ${res.status} · ${res.headers.get('content-type')} · ` +
              `${(body.length / 1024 / 1024).toFixed(2)} MB · ${Date.now() - started} ms`);
  console.log(`  final URL ${res.url}`);

  // Same gate the ingest applies. A probe that accepts a WordPress page and
  // reports "0 rows, window empty" would be v1's failure wearing a lab coat.
  assertValidExtract(body, {
    contentType: res.headers.get('content-type'),
    url: source.url,
    expectedColumns: source.expectedColumns,
  });

  return body;
}

async function main() {
  const saveFlag = process.argv.indexOf('--save');
  if (saveFlag >= 0 && !process.argv[saveFlag + 1]) {
    throw new Error('--save needs a path: node scripts/probe-window.js --save <path>');
  }
  console.log(`\nD-005 probe — ${source.url}\n`);

  const body = await fetchExtract();

  const savePath = saveFlag >= 0
    ? path.resolve(process.argv[saveFlag + 1])
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-probe-')), 'inspections.csv');
  fs.writeFileSync(savePath, body);
  console.log(`  saved to ${savePath}\n`);

  // Header names are trimmed, exactly as src/ingest.js parses them. The extract
  // ships several columns padded with a leading space (" License Number",
  // " License Type Code"), so `columns: true` yields keys that silently miss.
  const rows = parse(body, {
    columns: (header) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });
  const inCounty = rows.filter((r) => (r['County Number'] || '').trim() === COUNTY_CODE);

  /* ---- what the file says now ---------------------------------------- */

  const dated = inCounty
    .map((r) => ({ visit: (r['Inspection Visit ID'] || '').trim(), date: toIsoDate(r['Inspection Date']) }))
    .filter((r) => r.visit && r.date);

  if (dated.length === 0) {
    throw new Error(
      `Parsed ${rows.length} rows and ${inCounty.length} in county ${COUNTY_CODE}, but none carried a ` +
      `parseable Inspection Date. The date format or the column name has changed — refusing to report ` +
      `a window computed from nothing.`
    );
  }

  const dates = dated.map((r) => r.date).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  const spanDays = Math.round((Date.parse(latest) - Date.parse(earliest)) / 86400000) + 1;

  console.log(`file · ${rows.length} rows · ${inCounty.length} in county ${COUNTY_CODE} ` +
              `(${pct(inCounty.length, rows.length)}%) · ${dated.length} dated visits`);
  console.log(`window · ${earliest} → ${latest} · ${spanDays} days\n`);

  const byMonth = new Map();
  for (const d of dates) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + 1);
  console.log('by month');
  for (const [month, n] of [...byMonth].sort()) {
    console.log(`  ${month}  ${String(n).padStart(5)}  ${'#'.repeat(Math.round((n / dated.length) * 50))}`);
  }

  /* ---- what we already hold, and whether the file still has it -------- */

  const db = open({ readonly: true });
  const held = db.prepare(
    `SELECT inspection_visit_id AS visit, inspection_date AS date FROM inspection WHERE inspection_date IS NOT NULL`
  ).all();
  const heldAsOf = db.prepare(
    `SELECT finished_at FROM ingest_run WHERE status = 'success' AND dataset = ? ORDER BY finished_at DESC LIMIT 1`
  ).get(source.dataset)?.finished_at;

  // The denominator D-005 actually cares about: the establishments the map draws.
  const displayed = displayedPredicate('e');
  const displayedKeys = new Set(
    db.prepare(`SELECT DISTINCT e.license_key FROM establishment e WHERE ${displayed.sql}`)
      .all(...displayed.params)
      .map((r) => r.license_key)
  );
  db.close();

  const inFile = new Set(dated.map((r) => r.visit));
  const heldDates = held.map((r) => r.date).sort();
  const dropped = held.filter((r) => !inFile.has(r.visit));
  const added = dated.filter((r) => !held.some((h) => h.visit === r.visit)).length;

  console.log(`\nheld · ${held.length} visits · ${heldDates[0]} → ${heldDates[heldDates.length - 1]} ` +
              `· loaded ${heldAsOf ?? '(unknown)'}`);
  console.log(`file vs held · ${added} new · ${dropped.length} of ours no longer in the file ` +
              `(${pct(dropped.length, held.length)}%)`);

  if (dropped.length) {
    const droppedDates = dropped.map((r) => r.date).sort();
    console.log(`  dropped range · ${droppedDates[0]} → ${droppedDates[droppedDates.length - 1]}`);
  }

  /* ---- the reading ----------------------------------------------------- */

  const startMoved = earliest > heldDates[0];
  console.log('\n— reading —');
  if (held.length === 0) {
    // DEC-010 was decided on this script's output. With nothing loaded there is
    // nothing to compare against, and every test below reads as "unchanged": no
    // visits dropped, and no held start date for the file's to have moved past.
    // That prints ACCUMULATING — a decision-grade verdict drawn from no evidence.
    console.log('  NO READING. The database holds no inspections, so there is nothing to');
    console.log('  compare this file against. Run `npm run ingest` first, then probe again');
    console.log('  once enough days have passed for the window to have moved if it moves.');
  } else if (dropped.length === 0 && !startMoved) {
    console.log('  ACCUMULATING. The start date has not moved and nothing we hold has fallen');
    console.log('  out. The extract grows on its own; history arrives by waiting, and the');
    console.log('  24-month horizon in src/signal.js becomes reachable in time.');
  } else if (dropped.length > 0 && startMoved) {
    console.log(`  SLIDING. The window start moved ${heldDates[0]} → ${earliest} and ` +
                `${dropped.length} visits we hold are gone from the file.`);
    console.log('  History exists only because ingest upserts and never deletes. Depth is a');
    console.log('  function of how long the schedule has been running, so the weekly job (task');
    console.log('  12) is not just freshness — it IS the history, and a missed week is a');
    console.log('  permanent hole.');
  } else {
    console.log(`  MIXED — start moved: ${startMoved}, dropped: ${dropped.length}.`);
    console.log('  Not a clean answer. Record the observation and probe again rather than');
    console.log('  deciding D-005 from an ambiguous reading.');
  }

  /* ---- what it means for the map --------------------------------------- */

  // Built with ingest's own licenseKey(), not by hand. The two extracts disagree
  // about the licence number — bare here, prefixed "SEA…" in the licence file —
  // and a local copy of that reconciliation would silently report 0% coverage,
  // rather than failing, if DBPR ever prefixed this file too.
  const keyed = new Set(
    inCounty
      .map((r) => licenseKey(r['License Number'], r['License Type Code']))
      // A blank licence number yields "|2010", which is not an establishment.
      .filter((k) => !k.startsWith('|'))
  );

  const covered = displayedKeys ? [...keyed].filter((k) => displayedKeys.has(k)).length : null;
  const elapsedDays = Math.round((Date.parse(latest) - Date.parse(earliest)) / 86400000) + 1;

  console.log(`\n— coverage —`);
  console.log(`  establishments with ≥1 visit in this file: ${keyed.size}`);
  if (covered !== null) {
    console.log(`  of the ${displayedKeys.size} displayed (county 60 · type 2010): ` +
                `${covered} (${pct(covered, displayedKeys.size)}%) — the rest render as ` +
                `"no recent inspection"`);
    // Straight-line and therefore optimistic: the establishments not yet visited
    // are not a uniform random remainder. Quoted as an order of magnitude, not a
    // forecast — the point is whether waiting is a plausible strategy at all.
    const perDay = covered / elapsedDays;
    const daysToFull = perDay > 0 ? Math.round((displayedKeys.size - covered) / perDay) : Infinity;
    console.log(`  rate ≈ ${perDay.toFixed(1)} newly-covered establishments/day over ${elapsedDays} days;`);
    console.log(`  at that rate the remainder takes ~${daysToFull} more days (straight-line, optimistic)`);
  }

  console.log('\nNothing was written. safe-eats.db is unchanged.\n');
}

main().catch((err) => {
  console.error(`\nprobe failed: ${err.message}\n`);
  process.exit(1);
});
