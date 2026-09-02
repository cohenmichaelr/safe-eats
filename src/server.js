'use strict';

/**
 * Read API — MVP-SE-001 §6 tasks 7 and 8 · FR-401, FR-402, FR-403, E5.
 *
 * Two routes. Both touch SQLite and nothing else: no Google Places, no
 * Puppeteer, no scraping, no network of any kind on the request path
 * (CLAUDE.md invariant 5). That is not an optimisation, it is the whole reason
 * v2 answers in milliseconds where v1 issued an N+1 fan-out of Places calls per
 * viewport (AUD F6) and then guessed which result was which (AUD F5).
 *
 * The displayed set is drawn solely from our own database (FR-403); the
 * definition of "displayed" is `src/display.js`, shared with the accuracy gate.
 */

const express = require('express');
const path = require('node:path');

const { open, dataAsOf } = require('./db');
const { displayedPredicate } = require('./display');
const {
  establishmentSignal,
  SIGNAL_DISPLAY,
  DISPOSITION_MAP,
  STALE_AFTER_MONTHS,
  isKnownDisposition,
} = require('./signal');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Leaflet and markercluster are served from node_modules rather than a CDN
 * (DEC-008 names the libraries but not their delivery). A CDN script tag is a
 * third party that can change what the page executes; the tiles are images and
 * carry no such risk, which is why they stay remote and the code does not.
 */
const VENDOR = {
  '/vendor/leaflet': path.dirname(require.resolve('leaflet/dist/leaflet.js')),
  '/vendor/markercluster': path.dirname(require.resolve('leaflet.markercluster/dist/leaflet.markercluster.js')),
};

/**
 * Viewport cap.
 *
 * The default must exceed the entire displayable universe, or the default
 * request is the failure this cap exists to prevent. Measured: 3,618 geocoded
 * type-2010 establishments in county 60, of which 3,530 fall inside the
 * county bbox the tests use. At the previous default of 1,500 an unqualified
 * county-wide request returned 42% of the restaurants and a `truncated` flag —
 * a map that quietly drops pins is a map that tells a diner a restaurant does
 * not exist, which is the one thing this product must never do.
 *
 * 4,000 clears the whole county with headroom. The cap now only bites on a
 * hand-typed bbox spanning the hemisphere, which is what it was for. MAX_LIMIT
 * leaves room for the county expansion in OPEN-3.
 */
const DEFAULT_LIMIT = 4000;
const MAX_LIMIT = 10000;

/* ----------------------------------------------------------- statements ---- */

/**
 * "Most recent inspection" is the visit, not the case. A case (Inspection
 * Number) carries several visits and it is the LAST one that holds the outcome —
 * "Extension given, pending" on visit 2, "Complied" on visit 3. Ordering by date
 * then visit number picks the outcome; ordering by case id picks a coin flip.
 *
 * The join is on license_key rather than establishment_id because the inspection
 * extract publishes no address, so two suites sharing a licence number share
 * their inspection history (DEC-006). That is the source's ambiguity, not ours;
 * inventing a split would be the invention AUD F5 punished.
 */
const LATEST_VISIT = `
  SELECT inspection_visit_id FROM inspection x
   WHERE x.license_key = e.license_key
   ORDER BY x.inspection_date DESC, x.visit_number DESC
   LIMIT 1`;

