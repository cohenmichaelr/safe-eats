'use strict';

/**
 * Basemap canary — D-015.
 *
 * On 2 Sep 2026 CARTO began serving unregistered traffic a tile with
 * "API KEY REQUIRED" watermarked across it. The response was:
 *
 *   HTTP 200 · image/png · 7,915 bytes · valid PNG · correct map geometry
 *
 * Status, content type, size and decodability all passed. The map was visibly
 * broken for every user and nothing in this repository could have told us. It
 * was found by a person looking at the screen.
 *
 * `scripts/verify-sources.js` watches the DBPR extracts because those are the
 * data. This watches the basemap, because a map with no basemap is just as
 * broken as a map with no pins — and it fails in a way that no status-code
 * assertion can see.
 *
 * WHAT THIS CAN AND CANNOT DO
 *
 * It cannot read a watermark. What it can do is notice that the bytes changed:
 * a tile for a fixed z/x/y is stable (verified — three consecutive fetches of
 * the pinned tile returned identical sha256), so a change means the provider
 * re-rendered, restyled, or defaced it. Any of those deserves thirty seconds of
 * human attention.
 *
 * So the check has two tiers, and the distinction is the point:
 *
 *   FAIL   the tile is definitely not a usable map tile — wrong status, a
 *          redirect, HTML, not an image, or implausibly small. Machine-decidable.
 *   LOOK   the tile is a valid image whose bytes no longer match the reference.
 *          NOT machine-decidable. The tile is written to disk and a human is
 *          asked to open it. This is the tier that catches a watermark.
 *
 * Pinning a reference is therefore a deliberate act with a human in it:
 *
 *   node scripts/check-basemap.js --pin     fetch, save, and record — after you look
 *   node scripts/check-basemap.js           verify against the pinned reference
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REFERENCE_PATH = path.join(ROOT, 'docs', 'basemap-reference.json');

/**
 * The reference image lives in docs/ and is committed; the tiles a failing run
 * writes out live in data/ and are not. The distinction matters: a pinned sha256
 * on its own is unfalsifiable — nobody can tell later whether it was taken from
 * a clean tile or from a defaced one. The committed image is what makes the
 * pin auditable by a person, which is the only thing that catches a watermark.
 */
const REFERENCE_IMAGE = path.join(ROOT, 'docs', 'basemap-reference.jpg');
const ARTIFACT_DIR = path.join(ROOT, 'data', 'basemap');

/**
 * One tile over central Palm Beach at a zoom the product actually uses. A canary,
 * not a survey: if the provider has changed its terms or its styling, it has not
 * done so for this tile alone.
 */
const DEFAULT_REFERENCE = {
  provider: 'Esri World Street Map',
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/12/1731/1130',
  note: 'Central Palm Beach, zoom 12. See DEC-013 for why this check exists.',
  minBytes: 2000,
  sha256: null,
  bytes: null,
  capturedAt: null,
};

const PASS = (m, d) => console.log(`   PASS  ${m}${d ? ` — ${d}` : ''}`);
const FAIL = (m, d) => console.log(`   FAIL  ${m}${d ? ` — ${d}` : ''}`);
const LOOK = (m, d) => console.log(`   LOOK  ${m}${d ? ` — ${d}` : ''}`);

