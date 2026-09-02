'use strict';

/**
 * Safe Eats map — Task 9 · FR-401, FR-403, FR-404, FR-406.
 *
 * Everything drawn here comes from our own API (FR-403). The page makes exactly
 * three kinds of request: `/api/meta` once, `/api/establishments?bbox=` per
 * viewport, and basemap tiles from Esri. There is no Places lookup, no
 * geocoder, and no key — which is the whole point of DEC-002 and DEC-008.
 */

(function () {
  const $ = (id) => document.getElementById(id);

  /** Palm Beach County, from the loaded extent. The map opens on the product's
   *  entire subject rather than on the user — geolocation is a permission prompt
   *  that buys nothing when the answer is one county wide. */
  const COUNTY_BOUNDS = [[26.30, -80.36], [26.99, -79.98]];

  /**
   * The signal palette is NOT defined here. It is served by /api/meta from
   * src/signal.js, so the map and the API cannot disagree about what amber
   * means. A hardcoded copy is a colour that drifts silently.
   */
  let LEGEND = {};
  let windowStart = null;

  const state = {
    map: null,
    cluster: null,
    lastBbox: null,
    inFlight: null,
    searching: false,
  };

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

  function iconFor(signal) {
    const size = 18;
    return L.divIcon({
      className: 'pin',
      html: markSvg(signal, size),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  /* -------------------------------------------------------------- wording --- */

  const label = (signal) => (LEGEND[signal] || {}).label || 'No recent inspection';

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

  function popupHtml(pin) {
    const counts =
      pin.total_violations === null || pin.total_violations === undefined
        ? ''
        : `<p class="card__plain">${pin.total_violations} violation${pin.total_violations === 1 ? '' : 's'} recorded` +
          (pin.high_violations ? `, ${pin.high_violations} high priority` : '') +
          `.</p>`;

    return (
      `<div class="card">` +
      `<p class="card__name">${escapeHtml(pin.name)}</p>` +
      `<p class="card__addr">${escapeHtml([pin.address, pin.city].filter(Boolean).join(', '))}</p>` +
      `<p class="card__signal">${markSvg(pin.signal, 14)} ${escapeHtml(label(pin.signal))}</p>` +
      `<p class="card__plain">${escapeHtml(plainLine(pin))}</p>` +
      counts +
      `<button type="button" class="card__more" data-detail-id="${escapeHtml(pin.id)}">See all inspections</button>` +
      `</div>`
    );
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /* ---------------------------------------------------------------- panel --- */

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

  function detailHtml(data) {
    const est = data.establishment;
    const latest = data.inspections[0] || null;
    const when = latest ? elapsed(latest.date) : null;

    const header =
      `<h2 id="detail-name">${escapeHtml(est.name)}</h2>` +
      `<p class="panel__addr">${escapeHtml([est.address, est.city, est.zip].filter(Boolean).join(', '))}</p>` +
      `<p class="verdict">${markSvg(est.signal, 18)}<span>${escapeHtml(label(est.signal))}` +
      (latest ? `<span class="verdict__when">Last inspected ${escapeHtml(formatDate(latest.date))} · ${escapeHtml(when)}</span>` : '') +
      `</span></p>` +
      `<p class="panel__plain">${escapeHtml(plainLine({ signal: est.signal, last_inspection_date: latest?.date }))}</p>`;

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

    return header + latestBlock + history + note;
  }

  async function openDetail(id) {
    const panel = $('detail');
    const body = $('detail-body');
    body.innerHTML = '<p class="panel__plain">Loading…</p>';
    panel.hidden = false;

    try {
      const res = await fetch(`/api/establishments/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      body.innerHTML = detailHtml(data);
      state.openId = id;
      // Shareable without server rendering (FR-501 proper is Gate 4 work).
      history.replaceState(null, '', `#/e/${encodeURIComponent(id)}`);
      $('detail-close').focus();
    } catch (err) {
      body.innerHTML = `<p class="panel__plain">Could not load this establishment: ${escapeHtml(err.message)}</p>`;
    }
  }

  function closeDetail() {
    $('detail').hidden = true;
    state.openId = null;
    history.replaceState(null, '', location.pathname + location.search);
  }

  /* --------------------------------------------------------------- render --- */

  function setStatus(text, tone) {
    const el = $('status');
    el.textContent = text || '';
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function renderLegend() {
    const order = ['pass', 'warning', 'serious', 'unknown'];
    const items = order
      .filter((key) => LEGEND[key])
      .map((key) => `<li>${markSvg(key, 13)} ${escapeHtml(LEGEND[key].label)}</li>`)
      .join('');
    $('legend-note').innerHTML = `<ul class="legend">${items}</ul>`;
  }

  function renderResults(pins) {
    const list = $('results-list');
    if (!pins.length) {
      list.innerHTML = '<li>No establishments in this part of the map.</li>';
      return;
    }

    // Worst signal first: someone scanning the list should meet the enforcement
    // actions before the clean results, which is the opposite of alphabetical.
    const rank = { serious: 0, warning: 1, pass: 2, unknown: 3 };
    const sorted = [...pins].sort(
      (a, b) => (rank[a.signal] ?? 9) - (rank[b.signal] ?? 9) || a.name.localeCompare(b.name)
    );

    list.innerHTML = sorted
      .map(
        (pin) =>
          `<li><a href="#" data-id="${escapeHtml(pin.id)}">` +
          `${markSvg(pin.signal, 13)}` +
          `<span class="results__name">${escapeHtml(pin.name)}</span>` +
          `<span class="results__meta">${escapeHtml(label(pin.signal))}` +
          (pin.last_inspection_date ? ` · ${escapeHtml(formatDate(pin.last_inspection_date))}` : '') +
          `</span></a></li>`
      )
      .join('');
  }

  function draw(pins) {
    state.cluster.clearLayers();

    const markers = pins.map((pin) => {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: iconFor(pin.signal),
        // Read aloud as one sentence rather than as an unlabelled graphic.
        alt: `${pin.name}. ${label(pin.signal)}.`,
        keyboard: true,
      });
      marker.bindPopup(popupHtml(pin));
      marker.safeEatsId = pin.id;
      return marker;
    });

    state.cluster.addLayers(markers);
    state.markersById = new Map(markers.map((m) => [m.safeEatsId, m]));
    renderResults(pins);
  }

  /* ---------------------------------------------------------------- fetch --- */

  async function load() {
    const bbox = state.map.getBounds().toBBoxString();
    if (bbox === state.lastBbox) return;

    if (state.inFlight) state.inFlight.abort();
    const controller = new AbortController();
    state.inFlight = controller;

    setStatus('Loading…');
    try {
      const res = await fetch(`/api/establishments?bbox=${encodeURIComponent(bbox)}`, {
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

      state.lastBbox = bbox;
      draw(body.establishments);

      // The server's default limit clears the whole county, so truncation means
      // a genuinely oversized box. Say so plainly rather than reporting a count
      // the reader would take for the total.
      setStatus(
        body.truncated
          ? `More than ${body.count} here — showing the first ${body.count}. Zoom in to see them all.`
          : `${body.count} establishment${body.count === 1 ? '' : 's'} in view`
      );
      $('search-area').hidden = true;
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus(`Could not load establishments: ${err.message}`, 'error');
    } finally {
      if (state.inFlight === controller) state.inFlight = null;
    }
  }

  /* --------------------------------------------------------------- search --- */

  /**
   * Two ways to have a result set, and the page must never leave you unsure
   * which one you are looking at: the viewport (pan the map) or a search
   * (name, city, result). The scope line under the map says so in words, and
   * the results heading changes with it.
   */
  function setScope(html) {
    $('scope').innerHTML = html || '';
    $('clear').hidden = !state.searching;
    $('results-heading').textContent = state.searching ? 'Search results' : 'Establishments in view';
  }

  async function runSearch(event) {
    if (event) event.preventDefault();

    const params = new URLSearchParams();
    for (const id of ['q', 'city', 'signal']) {
      const value = $(id).value.trim();
      if (value) params.set(id, value);
    }

    // An empty form is not a search — it is a request to go back to the map.
    if (![...params.keys()].length) return clearSearch();

    if (state.inFlight) state.inFlight.abort();
    const controller = new AbortController();
    state.inFlight = controller;

    setStatus('Searching…');
    try {
      const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`);

      state.searching = true;
      // A search leaves viewport mode, so the remembered box must not suppress
      // the next "search this area" — otherwise panning back looks broken.
      state.lastBbox = null;
      draw(body.establishments);

      const withPins = body.establishments.filter((e) => Number.isFinite(e.lat));
      if (withPins.length) {
        state.map.fitBounds(withPins.map((e) => [e.lat, e.lng]), { padding: [40, 40], maxZoom: 16 });
      }

      const bits = [];
      if (body.query.q) bits.push(`matching “${escapeHtml(body.query.q)}”`);
      if (body.query.city) bits.push(`in ${escapeHtml(body.query.city)}`);
      if (body.query.signal) bits.push(`with result “${escapeHtml(label(body.query.signal))}”`);

      setScope(
        body.total === 0
          ? `No establishments ${bits.join(' ')}.`
          : `<b>${body.total}</b> establishment${body.total === 1 ? '' : 's'} ${bits.join(' ')}` +
            (body.truncated ? ` — showing the first ${body.count} on the map.` : '.')
      );

      setStatus(body.total ? `${Math.min(body.total, body.count)} shown` : 'Nothing matched');
      $('search-area').hidden = true;
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus(`Search failed: ${err.message}`, 'error');
    } finally {
      if (state.inFlight === controller) state.inFlight = null;
    }
  }

  function clearSearch() {
    $('q').value = '';
    $('city').value = '';
    $('signal').value = '';
    state.searching = false;
    state.lastBbox = null;
    setScope('');
    load();
  }

  async function loadMeta() {
    try {
      const res = await fetch('/api/meta');
      const meta = await res.json();
      if (!res.ok) throw new Error(meta.error || 'meta unavailable');

      LEGEND = meta.signals || {};
      windowStart = meta.inspection_window_start || null;
      renderLegend();

      // Both filter menus are built from the API, never hardcoded: the cities
      // are whatever the licence data contains, and the result options are
      // whatever src/signal.js defines.
      const citySelect = $('city');
      for (const { city, n } of meta.cities || []) {
        const option = document.createElement('option');
        option.value = city;
        option.textContent = `${city} (${n})`;
        citySelect.append(option);
      }

      const signalSelect = $('signal');
      for (const key of ['pass', 'warning', 'serious', 'unknown']) {
        if (!meta.signals[key]) continue;
        const option = document.createElement('option');
        option.value = key;
        option.textContent = meta.signals[key].label;
        signalSelect.append(option);
      }

      // The as-of date is derived from the last successful ingest, never from
      // the clock (FR-601). If the pipeline stops, this date stops with it —
      // which is exactly the signal v1 never gave anyone for three years.
      $('asof').textContent = meta.as_of
        ? `Data as of ${formatDate(meta.as_of.slice(0, 10))}`
        : 'No successful data load on record';
    } catch (err) {
      $('asof').textContent = 'Data date unavailable';
      setStatus(`Could not load map settings: ${err.message}`, 'error');
    }
  }

  /* ----------------------------------------------------------------- init --- */

  function init() {
    state.map = L.map('map', {
      zoomControl: true,
      preferCanvas: false,
    }).fitBounds(COUNTY_BOUNDS);

    /*
     * Esri World Street Map — DEC-013.
     *
     * Two changes from DEC-008, for two different reasons.
     *
     * Not CARTO: CARTO began requiring a key for basemaps.cartocdn.com and now
     * serves an "API KEY REQUIRED" watermark stamped across every tile. It
     * answers HTTP 200 with a valid PNG carrying correct map data, so every
     * status-code and content-type check passes while the product is visibly
     * broken — the same shape as AUD F1, and caught only by looking at the
     * pixels rather than at the response.
     *
     * Not greyscale: colour was asked for. DEC-008 chose a desaturated basemap
     * so the signal colours would be the only colour on the map, and that
     * reasoning still holds — a street map puts green parks and orange highways
     * in the same channel as the pass/warning/serious pins. FR-404 survives
     * because the signal was never carried by colour alone: each state also has
     * a distinct shape, and the popup and list both name it in words. What is
     * lost is instant scanning, so the pins compensate with a heavier white
     * stroke and a drop shadow (see .pin in styles.css) to hold their edge
     * against tan, green and orange alike.
     *
     * Esri's street map bakes its labels into the tile, so unlike the Light Gray
     * canvas it needs no second reference layer.
     */
    const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';

    L.tileLayer(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, {
      attribution:
        'Tiles © Esri — Esri, HERE, Garmin, USGS, Intermap, © OpenStreetMap contributors, and the GIS user community',
      maxZoom: 19,
    }).addTo(state.map);

    state.cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 55,
      // Neutral bubble: a cluster coloured by its worst member would assert
      // something about the neighbourhood that no inspection record supports.
      iconCreateFunction: (cluster) =>
        L.divIcon({
          html: `<span class="cluster">${cluster.getChildCount()}</span>`,
          className: '',
          iconSize: [36, 36],
        }),
    }).addTo(state.map);

    // A moved map is not a new query until the user asks for one — refetching on
    // every pan burns requests and moves pins under the reader's finger.
    state.map.on('moveend', () => {
      if (state.map.getBounds().toBBoxString() !== state.lastBbox) {
        $('search-area').hidden = false;
      }
    });

    $('search-area').addEventListener('click', () => {
      // Asking for this viewport is a way out of a search, so drop the search
      // state rather than leaving the scope line describing a stale query.
      if (state.searching) { state.searching = false; setScope(''); }
      load();
    });

    // The list is a list of records, so clicking one opens the record — and
    // moves the map to it, because where it is remains part of the answer.
    $('results-list').addEventListener('click', (event) => {
      const link = event.target.closest('a[data-id]');
      if (!link) return;
      event.preventDefault();
      const id = link.dataset.id;
      const marker = state.markersById?.get(id);
      if (marker) state.cluster.zoomToShowLayer(marker, () => {});
      openDetail(id);
    });

    // Popups are re-created by Leaflet on every open, so the handler is
    // delegated from the map container rather than bound per marker.
    $('map').addEventListener('click', (event) => {
      const button = event.target.closest('[data-detail-id]');
      if (!button) return;
      openDetail(button.dataset.detailId);
    });

    $('detail-close').addEventListener('click', closeDetail);

    $('search').addEventListener('submit', runSearch);
    $('clear').addEventListener('click', clearSearch);
    // Changing a menu searches straight away; typing still waits for Enter or
    // the button, so the map does not lurch on every keystroke.
    $('city').addEventListener('change', runSearch);
    $('signal').addEventListener('change', runSearch);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('detail').hidden) closeDetail();
    });

    // A shared link opens straight onto the record it names.
    const deepLink = /^#\/e\/(.+)$/.exec(location.hash);

    loadMeta()
      .then(load)
      .then(() => {
        if (deepLink) openDetail(decodeURIComponent(deepLink[1]));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