function prepareStatements(db) {
  const displayed = displayedPredicate('e');

  return {
    displayedParams: displayed.params,

    /**
     * Bounding box via the R*Tree from migration 003. Points are stored as
     * degenerate boxes (min = max), so this is four range comparisons on the
     * index rather than a scan of every row's lat/lng.
     *
     * The predicate is the OVERLAP form, not the containment form the migration
     * comment sketches. R*Tree coordinates are 32-bit floats, and SQLite
     * deliberately rounds each stored `min` down and each `max` up so that
     * overlap queries never miss a row. Containment (`min >= west AND max <=
     * east`) runs against that rounding: a pin whose true longitude sits on the
     * viewport edge can have its stored max nudged just outside and vanish.
     * The error is under a metre, so it only touches pins exactly on the
     * boundary — but the failure mode is a disappearing restaurant, and the
     * correct predicate costs nothing.
     */
    inBbox: db.prepare(`
      SELECT e.establishment_id, e.name, e.address, e.city, e.zip,
             e.lat, e.lng, e.geocode_quality,
             i.inspection_date, i.disposition, i.signal AS raw_signal,
             i.total_violations, i.high_violations
        FROM establishment_rtree r
        JOIN establishment e ON e.rowid = r.id
   LEFT JOIN inspection i ON i.inspection_visit_id = (${LATEST_VISIT})
       WHERE r.max_lng >= ? AND r.min_lng <= ?
         AND r.max_lat >= ? AND r.min_lat <= ?
         AND ${displayed.sql}
       ORDER BY e.establishment_id
       LIMIT ?`),

    byId: db.prepare(`
      SELECT e.establishment_id, e.license_key, e.license_number, e.name,
             e.address, e.city, e.zip, e.county_name, e.seats, e.risk_level,
             e.lat, e.lng, e.geocode_source, e.geocode_quality, e.last_seen_at
        FROM establishment e
       WHERE e.establishment_id = ? AND ${displayed.sql}`),

    /**
     * Full history, newest first. E5 asks for recent inspections; the extract
     * currently spans 51 days (D-005), so "all of them" is still a short list.
     */
    historyFor: db.prepare(`
      SELECT inspection_visit_id, inspection_number, inspection_date,
             inspection_class, inspection_type, disposition, signal, visit_number,
             total_violations, high_violations, intermediate_violations, basic_violations
        FROM inspection
       WHERE license_key = ?
       ORDER BY inspection_date DESC, visit_number DESC`),

    violationsFor: db.prepare(`
      SELECT violation_code, count
        FROM violation
       WHERE inspection_visit_id = ?
       ORDER BY violation_code`),

    /**
     * The start of the published window. After DEC-010 the extract is known to
     * be fiscal-year-to-date and accumulating, so this is a real boundary the
     * user needs: it is what "no recent inspection" actually means, and roughly
     * 70% of pins currently say it.
     */
    windowStart: db.prepare(`SELECT MIN(inspection_date) AS start FROM inspection`),

    /**
     * Coverage, for the methodology page (FR-601). Published as live counts
     * rather than as numbers typed into prose: a hand-written "98.9% geocoded"
     * is true on the day it is written and unfalsifiable afterwards, which is
     * the genre of claim this project exists to stop making.
     */
    coverage: db.prepare(`
      SELECT COUNT(*)                                                   AS displayed,
             SUM(CASE WHEN e.lat IS NOT NULL THEN 1 ELSE 0 END)         AS positioned,
             SUM(CASE WHEN EXISTS (
                   SELECT 1 FROM inspection i WHERE i.license_key = e.license_key
                 ) THEN 1 ELSE 0 END)                                   AS inspected
        FROM establishment e
       WHERE ${displayed.sql}`),
  };
}

/* -------------------------------------------------------------- parsing ---- */

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * `bbox=west,south,east,north` — the GeoJSON and Leaflet `toBBoxString()` order,
 * so the client can pass `map.getBounds().toBBoxString()` unmodified.
 */
