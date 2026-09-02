'use strict';

/**
 * Safe Eats map — Task 9 · FR-401, FR-403, FR-404, FR-406.
 *
 * Everything drawn here comes from our own API (FR-403). The page makes exactly
 * three kinds of request: `/api/meta` once, `/api/establishments?bbox=` per
 * viewport, and basemap tiles from CARTO. There is no Places lookup, no
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
  };

  /* ------------------------------------------------------------- markers --- */

  /**
   * FR-404 — colour AND shape. Rendered as inline SVG rather than a coloured
   * dot so the mark survives greyscale, colour-blindness, and a phone screen in
   * sunlight. The white stroke keeps every shape legible against both the pale
   * basemap and a dark park polygon.
   */
  function shapeSvg(shape, color, size) {
    const s = size;
    const c = s / 2;
    const r = s * 0.42;
    const common = `fill="${color}" stroke="#ffffff" stroke-width="${Math.max(1, s * 0.11)}" stroke-linejoin="round"`;

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
      `</div>`
    );
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
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

  async function loadMeta() {
    try {
      const res = await fetch('/api/meta');
      const meta = await res.json();
      if (!res.ok) throw new Error(meta.error || 'meta unavailable');

      LEGEND = meta.signals || {};
      windowStart = meta.inspection_window_start || null;
      renderLegend();

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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO',
      subdomains: 'abcd',
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

    $('search-area').addEventListener('click', load);

    $('results-list').addEventListener('click', (event) => {
      const link = event.target.closest('a[data-id]');
      if (!link) return;
      event.preventDefault();
      const marker = state.markersById?.get(link.dataset.id);
      if (!marker) return;
      state.cluster.zoomToShowLayer(marker, () => marker.openPopup());
    });

    loadMeta().then(load);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
