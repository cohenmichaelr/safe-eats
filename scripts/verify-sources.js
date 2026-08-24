'use strict';

/**
 * Gate 0 — source reachability and shape verification (charter assumption A1).
 *
 * Fetches each documented DBPR extract and asserts, in order:
 *
 *   1. HTTP 200
 *   2. a non-HTML content type
 *   3. the first bytes are not a document declaration
 *   4. the full column header matches docs/source-layouts.json
 *   5. the District 2 extract carries rows with county code 60
 *   6. the county-60 row count is recorded
 *
 * Steps 2 and 3 are separate on purpose. v1 died because a redirect served the
 * MyFloridaLicense WordPress homepage; a marketing page can carry almost any
 * content-type header, so the first-bytes check is the one that actually caught
 * it (AUD F1/F2). Reuses src/validate.js so this script and the ingest agree by
 * construction rather than by resemblance.
 *
 *   node scripts/verify-sources.js            report only
 *   node scripts/verify-sources.js --record   also update docs/06-source-verification.md
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  IngestError, assertNotHtml, assertCsvContentType, assertMinimumBytes,
} = require('../src/validate');

const ROOT = path.join(__dirname, '..');
const LAYOUTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'source-layouts.json'), 'utf8'));
const RECORD_PATH = path.join(ROOT, 'docs', '06-source-verification.md');

const COUNTY_CODE = process.env.SAFE_EATS_COUNTY_CODE || '60';
const TIMEOUT_MS = 60_000;

/** The column that carries the county code differs between the two extracts. */
const COUNTY_COLUMN = {
  licenses: 'Location County Code',
  inspections: 'County Number',
};

/** Minimum bytes below which the payload cannot be a real extract. */
const MIN_BYTES = { licenses: 1_000_000, inspections: 500_000 };