function parseBbox(raw) {
  if (raw === undefined) throw new BadRequest('bbox is required, as bbox=west,south,east,north');

  const parts = String(raw).split(',');
  if (parts.length !== 4) {
    throw new BadRequest(
      `bbox needs 4 comma-separated numbers (west,south,east,north), got ${parts.length}`
    );
  }

  // Empty components must be rejected BEFORE Number(), which maps '' and ' ' to
  // 0 rather than NaN. `bbox=,26.3,-79.9,26.9` would otherwise parse as west = 0
  // and be served as a valid box straddling the prime meridian — a client bug
  // turned into a silently wrong viewport instead of a 400.
  if (parts.some((p) => p.trim() === '')) {
    throw new BadRequest('bbox values must all be numbers; one is empty');
  }

  const [west, south, east, north] = parts.map((p) => Number(p.trim()));
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new BadRequest('bbox values must all be numbers');
  }
  if (Math.abs(south) > 90 || Math.abs(north) > 90) throw new BadRequest('latitudes must be within +/-90');
  if (Math.abs(west) > 180 || Math.abs(east) > 180) throw new BadRequest('longitudes must be within +/-180');
  // No antimeridian wrap handling: the data is one Florida county. A west > east
  // box here is a client bug, and answering it with an empty set would hide that.
  if (west > east) throw new BadRequest('bbox west must not exceed east');
  if (south > north) throw new BadRequest('bbox south must not exceed north');

  return { west, south, east, north };
}

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new BadRequest('limit must be a positive integer');
  return Math.min(n, MAX_LIMIT);
}

/* ------------------------------------------------------------- shaping ----- */

/**
 * The signal shown for an establishment is its most recent visit's, aged out
 * after 24 months (src/signal.js). `inspection.signal` was derived at ingest from
 * a disposition that was known then; if a later ingest introduces an unmapped
 * one, ingest aborts before it reaches here. The `isKnownDisposition` probe is
 * the belt to that braces: a read path must not 500 because the state renamed a
 * disposition.
 */
function signalFor(row, now) {
  if (!row?.inspection_date) return 'unknown';
  if (!row.raw_signal && !isKnownDisposition(row.disposition)) return 'unknown';
  return establishmentSignal(
    { inspection_date: row.inspection_date, signal: row.raw_signal, disposition: row.disposition },
    now
  );
}

/**
 * Map payload — deliberately narrow. FR-402: proportional to the viewport, and a
 * pin needs a position, a name and a signal, not a licence record.
 */
function toPin(row, now) {
  return {
    id: row.establishment_id,
    name: row.name,
    address: row.address,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    signal: signalFor(row, now),
    last_inspection_date: row.inspection_date ?? null,
    total_violations: row.total_violations ?? null,
    high_violations: row.high_violations ?? null,
  };
}

/* ----------------------------------------------------------------- app ----- */

