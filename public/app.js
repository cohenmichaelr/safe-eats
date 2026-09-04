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
  let COUNTIES = [];

  const state = {
    map: null,
    basemapAdded: false,
    cluster: null,
    lastBbox: null,
    inFlight: null,
    searching: false,
    unmapped: 0,
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

  /** Show the real marker for whatever the result filter currently selects. */
  function updateSignalMark() {
    const value = $('signal').value;
    $('signal-mark').innerHTML = value ? markSvg(value, 15) : '';
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
      `<p class="card__addr">${escapeHtml([pin.address, pin.city_label || pin.city].filter(Boolean).join(', '))}</p>` +
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

    return header + unverified + latestBlock + history + note;
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
          (Number.isFinite(pin.lat) ? '' : ' · <span class="results__unmapped">not on the map</span>') +
          `</span></a></li>`
      )
      .join('');
  }

  /**
   * Draw a result set.
   *
   * Not every establishment can be a pin. Search returns matches whether or not
   * they have a coordinate — a restaurant we cannot place is still a licensed
   * restaurant with inspection results, and refusing to find it would be worse
   * than not mapping it. The bbox query never produced those, because it reads
   * from the spatial index, so this function used to assume a coordinate on
   * every row and threw the moment search started calling it.
   *
   * So the two are separated: the map gets what can be mapped, the list gets
   * everything, and the count of the difference is reported rather than hidden.
   * Dropping them from the map silently would be the same failure as the
   * viewport cap that once hid 2,000 restaurants behind a flag nobody read.
   */
  function draw(pins) {
    state.cluster.clearLayers();

    const mappable = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    state.unmapped = pins.length - mappable.length;

    const markers = mappable.map((pin) => {
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
    return { mapped: mappable.length, unmapped: state.unmapped };
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
   * The city menu follows the county menu, and is fetched when it changes.
   *
   * Statewide there are 942 cities and only one county's worth is ever shown,
   * so shipping them all with the first paint spent 64 KB on a menu nobody had
   * opened (DEC-017). The menu itself matters: it removes a real trap, because
   * Florida repeats its town names across county lines.
   *
   * The selected city is preserved when it still exists under the new county,
   * so changing county to re-check the same town does not silently widen the
   * search back to everywhere. A failed fetch leaves "All cities" in place —
   * the search still works without the filter.
   */
  const cityCache = new Map();

  async function fillCities() {
    const county = $('county').value;
    const select = $('city');
    const previous = select.value;

    let list = cityCache.get(county);
    if (!list) {
      try {
        const res = await fetch(`/api/cities${county ? `?county=${encodeURIComponent(county)}` : ''}`);
        list = (await res.json()).cities || [];
        cityCache.set(county, list);
      } catch {
        list = [];
      }
    }

    // The menu may have moved on while the request was in flight.
    if ($('county').value !== county) return;

    select.innerHTML = '<option value="">All cities</option>';
    for (const { city, label, n } of list) {
      const option = document.createElement('option');
      option.value = city;
      // Counts are per county, so summing a repeated name across counties
      // would report a total that matches no possible filter.
      option.textContent = `${label} (${n})`;
      select.append(option);
    }

    if (previous && list.some((c) => c.city === previous)) select.value = previous;
  }



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
    for (const id of ['q', 'county', 'city', 'signal']) {
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
      const drawn = draw(body.establishments);

      const withPins = body.establishments.filter((e) => Number.isFinite(e.lat));
      if (withPins.length) {
        state.map.fitBounds(withPins.map((e) => [e.lat, e.lng]), { padding: [40, 40], maxZoom: 16 });
      }

      const bits = [];
      if (body.query.q) bits.push(`matching “${escapeHtml(body.query.q)}”`);
      if (body.query.city) bits.push(`in ${escapeHtml(body.query.city)}`);
      if (body.query.county && !body.query.city) bits.push(`in ${escapeHtml(countyName(body.query.county))} County`);
      if (body.query.signal) bits.push(`with result “${escapeHtml(label(body.query.signal))}”`);

      setScope(
        body.total === 0
          ? `No establishments ${bits.join(' ')}.`
          : `<b>${body.total}</b> establishment${body.total === 1 ? '' : 's'} ${bits.join(' ')}` +
            (body.truncated ? ` — showing the first ${body.count}` : '') +
            (drawn.unmapped
              ? `. <b>${drawn.unmapped}</b> of these ${drawn.unmapped === 1 ? 'has' : 'have'} no mapped location and ${drawn.unmapped === 1 ? 'appears' : 'appear'} only in the list below.`
              : '.')
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
    $('county').value = '';
    fillCities();
    $('city').value = '';
    $('signal').value = '';
    updateSignalMark();
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
      addBasemap(meta.basemap);

      // The tile provider's credit, which is a licence condition rather than a
      // courtesy: CARTO and the OSMF both require it.
      const credit = $('basemap-credit');
      if (credit && meta.attribution?.basemap) {
        credit.textContent = `Basemap: ${meta.attribution.basemap}.`;
      }
      windowStart = meta.inspection_window_start || null;
      renderLegend();

      // Every filter menu is built from the API, never hardcoded: the counties
      // are whatever is loaded, the cities are whatever the licence data
      // contains (fetched per county), and the result options are whatever
      // src/signal.js defines.
      COUNTIES = meta.counties || [];

      const countySelect = $('county');
      for (const { code, name } of COUNTIES) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        countySelect.append(option);
      }
      fillCities();

      const signalSelect = $('signal');
      for (const key of ['pass', 'warning', 'serious', 'unknown']) {
        const display = meta.signals[key];
        if (!display) continue;

        const option = document.createElement('option');
        option.value = key;
        // The shape travels as a character, not as styling. Desktop browsers
        // honour a coloured <option>; iOS and Android native pickers do not,
        // and a filter whose only cue disappears on a phone is not a filter.
        option.textContent = `${SHAPE_GLYPH[display.shape] || '●'}  ${display.label}`;
        option.style.color = display.color;
        signalSelect.append(option);
      }
      updateSignalMark();

      // The as-of date is derived from the last successful ingest, never from
      // the clock (FR-601). If the pipeline stops, this date stops with it —
      // which is exactly the signal v1 never gave anyone for three years.
      $('asof').textContent = meta.as_of
        ? `Data as of ${formatDate(meta.as_of.slice(0, 10))}`
        : 'No successful data load on record';
    } catch (err) {
      $('asof').textContent = 'Data date unavailable';
      setStatus(`Could not load map settings: ${err.message}`, 'error');

      /*
       * A map with no tiles is a grey rectangle, and the reader cannot tell
       * that from a broken site. Since the provider moved into /api/meta
       * (DEC-018), a failed meta call would leave exactly that — so fall back
       * to a basemap rather than to nothing. OSM's tiles are the right choice
       * here precisely because they need no key: this path runs when the
       * server could not tell us anything.
       */
      addBasemap({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors',
        max_zoom: 19,
      });
    }
  }

  /* ----------------------------------------------------------------- init --- */

  /** The tile layer, added once /api/meta says which provider to draw on. */
  function addBasemap(config) {
    if (!config || state.basemapAdded) return;
    state.basemapAdded = true;
    /*
     * Basemap history — DEC-013, D-014.
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
     * The provider itself is served by /api/meta rather than named here (D-014):
     * the licence question belongs with the decision that answers it, not in a
     * hardcoded host in the front end. Until meta arrives there is no tile
     * layer, which is why the map is created after it.
     */
    L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.max_zoom || 19,
    }).addTo(state.map);

    // The provider's own ceiling, now that we know it — CARTO serves 20, OSM 19.
    // The map was constructed with the conservative default so that clustering
    // could attach before any of this was known.
    if (config.max_zoom) state.map.setMaxZoom(config.max_zoom);
  }

  /**
   * Say what went wrong, in the page, where the reader is looking.
   *
   * A map that fails to initialise renders nothing at all: no tiles, no filter
   * menus, no city list — because every one of those is filled after the map is
   * built. That is indistinguishable from a broken site, and it is exactly what
   * the reader saw when the map library did not arrive. Silence is the one
   * failure mode this project refuses everywhere else; it should not be the
   * front end's either.
   */
  function fail(message, detail) {
    const status = $('status');
    if (status) {
      status.textContent = detail ? `${message} (${detail})` : message;
      status.dataset.tone = 'error';
    }
    const heading = $('results-heading');
    if (heading) heading.textContent = 'Map unavailable';
  }

  function init() {
    // The vendored libraries are served with a 30-day immutable cache, so a
    // copy that arrived truncated once stays truncated until a hard reload.
    // Name that rather than dying at the first L.map call.
    if (typeof L === 'undefined' || !L.map) {
      return fail('The map library did not load. Reload the page, bypassing the cache — Ctrl+Shift+R, or Cmd+Shift+R on a Mac.');
    }
    if (!L.markerClusterGroup) {
      return fail('The map clustering plugin did not load. Reload the page bypassing the cache — Ctrl+Shift+R, or Cmd+Shift+R on a Mac.');
    }

    try {
      return start();
    } catch (err) {
      return fail('The map could not start', err.message);
    }
  }

  function start() {
    state.map = L.map('map', {
      zoomControl: true,
      preferCanvas: false,
      /*
       * maxZoom is set here, explicitly, and it is load-bearing.
       *
       * Leaflet infers a map's maxZoom from its tile layers, and
       * markerClusterGroup refuses to attach to a map whose maxZoom is not
       * finite — it throws a bare string, "Map has no maxZoom specified",
       * which is not an Error and so carries no message to report.
       *
       * That is fine while the tile layer is added during startup. It stopped
       * being fine when the provider moved into /api/meta (DEC-018): the
       * layer now arrives after the fetch, so at this point the map has no
       * layers at all and the cluster group cannot attach. The whole page
       * dies with it, because every menu is filled further down.
       *
       * Naming it here decouples clustering from when the tiles arrive.
       * addBasemap raises it to the provider's own maximum once known.
       */
      maxZoom: 19,
    }).fitBounds(COUNTY_BOUNDS);

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
    // County first: refill the city menu, then search.
    $('county').addEventListener('change', () => { fillCities(); runSearch(); });
    $('city').addEventListener('change', runSearch);
    $('signal').addEventListener('change', () => { updateSignalMark(); runSearch(); });

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
