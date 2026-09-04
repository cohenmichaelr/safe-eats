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

/**
 * `.env` is loaded here for the same reason ingest.js and geocode.js load it:
 * the local run must see the same configuration the deployed one gets from its
 * host, so a variable set in the file cannot be read by the scripts and ignored
 * by the server. dotenv never overrides a variable already set, so Render's
 * environment still wins.
 */
require('dotenv').config();

const express = require('express');
const path = require('node:path');

const { open, dataAsOf } = require('./db');
const {
  displayedPredicate,
  COUNTIES,
  DISPLAYED_COUNTIES,
  countyName,
  licenseTypeName,
} = require('./display');
const { canonicalCity, spellingsFor, titleCase } = require('./cities');
const { createScheduler } = require('./scheduler');
const { createRefreshRunner } = require('./refresh-runner');
const { createGates } = require('./gates');
const { basemap } = require('./basemap');
const { seedGeocodeCache } = require('./seed');
const {
  establishmentSignal,
  SIGNAL_DISPLAY,
  DISPOSITION_MAP,
  STALE_AFTER_MONTHS,
  staleCutoff,
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
 * The default used to be chosen so that it exceeded the entire displayable
 * universe — 4,000 against county 60's 3,618 geocoded establishments — on the
 * reasoning that a map which quietly drops pins tells a diner a restaurant does
 * not exist, which is the one thing this product must never do.
 *
 * Statewide that is no longer possible: 54,296 displayable establishments will
 * not fit in a payload, and a cap that never bites cannot exist (DEC-017). So
 * the guarantee moves from "the cap never applies" to "the cap is scoped to
 * what you are looking at": the map queries a bounding box, and 4,000 comfortably
 * exceeds any viewport a person can read. `truncated` still travels in the
 * response, and the UI still says so rather than silently showing less.
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

/**
 * Punctuation-insensitive search text. Apostrophes and periods are dropped and
 * hyphens become spaces, so "wendys" matches "WENDY'S" and "chick fil a"
 * matches "CHICK-FIL-A". Restaurant names are full of punctuation that nobody
 * types into a search box.
 */
const STRIP = (expr) =>
  `UPPER(REPLACE(REPLACE(REPLACE(${expr}, CHAR(39), ''), '.', ''), '-', ' '))`;

const NORMALIZED = STRIP("e.name || ' ' || COALESCE(e.address, '') || ' ' || COALESCE(e.city, '')");
const NORMALIZED_NAME = STRIP('e.name');

function prepareStatements(db) {
  const displayed = displayedPredicate('e');

  return {
    displayedSql: displayed.sql,
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
      SELECT e.establishment_id, e.name, e.address, e.city, e.zip, e.county_code,
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
             e.address, e.city, e.zip, e.county_name, e.county_code, e.seats, e.risk_level,
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
     * Name, address and city search — FR-407.
     *
     * A normalised scan, NOT the FTS5 trigram index from migration 004. That
     * index cannot answer this query correctly, and the reason belongs where
     * the next person will look for it:
     *
     *   FTS5's trigram tokenizer indexes literal three-character sequences, so
     *   "wendys" cannot match "WENDY'S" — the apostrophe is IN the index.
     *   Measured against the loaded data, the trigram index returns 2 of the
     *   25 Wendy's; this predicate returns all 25, in 3.3 ms.
     *
     * Migration 004's own comment offers "wendys has to find WENDY'S" as its
     * motivating example, and the index does not do it. Its other example,
     * Starbucks, does not appear in Palm Beach's licence data at all.
     *
     * Stripping punctuation is what makes this work, and a scan is affordable
     * because the displayed population is 3,659 rows. If this ever covers the
     * whole state, the fix is a migration that feeds FTS5 the normalised text
     * rather than the raw name — not a cleverer scan.
     */
    /**
     * The city list, per county, for the cascading filter.
     *
     * Grouped on the canonical spelling rather than the raw one. The licence
     * data carries 61 distinct city strings for roughly 45 real places —
     * "ROYAL PLM BEACH" (11), "GREEN ACRES" (9), "BOYTON BEACH" (3),
     * "GEENACRES", "PLAM BEACH GARDENS". Listing those raw meant a reader
     * filtering Royal Palm Beach saw 106 establishments and silently missed 12,
     * which is a filter that looks like it worked.
     */
    cities: db.prepare(`
      SELECT e.county_code, e.city, COUNT(*) AS n
        FROM establishment e
       WHERE ${displayed.sql} AND e.city IS NOT NULL AND e.city <> ''
       GROUP BY e.county_code, e.city
       ORDER BY e.city`),

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
    // Raw is what DBPR published; label is the canonical spelling for display.
    // Both, because a typo on screen looks like our mistake, and silently
    // rewriting the source would be a different kind of mistake.
    city: row.city,
    city_label: titleCase(canonicalCity(row.city) ?? ''),
    county_code: row.county_code,
    county: countyName(row.county_code),
    lat: row.lat,
    lng: row.lng,
    signal: signalFor(row, now),
    last_inspection_date: row.inspection_date ?? null,
    total_violations: row.total_violations ?? null,
    high_violations: row.high_violations ?? null,
  };
}

/* ----------------------------------------------------------------- app ----- */

function createApp(db, { refreshRunner = createRefreshRunner(), gates = createGates() } = {}) {
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
      /*
       * Every county, with whether its pin positions have been verified
       * (DEC-017). The map shows all 67; only the counties whose 100-row
       * sample has been checked by hand against satellite imagery carry an
       * accuracy claim, and the UI says so on the rest rather than letting the
       * reader assume one county's verification covers another's addresses.
       */
      counties: DISPLAYED_COUNTIES.map((code) => ({
        code,
        name: countyName(code),
        verified: gates.verified(code),
        verified_at: gates.verifiedAt(code),
        gate_status: gates.statusOf(code),
        gate_score: gates.scoreOf(code),
      })),

      /*
       * The tile layer, composed server-side (D-014). The page used to hold the
       * provider URL, which meant changing provider was a front-end edit and the
       * licence question lived in a comment next to a hardcoded host. Now the
       * server says what to draw on, and `src/basemap.js` is the one place that
       * decides.
       */
      basemap: (() => {
        const config = basemap();
        return {
          url: config.url,
          attribution: config.attribution,
          max_zoom: config.maxZoom,
        };
      })(),

      attribution: {
        data: 'Florida Department of Business & Professional Regulation',
        basemap: basemap().attribution,
      },
    });
  });

  /**
   * GET /api/cities?county=NN — the city filter's options, one county at a time.
   *
   * These used to travel inside /api/meta. At three counties that was 149
   * entries; statewide it is 942, about 64 KB uncompressed on the first paint
   * of a map that is meant to be usable on a phone (FR-402). And it was always
   * 942 more than needed: the menu shows one county's cities, because South
   * Florida alone repeats its town names across county lines.
   *
   * Canonicalised, so the 12 establishments filed under ROYAL PLM BEACH are
   * counted under Royal Palm Beach rather than sitting in their own entry that
   * looks like a different town. See src/cities.js for why that map is written
   * by hand.
   */
  app.get('/api/cities', (req, res) => {
    const county = (req.query.county ?? '').toString().trim();
    if (county && !(county in COUNTIES)) {
      throw new BadRequest(`Not a displayed county: ${JSON.stringify(county)}`);
    }

    const counted = new Map();
    for (const row of q.cities.all(...q.displayedParams)) {
      if (county && row.county_code !== county) continue;
      const canonical = canonicalCity(row.city);
      if (!canonical) continue;
      counted.set(canonical, (counted.get(canonical) ?? 0) + row.n);
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      county,
      cities: [...counted.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        // Counts are per county, so summing a repeated name across counties
        // would report a total that matches no possible filter.
        .map(([city, n]) => ({ city, label: titleCase(city), n })),
    });
  });

  /**
   * GET /api/search?q=&city=&county=&signal=&limit= — FR-407.
   *
   * Three filters, and it is worth being explicit about what is NOT here:
   * there is no cuisine or category filter, because the DBPR licence extract
   * has no such column — none of its 35 fields describes what kind of food an
   * establishment serves. Searching "pizza" matches establishments with PIZZA
   * in their name, which is genuinely useful, but it is a name match and the UI
   * says so. Inferring cuisine from a name would be inventing a fact about a
   * named business, which is the same line DEC-011 draws over violation codes.
   *
   * WHY THE FILTERING MOVED INTO SQL (DEC-017)
   *
   * This used to select the whole displayed population and filter it in
   * JavaScript. At three counties that was 15,652 rows built into pins on every
   * unfiltered browse; statewide it is 54,296. County and city are now WHERE
   * clauses and the row cap is SQLite's, not a slice of an array we already
   * paid to build.
   *
   * City is expressible in SQL because the alias map is finite and known: the
   * spellings that canonicalise to "ROYAL PALM BEACH" are that string plus the
   * three aliases pointing at it. The filter therefore stays exactly as
   * forgiving as `canonicalCity` — the 12 establishments filed under ROYAL PLM
   * BEACH are still found — without reading the state to find them.
   *
   * Signal is a WHERE clause too, and getting there took one fix. It is not a
   * stored column — a pass older than STALE_AFTER_MONTHS reads as "unknown", so
   * it depends on when the question is asked — and the first attempt handled
   * that by over-fetching and filtering after. Measured statewide, that answered
   * "show me enforcement actions" with 4 results out of thousands, all early in
   * the alphabet, because the window was filled before the filter ran. A filter
   * that quietly returns the first slice of the answer is worse than none.
   *
   * So the boundary is expressed as a date (`staleCutoff`, derived from the same
   * STALE_AFTER_MONTHS the map uses) and compared in SQL. One constant, two
   * languages, no second literal to drift.
   */
  app.get('/api/search', (req, res) => {
    const text = (req.query.q ?? '').toString().trim();
    const city = (req.query.city ?? '').toString().trim();
    const county = (req.query.county ?? '').toString().trim();
    const signal = (req.query.signal ?? '').toString().trim();
    const limit = parseLimit(req.query.limit ?? '200');

    if (signal && !SIGNAL_DISPLAY[signal]) {
      throw new BadRequest(`Unknown signal ${JSON.stringify(signal)}`);
    }
    if (county && !(county in COUNTIES)) {
      throw new BadRequest(`Not a displayed county: ${JSON.stringify(county)}`);
    }

    const where = [];
    const params = [];

    if (county) {
      where.push('e.county_code = ?');
      params.push(county);
    }

    // Matched on every spelling that canonicalises to the requested city, so
    // choosing "Royal Palm Beach" also returns ROYAL PLM BEACH and ROAYL PALM
    // BEACH. `tidy` uppercases and collapses whitespace; the column is matched
    // the same way rather than assuming DBPR's casing.
    if (city) {
      const spellings = spellingsFor(city);
      where.push(`UPPER(TRIM(e.city)) IN (${spellings.map(() => '?').join(', ')})`);
      params.push(...spellings);
    }

    let cleaned = null;
    if (text) {
      // Normalise the query exactly as the column is normalised, or the two
      // never meet: a user typing "wendy's" must reach rows stored as WENDY'S.
      // % and _ are LIKE wildcards, dropped rather than escaped — SQLite needs
      // an explicit ESCAPE clause, and nobody searches a name for an underscore.
      cleaned = text.toUpperCase().replace(/['.]/g, '').replace(/-/g, ' ').replace(/[%_]/g, ' ').trim();

      if (cleaned === '') {
        // A query that is nothing but wildcards or punctuation matches nothing.
        // Falling through with an empty pattern would build '%%' and return the
        // entire database — a nonsense query answered with everything, which
        // reads as a working search and is the worst of both.
        where.push('1 = 0');
      } else {
        where.push(`${NORMALIZED} LIKE ?`);
        params.push(`%${cleaned}%`);
      }
    }

    if (signal) {
      const cutoff = staleCutoff(new Date());
      if (signal === 'unknown') {
        // Four ways to be unknown: never inspected, no date, too old to speak
        // for the premises now, or an inspection whose disposition maps to it.
        where.push(
          `(i.inspection_visit_id IS NULL OR i.inspection_date IS NULL
             OR i.inspection_date < ? OR i.signal IS NULL OR i.signal = 'unknown')`
        );
        params.push(cutoff);
      } else {
        where.push('i.signal = ? AND i.inspection_date IS NOT NULL AND i.inspection_date >= ?');
        params.push(signal, cutoff);
      }
    }

    const filterSql = `${q.displayedSql}${where.length ? ` AND ${where.join(' AND ')}` : ''}`;
    const filterParams = [...q.displayedParams, ...params];

    // The signal predicate reads the joined inspection, so the count carries the
    // same join. Without it the two would answer different questions.
    const countFrom = `establishment e
      LEFT JOIN inspection i ON i.inspection_visit_id = (${LATEST_VISIT})`;

    const rows = db
      .prepare(
        `SELECT e.establishment_id, e.name, e.address, e.city, e.zip, e.county_code,
                e.lat, e.lng,
                i.inspection_date, i.disposition, i.signal AS raw_signal,
                i.total_violations, i.high_violations
           FROM establishment e
      LEFT JOIN inspection i ON i.inspection_visit_id = (${LATEST_VISIT})
          WHERE ${filterSql}
       ORDER BY ${cleaned
            ? // A name match outranks an address match: someone typing "delray"
              // who wants Delray Beach should not be led by a shop on Delray Road.
              `CASE WHEN ${NORMALIZED_NAME} LIKE ? THEN 0 ELSE 1 END, e.name`
            : 'e.name'}
          LIMIT ?`
      )
      .all(...filterParams, ...(cleaned ? [`%${cleaned}%`] : []), limit);

    const now = new Date();
    const results = rows.map((row) => toPin(row, now));

    // The true count, from the same predicate that produced the page.
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM ${countFrom} WHERE ${filterSql}`)
      .get(...filterParams).n;

    const truncated = total > limit;

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      as_of: dataAsOf(db),
      query: { q: text, county, city, signal },
      count: Math.min(results.length, limit),
      total,
      truncated,
      establishments: results.slice(0, limit),
    });
  });

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
        county_code: est.county_code,
        /*
         * Whether this county's pin positions have been checked by hand
         * (DEC-017). The panel renders a plain sentence when they have not,
         * because the map now covers counties whose addresses nobody has
         * verified, and a pin that looks identical to a verified one while
         * resting on an unchecked geocode is a claim the product has not
         * earned. Palm Beach's verification says nothing about Baker's
         * addresses — see scripts/gate-paths.js for why they are not pooled.
         */
        position_verified: gates.verified(est.county_code),
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

  /* --------------------------------------------------------------- admin -- */

  /**
   * The manual refresh — /admin.html.
   *
   * THESE ROUTES ARE OPEN, DELIBERATELY
   *
   * They were gated first by a token and then by a password, and the gate was
   * removed by an explicit decision: the operator wants the pages usable on the
   * deployed service without a sign-in. What that means, written here because
   * the consequence is not visible from the code:
   *
   *   - anyone who finds /admin.html can start a refresh, and each one pulls
   *     ~40MB from DBPR's servers. `refreshRunner` allows only one at a time,
   *     so this is serial rather than concurrent, but it is not rate-limited.
   *   - anyone can read /api/admin/data, which serves the rows DEC-009 keeps
   *     off the map — mobile vendors, caterers, temporary events. A row there
   *     is not a claim that a diner can walk into it, and the page says so.
   *
   * Neither costs data integrity: ingest still aborts rather than degrades, and
   * these routes write nothing themselves. If the exposure stops being
   * acceptable, the fix is a gate here rather than anything downstream.
   */

  const adminCounties = () =>
    DISPLAYED_COUNTIES.map((code) => ({ code, name: countyName(code) }));

  app.get('/api/admin/refresh', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      as_of: dataAsOf(db),
      counties: adminCounties(),
      // Null until a refresh has been started in this process — which is not the
      // same as "never refreshed". `as_of` answers that, and the page says so.
      run: refreshRunner.state(),
    });
  });

  /**
   * POST /api/admin/refresh { county }
   *
   * `county` is one county code, or omitted/"all" for every county in scope.
   *
   * What a county selection does and does not do, because the honest version
   * matters here: DBPR publishes *district* files, not county ones, so a
   * single-county refresh still downloads its district's whole extract. The
   * selection controls which rows are loaded — it narrows the write, not the
   * fetch. And since ingest upserts and never deletes (AUD F4), refreshing one
   * county leaves the other counties' rows exactly as they were.
   */
  app.post('/api/admin/refresh', express.json({ limit: '4kb' }), (req, res) => {
    const raw = (req.body?.county ?? req.query.county ?? '').toString().trim();
    const counties = raw && raw !== 'all' ? [raw] : [];

    let result;
    try {
      result = refreshRunner.start({
        counties,
        trigger: 'manual',
        // Geocoding is the slow step and needs no rerun when only inspection
        // outcomes have changed, so it is skippable — the same --skip-geocode
        // the command line has, not a second notion of a partial refresh.
        skipGeocode: Boolean(req.body?.skip_geocode ?? req.query.skip_geocode),
      });
    } catch (err) {
      // A county code that is not in scope — a 400, not a 500.
      return res.status(err.status ?? 500).json({ error: err.message });
    }

    res.set('Cache-Control', 'no-store');
    if (!result.started) {
      return res.status(409).json({ error: result.reason, as_of: dataAsOf(db), run: result.run });
    }
    // 202: accepted and running. The refresh takes seconds to minutes, so the
    // answer to "did it work" comes from polling GET, never from this response.
    return res.status(202).json({ as_of: dataAsOf(db), run: result.run });
  });

  /* ------------------------------------------------------------ raw data -- */

  /**
   * GET /api/admin/data — the rows as stored, not as displayed.
   *
   * WHY THIS IS BEHIND THE SAME GATE AS THE REFRESH
   *
   * Everything the map serves is filtered by `displayedPredicate`: county in
   * scope, licence type 2010. This route deliberately is not — the point of a
   * raw browser is to see what actually loaded, including the 2,852 mobile
   * vendors and 706 caterers DEC-009 keeps off the map. But that decision is
   * not a rendering preference: it says publishing a mobile vendor's licensed
   * address asserts a restaurant is at someone's home or commissary. Serving
   * those rows to the public from a different URL would undo the decision by
   * the back door, so this is an operator tool and is gated as one.
   *
   * Filters: q (name, address, city, licence number), county, type, geocoded.
   * Everything is a bound parameter; the only interpolation is the fragment
   * list, which is built from fixed strings.
   */
  const RAW_COLUMNS = `e.establishment_id, e.license_key, e.license_number, e.name, e.address,
           e.normalized_address, e.city, e.zip, e.county_code, e.county_name, e.district,
           e.license_type_code, e.seats, e.risk_level, e.lat, e.lng,
           e.geocode_source, e.geocode_quality, e.first_seen_at, e.last_seen_at`;

  function rawFilter(query) {
    const where = [];
    const params = [];

    const county = (query.county ?? '').toString().trim();
    if (county) {
      if (!(county in COUNTIES)) throw new BadRequest(`Not a known county: ${JSON.stringify(county)}`);
      where.push('e.county_code = ?');
      params.push(county);
    }

    const type = (query.type ?? '').toString().trim();
    if (type) {
      // Not validated against a list: the whole point is to show what loaded,
      // including a code this code does not know about (2012 is in the data).
      where.push('e.license_type_code = ?');
      params.push(type);
    }

    const geocoded = (query.geocoded ?? '').toString().trim();
    if (geocoded === 'yes') where.push('e.lat IS NOT NULL');
    else if (geocoded === 'no') where.push('e.lat IS NULL');

    const text = (query.q ?? '').toString().trim();
    if (text) {
      // Same normalisation as /api/search, for the same reason: a reader typing
      // "wendy's" must reach the row stored as WENDY'S. % and _ are dropped
      // rather than escaped — LIKE would need an explicit ESCAPE clause.
      const cleaned = text.toUpperCase().replace(/['.]/g, '').replace(/-/g, ' ').replace(/[%_]/g, ' ').trim();
      if (cleaned === '') {
        // Punctuation only. Matching everything here would read as a working
        // search that returned the entire database.
        where.push('1 = 0');
      } else {
        where.push(`(${NORMALIZED} LIKE ? OR UPPER(e.license_number) LIKE ? OR e.establishment_id = ?)`);
        params.push(`%${cleaned}%`, `%${cleaned}%`, text);
      }
    }

    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  app.get('/api/admin/data', (req, res) => {
    const filter = rawFilter(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = db
      .prepare(
        `SELECT ${RAW_COLUMNS},
                i.inspection_date, i.disposition, i.signal, i.inspection_type,
                i.total_violations, i.high_violations,
                (SELECT COUNT(*) FROM inspection n WHERE n.license_key = e.license_key) AS inspection_count
           FROM establishment e
      LEFT JOIN inspection i ON i.inspection_visit_id = (${LATEST_VISIT})
           ${filter.sql}
       ORDER BY e.name, e.address
          LIMIT ? OFFSET ?`
      )
      .all(...filter.params, limit, offset);

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM establishment e ${filter.sql}`)
      .get(...filter.params).n;

    res.set('Cache-Control', 'no-store');
    res.json({
      as_of: dataAsOf(db),
      query: {
        q: (req.query.q ?? '').toString().trim(),
        county: (req.query.county ?? '').toString().trim(),
        type: (req.query.type ?? '').toString().trim(),
        geocoded: (req.query.geocoded ?? '').toString().trim(),
      },
      total,
      limit,
      offset,
      // Facets from the data itself, so the filters cannot list a type that is
      // not there or omit one that is.
      counties: db
        .prepare('SELECT county_code AS code, COUNT(*) AS n FROM establishment GROUP BY 1 ORDER BY 1')
        .all()
        .map((row) => ({ ...row, name: countyName(row.code) })),
      types: db
        .prepare('SELECT license_type_code AS code, COUNT(*) AS n FROM establishment GROUP BY 1 ORDER BY n DESC')
        .all()
        .map((row) => ({ ...row, name: licenseTypeName(row.code) })),
      rows,
    });
  });

  /**
   * GET /api/admin/data/:establishmentId — one row, and everything that hangs
   * off it: every inspection visit (not just the latest), the violation codes
   * per visit, and the geocode_cache entry its coordinates came from.
   *
   * Unshaped on purpose. `/api/establishments/:id` answers "what should a diner
   * see"; this answers "what is in the database", which is the question you ask
   * when the first one looks wrong.
   */
  app.get('/api/admin/data/:establishmentId', (req, res) => {
    const establishment = db
      .prepare(`SELECT ${RAW_COLUMNS} FROM establishment e WHERE e.establishment_id = ?`)
      .get(req.params.establishmentId);

    if (!establishment) return res.status(404).json({ error: 'No such establishment' });

    const inspections = db
      .prepare(
        `SELECT * FROM inspection
          WHERE license_key = ?
       ORDER BY inspection_date DESC, visit_number DESC`
      )
      .all(establishment.license_key);

    const violations = db
      .prepare(
        `SELECT v.inspection_visit_id, v.violation_code, v.count
           FROM violation v
           JOIN inspection i ON i.inspection_visit_id = v.inspection_visit_id
          WHERE i.license_key = ?
       ORDER BY v.inspection_visit_id, CAST(v.violation_code AS INTEGER)`
      )
      .all(establishment.license_key);

    const byVisit = new Map();
    for (const row of violations) {
      const bucket = byVisit.get(row.inspection_visit_id) ?? [];
      bucket.push({ violation_code: row.violation_code, count: row.count });
      byVisit.set(row.inspection_visit_id, bucket);
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      establishment: {
        ...establishment,
        license_type_name: licenseTypeName(establishment.license_type_code),
        // Says plainly whether this row is one the map shows, since the reason
        // it may be missing from the map is nearly always one of these two.
        displayed:
          establishment.license_type_code === '2010' &&
          DISPLAYED_COUNTIES.includes(establishment.county_code),
      },
      geocode_cache:
        db.prepare('SELECT * FROM geocode_cache WHERE normalized_address = ?')
          .get(establishment.normalized_address) ?? null,
      inspections: inspections.map((row) => ({
        ...row,
        violations: byVisit.get(row.inspection_visit_id) ?? [],
      })),
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

  // One runner, two callers: the weekly schedule and the /admin.html button.
  // Sharing it is what makes "a refresh is already running" a fact rather than
  // a race between them.
  const refreshRunner = createRefreshRunner();
  const app = createApp(db, { refreshRunner });
  const port = Number(process.env.PORT) || 3000;

  // Restore the committed geocode cache if this is a fresh disk. A no-op when
  // anything is already cached, so it costs one COUNT on every other boot.
  // Render disks exist only at runtime, so this cannot be a build step.
  try {
    const { seeded, reason } = seedGeocodeCache(db);
    console.log(seeded ? `geocode cache: seeded ${seeded} address(es) — ${reason}` : `geocode cache: ${reason}`);
  } catch (err) {
    // Never fatal. A missing cache costs geocoding time, not correctness.
    console.error(`geocode cache: could not seed — ${err.message}`);
  }

  const server = app.listen(port, () => {
    console.log(`safe-eats listening on http://localhost:${port}`);
    console.log(`data as of ${dataAsOf(db) ?? '(no successful ingest recorded)'}`);
  });

  // The weekly refresh lives here rather than in a separate scheduled service,
  // because on Render only the service holding the disk can see the database.
  // See src/scheduler.js for why that is not a workaround but the only correct
  // shape on this host.
  const scheduler = createScheduler(db, { runner: refreshRunner });
  scheduler.start();

  // `server.close()` stops accepting connections but waits on established ones,
  // and a browser holds its keep-alive socket open — so Ctrl-C alone leaves the
  // process running until a second signal. Drop the idle sockets, then give the
  // in-flight ones a bounded moment. The timer is unref'd so it never keeps the
  // process alive by itself.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      scheduler.stop();
      server.close(() => { db.close(); process.exit(0); });
      server.closeIdleConnections?.();
      setTimeout(() => { db.close(); process.exit(0); }, 3000).unref();
    });
  }
}

if (require.main === module) main();

module.exports = { createApp, parseBbox, parseLimit, DEFAULT_LIMIT, MAX_LIMIT };
