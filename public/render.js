'use strict';

/**
 * Shared presentation — the signal marks, the plain-language wording, and the
 * inspection history markup.
 *
 * This file exists because there are now two pages that render an inspection:
 * the map (`app.js`) and the search page (`search.js`). Copying the markup into
 * the second one would have created exactly the drift `src/display.js` was
 * written to prevent on the data side — two definitions of what amber means,
 * one of which quietly stops matching the legend. So the rendering has one
 * definition and both pages call it.
 *
 * What it deliberately does NOT hold: anything that touches the DOM of a
 * particular page, and anything Leaflet. Those belong to the page that has a
 * map. This file turns API data into strings.
 *
 * The palette is not defined here either. `configure()` takes it from
 * /api/meta, which takes it from src/signal.js — so the colour a reader sees
 * has a single source three layers down, and a hardcoded copy here would be a
 * colour that drifts silently.
 */

window.SafeEats = (function () {
  let LEGEND = {};
  let windowStart = null;
  let COUNTIES = [];

  /** Call once, with the body of /api/meta, before rendering anything. */
  function configure(meta) {
    LEGEND = (meta && meta.signals) || {};
    windowStart = (meta && meta.inspection_window_start) || null;
    COUNTIES = (meta && meta.counties) || [];
  }

  const legend = () => LEGEND;
  const counties = () => COUNTIES;

  /* ------------------------------------------------------------- markers --- */

  /**
   * FR-404 — colour AND shape. Rendered as inline SVG rather than a coloured
   * dot so the mark survives greyscale, colour-blindness, and a phone screen in
   * sunlight.
   *
   * The white stroke does more work since the basemap gained colour (DEC-013):
   * it is the separation between a green "met standards" pin and the green of a
   * park underneath it. Widened accordingly, and paired with a drop shadow in
   * CSS so the mark keeps an edge over tan, orange and water alike.
   */
  function shapeSvg(shape, color, size) {
    const s = size;
    const c = s / 2;
    const r = s * 0.42;
    const common = `fill="${color}" stroke="#ffffff" stroke-width="${Math.max(1.5, s * 0.16)}" stroke-linejoin="round"`;

    switch (shape) {
      case 'triangle': {
        const h = r * 1.9;
        const pts = [[c, c - h / 2], [c + r * 1.05, c + h / 2], [c - r * 1.05, c + h / 2]];
        return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" ${common}/>`;
      }
      case 'square': {
        const a = r * 1.7;
        return `<rect x="${c - a / 2}" y="${c - a / 2}" width="${a}" height="${a}" rx="${a * 0.12}" ${common}/>`;
      }
      case 'diamond': {
        const d = r * 1.15;
        const pts = [[c, c - d], [c + d, c], [c, c + d], [c - d, c]];
        return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" ${common}/>`;
      }
      case 'circle':
      default:
        return `<circle cx="${c}" cy="${c}" r="${r}" ${common}/>`;
    }
  }

  function markSvg(signal, size = 18) {
    const { shape, color } = LEGEND[signal] || LEGEND.unknown || { shape: 'diamond', color: '#6e7781' };
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">${shapeSvg(shape, color, size)}</svg>`;
  }

  /**
   * Text stand-ins for the pin shapes, for places that can only hold
   * characters — chiefly <option>, which cannot contain an SVG and whose
   * colour a native mobile picker ignores. Keyed by the shape names
   * src/signal.js publishes, so adding a signal there surfaces here.
   */
  const SHAPE_GLYPH = {
    circle: '●',    // U+25CF BLACK CIRCLE
    triangle: '▲',  // U+25B2 BLACK UP-POINTING TRIANGLE
    square: '■',    // U+25A0 BLACK SQUARE
    diamond: '◆',   // U+25C6 BLACK DIAMOND
  };

  /* -------------------------------------------------------------- wording --- */

  const label = (signal) => (LEGEND[signal] || {}).label || 'No recent inspection';
  const countyName = (code) => (COUNTIES.find((c) => c.code === code) || {}).name || code;

  const formatDate = (iso) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  /**
   * FR-406's "plain line" — one sentence a person can act on, in place of a
   * colour they have to decode. The grey case gets the most careful wording:
   * after DEC-010 it is the majority state, and a reader must never take it to
   * mean the establishment failed. It says what is true — the state has not
   * published a visit in this window — and names the window.
   */
  function plainLine(pin) {
    const when = formatDate(pin.last_inspection_date);
    switch (pin.signal) {
      case 'pass':
        return `Inspected ${when} with no follow-up required.`;
      case 'warning':
        return `Inspected ${when}. Violations were found and follow-up was still open.`;
      case 'serious':
        return `Inspected ${when} and referred for enforcement action.`;
      default:
        return windowStart
          ? `No inspection published since ${formatDate(windowStart)}. That is not a bad result — it means the state has not recorded a visit here in the period we hold.`
          : 'No recent inspection on record. That is not a bad result — it means no visit has been published for this establishment.';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /**
   * FR-508 — elapsed time in plain language. "Three weeks ago" is a fact a
   * person can weigh; "2026-08-11" makes them do arithmetic before they can.
   */
  function elapsed(iso) {
    const then = Date.parse(`${iso}T00:00:00Z`);
    if (Number.isNaN(then)) return null;
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    const years = (days / 365).toFixed(days < 730 ? 0 : 1).replace(/\.0$/, '');
    return `${years} year${years === '1' ? '' : 's'} ago`;
  }

  /* --------------------------------------------------------------- visits --- */

  /**
   * FR-503 — tiered counts with DBPR's own severity words, and a gloss saying
   * what each tier means.
   *
   * The bare violation codes are deliberately NOT rendered. The extract ships
   * them as numbers ("03", "08", "12") with no published description, and the
   * state's per-visit detail page is dead, so there is no authoritative text to
   * attach to them. Printing "Violation 03" tells a reader nothing, and writing
   * our own gloss for it would be inventing a claim about a named restaurant.
   * See DEC-011.
   */
  const TIERS = [
    ['high', 'High priority', 'Could directly contribute to food-borne illness.'],
    ['intermediate', 'Intermediate', 'Relates to controls that prevent a high-priority risk.'],
    ['basic', 'Basic', 'General maintenance, cleaning and facility upkeep.'],
  ];

  function tiersHtml(v) {
    if (!v || v.total === null || v.total === undefined) return '';
    const cells = TIERS.map(
      ([key, label, gloss]) =>
        `<li><span class="tier__label">${label}</span>` +
        `<span class="tier__n">${v[key] ?? 0}</span>` +
        `<span class="tier__gloss">${gloss}</span></li>`
    ).join('');
    return `<ul class="tiers">${cells}</ul>`;
  }

  function visitHtml(visit) {
    const v = visit.violations || {};
    const counts =
      v.total === null || v.total === undefined
        ? '<p class="visit__counts">No violation counts published for this visit.</p>'
        : `<p class="visit__counts">${v.total} violation${v.total === 1 ? '' : 's'}` +
          ` — ${v.high ?? 0} high priority, ${v.intermediate ?? 0} intermediate, ${v.basic ?? 0} basic.</p>`;

    return (
      `<li class="visit">` +
      `<p class="visit__head">${markSvg(visit.signal, 13)}` +
      `<span class="visit__date">${escapeHtml(formatDate(visit.date))}</span>` +
      `<span class="visit__type">${escapeHtml(visit.type || 'Inspection')}</span></p>` +
      // The disposition verbatim from the state. It is the state's own wording
      // for the outcome, and paraphrasing it would put our words on their record.
      `<p class="visit__disposition">${escapeHtml(visit.disposition || 'No disposition recorded')}</p>` +
      counts +
      `</li>`
    );
  }

  /**
   * The full record for one establishment, as served by
   * /api/establishments/:id — used by the map's slide-over panel and by the
   * search page's expanded row. The same markup in both, because what the
   * state published about a place should not depend on which page you reached
   * it from.
   *
   * `headingId` is a parameter because two pages cannot both own the id
   * `detail-name`: the search page renders many of these at once, and a
   * duplicated id makes `aria-labelledby` point at whichever one happens to be
   * first in the document.
   */
  function detailHeaderHtml(data, { headingId = 'detail-name', headingLevel = 'h2' } = {}) {
    const est = data.establishment;
    const latest = data.inspections[0] || null;
    const when = latest ? elapsed(latest.date) : null;
    const h = headingLevel;

    return (
      `<${h} id="${escapeHtml(headingId)}">${escapeHtml(est.name)}</${h}>` +
      `<p class="panel__addr">${escapeHtml([est.address, est.city, est.zip].filter(Boolean).join(', '))}</p>` +
      `<p class="verdict">${markSvg(est.signal, 18)}<span>${escapeHtml(label(est.signal))}` +
      (latest ? `<span class="verdict__when">Last inspected ${escapeHtml(formatDate(latest.date))} · ${escapeHtml(when)}</span>` : '') +
      `</span></p>` +
      `<p class="panel__plain">${escapeHtml(plainLine({ signal: est.signal, last_inspection_date: latest?.date }))}</p>`
    );
  }

  /**
   * Everything below the header: the accuracy caveat, the latest visit's
   * tiers, the full visit list, and the source note.
   *
   * Split from the header because the search page has already drawn the name,
   * address and verdict into the row you clicked to get here — repeating them
   * inside the expansion would make the reader check whether they are looking
   * at the same establishment. The map's panel has no such row, so it renders
   * both halves.
   */
  function detailBodyHtml(data) {
    const est = data.establishment;
    const latest = data.inspections[0] || null;

    /*
     * DEC-017 — the map covers all 67 counties, and only some of them have had
     * their pin positions checked by hand against satellite imagery. Where that
     * check has not happened, the panel says so rather than letting a pin that
     * looks identical to a verified one imply a verification nobody did.
     *
     * It is placed under the address, because the address is the claim it
     * qualifies: the street address is the state's own record and is not in
     * doubt; the position derived from it is what has not been checked.
     */
    const unverified = est.position_verified
      ? ''
      : `<p class="panel__unverified">` +
        `The address below is the state's record. Its position on the map is derived from that ` +
        `address, and pin accuracy in ${escapeHtml(est.county || 'this county')} County has not yet been ` +
        `verified against imagery. <a href="/methodology.html#accuracy">How positions are checked</a>.</p>`;

    const latestBlock = latest
      ? `<h3>Most recent visit</h3>${tiersHtml(latest.violations)}`
      : '';

    const history = data.inspections.length
      ? `<h3>All published inspections (${data.inspections.length})</h3>` +
        `<ul class="visits">${data.inspections.map(visitHtml).join('')}</ul>`
      : '';

    // FR-505 — the snapshot caveat travels with the record, not only with the
    // map. Someone linked straight to this panel has not seen the header.
    // FR-504 — the state's per-visit detail page (inspectionDetail.asp) now
    // answers with a bounce stub, so this links to their live search rather than
    // claiming to deep-link a record it cannot reach. See DEC-012.
    const note =
      `<p class="panel__note">Each result describes one inspection on one day. ` +
      `It is not a rating, and it does not describe the kitchen today. ` +
      `Published by the Florida Department of Business &amp; Professional Regulation` +
      (data.as_of ? ` · data as of ${escapeHtml(formatDate(data.as_of.slice(0, 10)))}` : '') + `.` +
      `<a class="panel__source" href="https://www.myfloridalicense.com/portalsearches/VerifyLicensee?Mode=0&amp;BoardType=H" target="_blank" rel="noopener">` +
      `Look up ${escapeHtml(est.license_number || 'this licence')} on the state's inspection search →</a></p>`;

    return unverified + latestBlock + history + note;
  }

  const detailHtml = (data, opts) => detailHeaderHtml(data, opts) + detailBodyHtml(data);

  return {
    configure, legend, counties,
    shapeSvg, markSvg, SHAPE_GLYPH,
    label, countyName, formatDate, plainLine, escapeHtml, elapsed,
    tiersHtml, visitHtml, detailHeaderHtml, detailBodyHtml, detailHtml,
  };
})();
