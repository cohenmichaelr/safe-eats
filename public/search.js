'use strict';

/**
 * Safe Eats search — FR-407, FR-503, FR-508.
 *
 * The map answers "what is near here". This page answers "find me this place,
 * wherever it is", which is a different question and a bad fit for a viewport:
 * a name search matching 40 establishments across six counties has no bounding
 * box worth showing, and the map's results list is a companion to the pins
 * rather than something you can page through.
 *
 * So: the same four filters the map has, plus an ordering and paging, over the
 * whole 54,296-row displayed population — and a row that expands in place to
 * the establishment's full published inspection history, so checking three
 * places against each other does not mean opening and closing three panels.
 *
 * Everything drawn here comes from our own API. Three endpoints: /api/meta
 * once, /api/cities per county, /api/search per query, and
 * /api/establishments/:id when a row is opened. No external call, no key
 * (DEC-002, DEC-008).
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const {
    markSvg, SHAPE_GLYPH, label, countyName, formatDate, plainLine, escapeHtml,
    detailBodyHtml,
  } = window.SafeEats;

  /**
   * 25 rows a page.
   *
   * The API will serve 10,000, and the map asks for far more than this because
   * it is drawing pins rather than paragraphs. Here every row carries a name,
   * an address, a verdict and a plain-language sentence, and a page of those
   * is something a person reads rather than scrolls past. 25 also keeps the
   * pager meaningful: "1–25 of 3,412" is a fact about the result set, where a
   * single 200-row page reads as if it were the whole answer.
   */
  const PAGE_SIZE = 25;

  /** The filters that travel in the URL, in the order they appear in the form. */
  const FIELDS = ['q', 'county', 'city', 'cuisine', 'signal', 'sort'];

  /** key -> label for the food types, as published by /api/meta. */
  let CUISINES = new Map();

  const state = {
    offset: 0,
    total: 0,
    shown: 0,
    inFlight: null,
    /**
     * The filters that produced the rows currently on screen.
     *
     * The pager reads this rather than the form, because the two can disagree:
     * edit the county on page 3 without pressing Search and the form says
     * Baker while the list still says Palm Beach. Paging from the form would
     * then ask for rows 75-99 of a county that has nine, and answer a Next
     * click with an empty page. Next means "more of what I am looking at".
     */
    query: null,
    /** establishment_id → the /api/establishments/:id body, fetched once. */
    details: new Map(),
    ready: false,
  };

  /* ------------------------------------------------------------ the form --- */

  function readForm() {
    const params = new URLSearchParams();
    for (const id of FIELDS) {
      const value = ($(id).value || '').trim();
      // 'name' is the API's default ordering, so leaving it out keeps a plain
      // search's URL short enough to read.
      if (value && !(id === 'sort' && value === 'name')) params.set(id, value);
    }
    return params;
  }

  function writeForm(params) {
    for (const id of FIELDS) $(id).value = params.get(id) || '';
    if (!$('sort').value) $('sort').value = 'name';
    updateSignalMark();
  }

  function updateSignalMark() {
    const value = $('signal').value;
    $('signal-mark').innerHTML = value ? markSvg(value, 15) : '';
  }

  /**
   * The city menu, refilled whenever the county changes.
   *
   * Cities are per county deliberately (see /api/cities): statewide there are
   * 942 of them, South Florida repeats its town names across county lines, and
   * a menu of every city in Florida is not a menu anyone can use. With no
   * county chosen the control says so rather than sitting there empty and
   * looking broken.
   */
  async function fillCities(preselect) {
    const select = $('city');
    const county = $('county').value;

    if (!county) {
      select.innerHTML = '<option value="">Choose a county first</option>';
      select.disabled = true;
      return;
    }

    select.disabled = true;
    select.innerHTML = '<option value="">Loading cities…</option>';

    try {
      const res = await fetch(`/api/cities?county=${encodeURIComponent(county)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'cities unavailable');

      select.innerHTML = '<option value="">All cities in this county</option>';
      for (const { city, label: name, n } of body.cities) {
        const option = document.createElement('option');
        option.value = city;
        option.textContent = `${name} (${n})`;
        select.append(option);
      }
      select.disabled = false;
      if (preselect) select.value = preselect;
    } catch (err) {
      select.innerHTML = '<option value="">Cities unavailable</option>';
    }
  }

  /* ------------------------------------------------------------- results --- */

  /**
   * One result row: a summary that is complete on its own, and a button that
   * expands it to the full record.
   *
   * The summary carries the verdict and the plain line, not just the name —
   * FR-406's whole point is that a reader should not have to open anything to
   * learn what the state found. The expansion is for the history behind it.
   */
  function rowHtml(pin, index) {
    /*
     * The DOM id is the row's position, NOT the establishment id.
     *
     * An establishment id is `6020660|2010|2600 BROADWAY, WEST PALM BEACH,
     * 33407` — it contains spaces, and an HTML id may not. `getElementById`
     * matches it anyway, by literal string, which is exactly what makes this
     * worth a comment: the expansion worked in every manual test while
     * `aria-controls` was silently broken. That attribute is a space-separated
     * list of id references, so the browser read one id as six, none of which
     * existed, and the disclosure relationship reached no screen reader at all.
     *
     * The real id stays on `data-detail-id`, where a space is just a character.
     */
    const id = escapeHtml(pin.id);
    const place = [pin.city_label || pin.city, `${countyName(pin.county_code)} County`]
      .filter(Boolean)
      .join(' · ');

    return (
      `<li class="find__row" id="row-${index}">` +
      `<div class="find__summary">` +
      `<p class="find__name">${escapeHtml(pin.name)}</p>` +
      `<p class="find__addr">${escapeHtml(pin.address || 'No street address published')}<span class="find__place">${escapeHtml(place)}</span></p>` +
      `<p class="find__verdict">${markSvg(pin.signal, 15)} <span>${escapeHtml(label(pin.signal))}</span>` +
      (pin.last_inspection_date
        ? `<span class="find__when">${escapeHtml(formatDate(pin.last_inspection_date))}</span>`
        : '') +
      `</p>` +
      `<p class="find__plain">${escapeHtml(plainLine(pin))}</p>` +
      `</div>` +
      `<button type="button" class="find__toggle" aria-expanded="false"` +
      ` aria-controls="detail-${index}" data-detail-id="${id}">` +
      `<span class="find__toggle-text">See all inspections</span>` +
      `</button>` +
      `<div class="find__detail" id="detail-${index}" hidden></div>` +
      `</li>`
    );
  }

  function renderRows(pins) {
    const list = $('results-list');
    list.innerHTML = pins.map(rowHtml).join('');
    // A new page of results invalidates nothing in the cache — an id's record
    // does not change between pages — but the open/closed state is per render.
    list.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /**
   * Expand a row. The record is fetched once and kept, because a reader
   * comparing two places will open, close and reopen both.
   */
  async function toggleDetail(button) {
    const id = button.dataset.detailId;
    const region = $(button.getAttribute('aria-controls'));
    const open = button.getAttribute('aria-expanded') === 'true';

    if (open) {
      button.setAttribute('aria-expanded', 'false');
      button.querySelector('.find__toggle-text').textContent = 'See all inspections';
      region.hidden = true;
      return;
    }

    button.setAttribute('aria-expanded', 'true');
    button.querySelector('.find__toggle-text').textContent = 'Hide inspections';
    region.hidden = false;

    if (state.details.has(id)) {
      region.innerHTML = detailBodyHtml(state.details.get(id));
      return;
    }

    region.innerHTML = '<p class="panel__plain">Loading…</p>';
    try {
      const res = await fetch(`/api/establishments/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      state.details.set(id, data);
      region.innerHTML = detailBodyHtml(data);
    } catch (err) {
      region.innerHTML =
        `<p class="panel__plain">Could not load the inspection history: ${escapeHtml(err.message)}</p>`;
    }
  }

  /* -------------------------------------------------------------- search --- */

  function describe(query) {
    const bits = [];
    if (query.q) bits.push(`matching “${escapeHtml(query.q)}”`);
    // "named as", not "serving" — the filter matched the licensed name, and
    // the sentence summarising the results has to say the same thing the
    // control does (DEC-019).
    if (query.cuisine) {
      bits.push(`named as ${escapeHtml(CUISINES.get(query.cuisine) || query.cuisine)}`);
    }
    if (query.city) bits.push(`in ${escapeHtml(query.city)}`);
    if (query.county && !query.city) bits.push(`in ${escapeHtml(countyName(query.county))} County`);
    if (query.signal) bits.push(`with result “${escapeHtml(label(query.signal))}”`);
    return bits.length ? bits.join(' ') : 'in Florida';
  }

  function renderPager() {
    const pager = $('pager');
    if (!state.total) {
      pager.hidden = true;
      return;
    }

    const first = state.offset + 1;
    const last = state.offset + state.shown;
    pager.hidden = false;
    $('pagecount').textContent = `${first.toLocaleString()}–${last.toLocaleString()} of ${state.total.toLocaleString()}`;
    $('prev').disabled = state.offset === 0;
    $('next').disabled = last >= state.total;
  }

  /**
   * @param {object} opts
   * @param {number} [opts.offset]  where in the result set to start
   * @param {boolean} [opts.push]   add a history entry, so Back returns to the
   *   previous query rather than leaving the page entirely
   */
  async function runSearch({ offset = 0, push = true, params = readForm() } = {}) {
    if (!state.ready) return;

    state.offset = offset;

    // What travels in the URL is the query, not the page — but the page has to
    // travel too, or Back from page 3 lands on page 1 and looks like a bug.
    const url = new URLSearchParams(params);
    if (offset) url.set('offset', String(offset));
    const href = url.toString() ? `?${url}` : location.pathname;
    if (push) history.pushState(null, '', href);
    else history.replaceState(null, '', href);

    const request = new URLSearchParams(params);
    request.set('limit', String(PAGE_SIZE));
    if (offset) request.set('offset', String(offset));

    if (state.inFlight) state.inFlight.abort();
    const controller = new AbortController();
    state.inFlight = controller;

    $('scope').textContent = 'Searching…';

    try {
      const res = await fetch(`/api/search?${request}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`);

      state.total = body.total;
      state.shown = body.establishments.length;
      // Only now, once these rows are the ones on screen, does the pager's idea
      // of the query become this one.
      state.query = params;
      state.details.clear();

      renderRows(body.establishments);

      $('scope').innerHTML = body.total
        ? `<b>${body.total.toLocaleString()}</b> establishment${body.total === 1 ? '' : 's'} ${describe(body.query)}.`
        : `No establishments ${describe(body.query)}. ` +
          (body.query.cuisine
            ? `Food type is read from the licensed name, and most names do not say what they serve — ` +
              `so this does not mean there are none.`
            : `The state publishes under the licensed business name, which is not always the name on the sign.`);

      renderPager();
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('scope').textContent = `Search failed: ${err.message}`;
      $('results-list').innerHTML = '';
      $('pager').hidden = true;
    } finally {
      if (state.inFlight === controller) state.inFlight = null;
    }
  }

  function clearSearch() {
    for (const id of FIELDS) $(id).value = '';
    $('sort').value = 'name';
    fillCities();
    updateSignalMark();
    state.total = 0;
    state.shown = 0;
    $('results-list').innerHTML = '';
    $('scope').textContent = '';
    $('pager').hidden = true;
    history.pushState(null, '', location.pathname);
  }

  /* ---------------------------------------------------------------- boot --- */

  async function loadMeta() {
    const res = await fetch('/api/meta');
    const meta = await res.json();
    if (!res.ok) throw new Error(meta.error || 'meta unavailable');

    SafeEats.configure(meta);

    // Every menu is built from the API, never hardcoded: the counties are
    // whatever is loaded, the result options are whatever src/signal.js
    // defines, and the orderings are whatever /api/search will accept.
    const countySelect = $('county');
    for (const { code, name } of SafeEats.counties()) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${name} County`;
      countySelect.append(option);
    }

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

    const cuisineSelect = $('cuisine');
    for (const { key, label: name } of meta.cuisines || []) {
      CUISINES.set(key, name);
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      cuisineSelect.append(option);
    }

    const sortSelect = $('sort');
    for (const { key, label: name } of meta.sorts || [{ key: 'name', label: 'Name (A–Z)' }]) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      sortSelect.append(option);
    }

    // The as-of date is derived from the last successful ingest, never from the
    // clock (FR-601). If the pipeline stops, this date stops with it.
    $('asof').textContent = meta.as_of
      ? `Data as of ${formatDate(meta.as_of.slice(0, 10))}`
      : 'No successful data load on record';
  }

  /** Restore a query from the URL, so a result page can be linked and shared. */
  async function applyUrl({ push = false } = {}) {
    const params = new URLSearchParams(location.search);
    writeForm(params);
    await fillCities(params.get('city'));
    writeForm(params);

    const hasQuery = FIELDS.some((id) => params.get(id));
    if (!hasQuery) {
      $('results-list').innerHTML = '';
      $('scope').textContent = '';
      $('pager').hidden = true;
      return;
    }

    const offset = Number(params.get('offset')) || 0;
    await runSearch({ offset, push });
  }

  async function start() {
    try {
      await loadMeta();
    } catch (err) {
      $('asof').textContent = 'Data date unavailable';
      $('scope').textContent = `Could not load search settings: ${err.message}`;
      return;
    }

    state.ready = true;

    $('find-form').addEventListener('submit', (event) => {
      event.preventDefault();
      runSearch({ offset: 0 });
    });

    $('clear').addEventListener('click', clearSearch);
    $('county').addEventListener('change', () => fillCities());
    $('signal').addEventListener('change', updateSignalMark);

    // A changed ordering re-asks the same question, so it runs immediately
    // rather than waiting for the button — but only once there are results to
    // reorder, or it fires a search nobody asked for on page load.
    $('sort').addEventListener('change', () => {
      if (state.total) runSearch({ offset: 0 });
    });

    // Both page the result set on screen, not whatever the form now says.
    $('prev').addEventListener('click', () => {
      runSearch({ offset: Math.max(0, state.offset - PAGE_SIZE), params: state.query || undefined });
    });
    $('next').addEventListener('click', () => {
      runSearch({ offset: state.offset + PAGE_SIZE, params: state.query || undefined });
    });

    $('results-list').addEventListener('click', (event) => {
      const button = event.target.closest('.find__toggle');
      if (button) toggleDetail(button);
    });

    window.addEventListener('popstate', () => applyUrl({ push: false }));

    await applyUrl({ push: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