function createApp(db) {
  const q = prepareStatements(db);
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false);

  /**
   * GET /api/meta — the page's settings: the as-of date (FR-601), the signal
   * palette, and the window start.
   *
   * The palette is served rather than hardcoded in app.js so `src/signal.js`
   * stays the single definition of what amber means. A copy in the client is a
   * colour that drifts the first time the mapping changes and nobody remembers
   * there were two of them.
   */
  app.get('/api/meta', (req, res) => {
    // The disposition mapping is published, not just applied. FR-601 asks the
    // product to be able to say how it reached its verdict, and the methodology
    // page renders this table rather than restating it in prose — a second
    // hand-maintained copy of the mapping would drift from the first.
    const dispositions = [...DISPOSITION_MAP.entries()].map(([disposition, signal]) => ({
      disposition,
      signal,
    }));

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      as_of: dataAsOf(db),
      inspection_window_start: q.windowStart.get()?.start ?? null,
      signals: SIGNAL_DISPLAY,
      dispositions,
      stale_after_months: STALE_AFTER_MONTHS,
      coverage: q.coverage.get(...q.displayedParams),
      attribution: {
        data: 'Florida Department of Business & Professional Regulation',
        basemap: '© OpenStreetMap contributors, © CARTO',
      },
    });
  });

  /** GET /api/establishments?bbox=w,s,e,n[&limit=n] — FR-401. */
  app.get('/api/establishments', (req, res) => {
    const { west, south, east, north } = parseBbox(req.query.bbox);
    const limit = parseLimit(req.query.limit);

    // One more than asked, so truncation is detected without a second COUNT.
    const rows = q.inBbox.all(west, east, south, north, ...q.displayedParams, limit + 1);
    const truncated = rows.length > limit;
    const now = new Date();

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      as_of: dataAsOf(db),
      count: truncated ? limit : rows.length,
      truncated,
      bbox: { west, south, east, north },
      establishments: rows.slice(0, limit).map((row) => toPin(row, now)),
    });
  });

  /**
   * GET /api/establishments/:establishmentId — E5.
   *
   * Restricted to the displayed population for the same reason the map is: an id
   * that is not on the map has not been through the accuracy gate, so serving a
   * detail page for it would publish a coordinate the project has not verified.
   */
  app.get('/api/establishments/:establishmentId', (req, res) => {
    const est = q.byId.get(req.params.establishmentId, ...q.displayedParams);
    if (!est) return res.status(404).json({ error: 'No such establishment' });

    const now = new Date();
    const history = q.historyFor.all(est.license_key).map((visit) => ({
      visit_id: visit.inspection_visit_id,
      case_id: visit.inspection_number,
      date: visit.inspection_date,
      visit_number: visit.visit_number,
      class: visit.inspection_class,
      type: visit.inspection_type,
      disposition: visit.disposition,
      signal: visit.signal,
      // critical_violations / noncritical_violations are omitted: they are blank
      // in 100% of source rows, so the panel is built on the four that exist
      // (D-012). Returning nulls would invite a UI that renders "0 critical".
      violations: {
        total: visit.total_violations,
        high: visit.high_violations,
        intermediate: visit.intermediate_violations,
        basic: visit.basic_violations,
        codes: q.violationsFor.all(visit.inspection_visit_id),
      },
    }));

    const latest = history[0] ?? null;
    const signal = signalFor(
      latest && {
        inspection_date: latest.date,
        raw_signal: latest.signal,
        disposition: latest.disposition,
      },
      now
    );

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      as_of: dataAsOf(db),
      establishment: {
        id: est.establishment_id,
        name: est.name,
        address: est.address,
        city: est.city,
        zip: est.zip,
        county: est.county_name,
        license_number: est.license_number,
        seats: est.seats,
        risk_level: est.risk_level,
        lat: est.lat,
        lng: est.lng,
        geocode_source: est.geocode_source,
        geocode_quality: est.geocode_quality,
        signal,
        signal_display: SIGNAL_DISPLAY[signal],
      },
      inspections: history,
    });
  });

  // Static last, so a route always wins over a file of the same name.
  for (const [mount, dir] of Object.entries(VENDOR)) {
    app.use(mount, express.static(dir, { immutable: true, maxAge: '30d' }));
  }
  app.use(express.static(PUBLIC_DIR));

  // JSON errors on the API; anything else that falls through is a missing page.
  // An HTML error body from an API is how a client ends up parsing "<!DOCTYPE"
  // as data, which is the shape of the v1 failure itself.
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.status(404).type('text/plain').send('Not found');
  });

  app.use((err, req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
  });

  return app;
}

function main() {
  const db = open();
  const app = createApp(db);
  const port = Number(process.env.PORT) || 3000;

  const server = app.listen(port, () => {
    console.log(`safe-eats listening on http://localhost:${port}`);
    console.log(`data as of ${dataAsOf(db) ?? '(no successful ingest recorded)'}`);
  });

  // `server.close()` stops accepting connections but waits on established ones,
  // and a browser holds its keep-alive socket open — so Ctrl-C alone leaves the
  // process running until a second signal. Drop the idle sockets, then give the
  // in-flight ones a bounded moment. The timer is unref'd so it never keeps the
  // process alive by itself.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close(() => { db.close(); process.exit(0); });
      server.closeIdleConnections?.();
      setTimeout(() => { db.close(); process.exit(0); }, 3000).unref();
    });
  }
}

if (require.main === module) main();

module.exports = { createApp, parseBbox, parseLimit, DEFAULT_LIMIT, MAX_LIMIT };