function readReference() {
  if (!fs.existsSync(REFERENCE_PATH)) return { ...DEFAULT_REFERENCE };
  return { ...DEFAULT_REFERENCE, ...JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8')) };
}

/** Magic bytes. A PNG or JPEG says so in its first few bytes, whatever the header claims. */
function imageKind(buf) {
  if (buf.length >= 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png';
  if (buf.length >= 3 && buf.toString('hex', 0, 3) === 'ffd8ff') return 'jpeg';
  return null;
}

async function fetchTile(url) {
  const started = Date.now();

  // An explicit controller rather than AbortSignal.timeout: that leaves a live
  // timer behind, and exiting through process.exit() while it is pending aborts
  // the process with a libuv assertion on Windows instead of the exit code the
  // caller is meant to read. This check exists to be run by a scheduler, so its
  // exit code is the whole product.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      res,
      buf,
      ms: Date.now() - started,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Everything a machine can decide on its own. Returns a list of failures. */
function hardChecks(ref, { res, buf, ms }) {
  const failures = [];
  const check = (ok, label, detail) => {
    (ok ? PASS : FAIL)(label, detail);
    if (!ok) failures.push(label);
  };

  check(res.status === 200, 'HTTP 200', `${res.status} in ${ms} ms`);
  check(res.url === ref.url, 'no redirect', res.url === ref.url ? 'served from the pinned URL' : `redirected to ${res.url}`);

  const type = (res.headers.get('content-type') || '').toLowerCase();
  check(type.startsWith('image/'), 'image content type', type || '(none)');

  const kind = imageKind(buf);
  check(kind !== null, 'image signature', kind ? `${kind}, ${buf.length.toLocaleString()} bytes` : `not an image — first bytes ${JSON.stringify(buf.toString('utf8', 0, 40))}`);

  check(buf.length >= ref.minBytes, 'size floor', `${buf.length.toLocaleString()} bytes >= ${ref.minBytes.toLocaleString()}`);

  return failures;
}

function saveArtifact(buf, label) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const ext = imageKind(buf) === 'png' ? 'png' : 'jpg';
  const file = path.join(ARTIFACT_DIR, `${label}-${new Date().toISOString().slice(0, 10)}.${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}

async function pin() {
  const ref = readReference();
  console.log(`\nBasemap reference — ${ref.provider}\n${ref.url}\n`);

  const got = await fetchTile(ref.url);
  const failures = hardChecks(ref, got);
  if (failures.length) {
    console.error(`\nRefusing to pin a tile that fails ${failures.length} basic check(s).\n`);
    process.exitCode = 1;
    return;
  }

  // Committed alongside its hash, so the pin can be audited by eye later.
  const ext = imageKind(got.buf) === 'png' ? '.png' : '.jpg';
  const file = REFERENCE_IMAGE.replace(/\.jpg$/, ext);
  fs.writeFileSync(file, got.buf);

  const next = {
    ...ref,
    image: path.basename(file),
    sha256: got.sha256,
    bytes: got.buf.length,
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REFERENCE_PATH, `${JSON.stringify(next, null, 2)}\n`);

  console.log(`\n  Saved  ${file}`);
  console.log(`  Pinned sha256 ${got.sha256.slice(0, 16)}… (${got.buf.length.toLocaleString()} bytes)\n`);
  console.log('  ⚠  OPEN THAT IMAGE BEFORE YOU TRUST THIS REFERENCE.');
  console.log('     A pinned tile is the definition of "correct" for every later run, so');
  console.log('     pinning a defaced tile teaches the check that defaced is normal —');
  console.log('     which is exactly how the CARTO watermark would have survived.\n');
}

async function check() {
  const ref = readReference();
  console.log(`\nBasemap canary — ${ref.provider}\n${ref.url}\n`);

  if (!ref.sha256) {
    console.error('  No reference pinned. Run: node scripts/check-basemap.js --pin\n');
    process.exitCode = 1;
    return;
  }

  let got;
  try {
    got = await fetchTile(ref.url);
  } catch (err) {
    FAIL('reachable', err.message);
    console.error('\nBasemap: FAIL — the tile could not be fetched.\n');
    process.exitCode = 1;
    return;
  }

  const failures = hardChecks(ref, got);

  if (failures.length) {
    const file = saveArtifact(got.buf, 'failed');
    console.error(`\nBasemap: FAIL — ${failures.join(', ')}`);
    console.error(`Response body saved to ${file}\n`);
    process.exitCode = 1;
    return;
  }

  if (got.sha256 === ref.sha256) {
    PASS('matches the pinned tile', `sha256 ${got.sha256.slice(0, 16)}…, pinned ${ref.capturedAt?.slice(0, 10)}`);
    console.log('\nBasemap: PASS\n');
    return;
  }

  // A valid image that is not the one we pinned. No assertion can tell a
  // restyle from a defacement, so this does not pretend to.
  const drift = ((got.buf.length - ref.bytes) / ref.bytes) * 100;
  const file = saveArtifact(got.buf, 'changed');

  LOOK('tile changed', `${got.sha256.slice(0, 16)}… vs pinned ${ref.sha256.slice(0, 16)}…`);
  LOOK('size', `${got.buf.length.toLocaleString()} bytes vs ${ref.bytes.toLocaleString()} (${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%)`);

  console.log(`\nBasemap: NEEDS A LOOK — the tile is a valid image but not the pinned one.`);
  console.log(`\n  Open ${file}`);
  console.log('\n  Is it a map of Palm Beach with no watermark, no "API KEY REQUIRED",');
  console.log('  and no provider notice stamped across it?');
  console.log('    yes → the provider restyled. Re-pin: node scripts/check-basemap.js --pin');
  console.log('    no  → the basemap is broken in production right now. See DEC-013.\n');

  // Exit 2, distinct from 1: a scheduled runner should raise this differently
  // from a hard outage, because it needs a person rather than a retry.
  // exitCode rather than exit(): process.exit() tears the process down while
  // fetch's socket is still open, which aborts with a libuv assertion on Windows
  // and loses the code entirely. Setting the code and returning lets the handles
  // drain, which is the difference between a scheduler reading "2" and reading
  // "crashed".
  process.exitCode = 2;
}

const argv = process.argv.slice(2);
(argv.includes('--pin') ? pin() : check()).catch((err) => {
  console.error(`\ncheck-basemap failed: ${err.message}\n`);
  process.exitCode = 1;
  return;
});