function parseCsv(buffer) {
  const { parse } = require('csv-parse/sync');
  return parse(buffer, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
}

function headerOf(buffer) {
  const { parse } = require('csv-parse/sync');
  const [row] = parse(buffer, { columns: false, bom: true, to_line: 1 });
  return row;
}

/** Compare a live header against the pinned reference, positionally. */
function diffLayout(live, reference) {
  const problems = [];
  if (live.length !== reference.length) {
    problems.push(`column count ${live.length}, expected ${reference.length}`);
  }
  const n = Math.max(live.length, reference.length);
  for (let i = 0; i < n; i += 1) {
    if (live[i] !== reference[i]) {
      problems.push(`position ${i}: ${JSON.stringify(live[i])} != ${JSON.stringify(reference[i])}`);
    }
  }
  return problems;
}

async function fetchExtract(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/csv,*/*' },
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      finalUrl: res.url,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      lastModified: res.headers.get('last-modified'),
      bytes: buffer.length,
      elapsedMs: Date.now() - startedAt,
      buffer,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verify(key, at) {
  const { url, columns: reference } = LAYOUTS[key];
  const result = { key, url, checks: [], ok: true };

  const ok = (label, detail) => result.checks.push({ label, pass: true, detail });
  const bad = (label, detail) => { result.checks.push({ label, pass: false, detail }); result.ok = false; };

  let res;
  try {
    res = await fetchExtract(url);
  } catch (err) {
    bad('fetch', `${err.name}: ${err.message}`);
    return result;
  }

  Object.assign(result, {
    status: res.status, finalUrl: res.finalUrl, contentType: res.contentType,
    bytes: res.bytes, lastModified: res.lastModified, elapsedMs: res.elapsedMs,
  });

  // 1 — HTTP 200
  if (res.status === 200) ok('HTTP 200', `${res.status} in ${res.elapsedMs} ms`);
  else bad('HTTP 200', `received ${res.status}`);

  if (res.finalUrl && res.finalUrl !== url) {
    bad('no redirect', `redirected to ${res.finalUrl}`);
  } else {
    ok('no redirect', 'served from the documented URL');
  }

  // 3 — first bytes are not a document declaration (before the header check,
  //     because an HTML body would otherwise fail as a confusing layout diff)
  const head = res.buffer.toString('utf8', 0, 120).replace(/\r?\n/g, ' ');
  try {
    assertNotHtml(res.buffer, { url });
    ok('not a document declaration', JSON.stringify(head.slice(0, 60)));
  } catch (err) {
    bad('not a document declaration', err.message);
    return result; // nothing below this is meaningful on an HTML body
  }

  // 2 — non-HTML content type
  try {
    assertCsvContentType(res.contentType, { url });
    ok('non-HTML content type', res.contentType);
  } catch (err) {
    bad('non-HTML content type', err.message);
  }

  try {
    assertMinimumBytes(res.buffer, MIN_BYTES[key], { url });
    ok('size floor', `${res.bytes.toLocaleString()} bytes >= ${MIN_BYTES[key].toLocaleString()}`);
  } catch (err) {
    bad('size floor', err.message);
  }

  // 4 — full column header matches the published layout
  let live;
  try {
    live = headerOf(res.buffer);
    const problems = diffLayout(live, reference);
    if (problems.length === 0) ok('column header', `${live.length} columns, exact match`);
    else bad('column header', problems.slice(0, 6).join('; '));
  } catch (err) {
    bad('column header', err.message);
    return result;
  }

  // 5 / 6 — county-60 rows present, and counted
  let rows;
  try {
    rows = parseCsv(res.buffer);
  } catch (err) {
    bad('parse', err.message);
    return result;
  }

  const column = COUNTY_COLUMN[key];
  const actual = live.find((c) => c.trim() === column);
  if (actual === undefined) {
    bad(`county column present`, `no column named ${JSON.stringify(column)}`);
    return result;
  }

  const countyRows = rows.filter((r) => String(r[actual] ?? '').trim() === COUNTY_CODE);
  result.totalRows = rows.length;
  result.countyRows = countyRows.length;
  result.countyColumn = actual;

  if (countyRows.length > 0) {
    ok(`county ${COUNTY_CODE} rows present`, `${countyRows.length.toLocaleString()} of ${rows.length.toLocaleString()}`);
  } else {
    bad(`county ${COUNTY_CODE} rows present`, `0 of ${rows.length} rows — Gate 0 fails`);
  }

  // Distinct establishments give the count a denominator that survives revisits.
  const licCol = live.find((c) => c.trim() === 'License Number');
  if (licCol) {
    result.countyDistinctLicenses = new Set(
      countyRows.map((r) => String(r[licCol] ?? '').trim()).filter(Boolean),
    ).size;
  }

  result.verifiedAt = at;
  return result;
}

function render(results, at) {
  const lines = [];
  for (const r of results) {
    lines.push('', `── ${r.key} ─ ${r.url}`);
    for (const c of r.checks) {
      lines.push(`   ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    if (r.countyRows !== undefined) {
      lines.push(
        `   county ${COUNTY_CODE}: ${r.countyRows.toLocaleString()} rows` +
        (r.countyDistinctLicenses !== undefined
          ? ` across ${r.countyDistinctLicenses.toLocaleString()} distinct licenses` : ''),
      );
    }
  }
  const failed = results.filter((r) => !r.ok);
  lines.push('', failed.length === 0
    ? `Gate 0: PASS — ${results.length}/${results.length} extracts verified at ${at}`
    : `Gate 0: FAIL — ${failed.map((r) => r.key).join(', ')}`);
  return lines.join('\n');
}

/** Append a dated row to the verification record so drift is visible over time. */
function record(results, at) {
  const header = [
    '# Source verification record',
    '',
    'Gate 0, charter assumption A1. Generated by `node scripts/verify-sources.js --record`.',
    'Each run appends a row; a changed column count or a collapsed county-60 count is',
    'the signal that the upstream extract has drifted.',
    '',
    '| Verified at (UTC) | Extract | HTTP | Content-Type | Bytes | Columns | Total rows | County 60 rows | Distinct licenses | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ].join('\n');

  const rows = results.map((r) => [
    at,
    r.key,
    r.status ?? '—',
    r.contentType ?? '—',
    r.bytes?.toLocaleString() ?? '—',
    r.checks.find((c) => c.label === 'column header')?.detail?.match(/^\d+/)?.[0] ?? '—',
    r.totalRows?.toLocaleString() ?? '—',
    r.countyRows?.toLocaleString() ?? '—',
    r.countyDistinctLicenses?.toLocaleString() ?? '—',
    r.ok ? 'PASS' : 'FAIL',
  ].join(' | ')).map((s) => `| ${s} |`).join('\n');

  let body;
  if (fs.existsSync(RECORD_PATH)) {
    body = `${fs.readFileSync(RECORD_PATH, 'utf8').trimEnd()}\n${rows}\n`;
  } else {
    body = `${header}\n${rows}\n`;
  }
  fs.writeFileSync(RECORD_PATH, body);
  console.log(`\nrecorded -> ${path.relative(ROOT, RECORD_PATH)}`);
}

async function main() {
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  console.log(`verify-sources: ${Object.keys(LAYOUTS).length} documented extracts, county code ${COUNTY_CODE}`);

  const results = [];
  for (const key of Object.keys(LAYOUTS)) {
    results.push(await verify(key, at));
  }

  console.log(render(results, at));
  if (process.argv.includes('--record')) record(results, at);

  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof IngestError ? err.message : err);
  process.exit(1);
});
