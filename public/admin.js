'use strict';

/**
 * The manual refresh page.
 *
 * Deliberately dumb: it POSTs, then polls. A refresh takes seconds to minutes
 * and runs in a child process the server does not hold open, so the POST's
 * response can only ever mean "accepted". Whether it *worked* comes from the
 * as-of date moving, which is the same thing scripts/refresh.js asserts and the
 * same thing the map shows. There is only one definition of success here.
 *
 * There is no sign-in: the routes are open by an explicit decision (see the
 * comment above them in src/server.js). Anyone who reaches this page can start
 * a refresh.
 */

const $ = (id) => document.getElementById(id);

const refreshForm = $('refresh-form');
const countySelect = $('county');
const skipGeocode = $('skip-geocode');
const runButton = $('run');
const statusLine = $('status');

/** Poll only while something is running; a static page must not tick forever. */
const POLL_MS = 2000;
let timer = null;

/** Same-origin fetch that carries the session cookie and never caches. */
const api = (url, options = {}) =>
  fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });

function say(message, tone) {
  statusLine.textContent = message || '';
  if (tone) statusLine.dataset.tone = tone;
  else delete statusLine.dataset.tone;
}

const stamp = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const counties = new Map();
const countyLabel = (code) => counties.get(String(code)) ?? String(code);

function renderCounties(list) {
  if (counties.size || !list) return; // the list is fixed; fill it once
  for (const { code, name } of list) {
    counties.set(String(code), name);
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    countySelect.append(option);
  }
}

function renderRun(run) {
  const outcome = run ? (run.running ? 'running' : run.outcome) : null;

  const label = {
    running: 'Running…',
    ok: 'Success — the as-of date moved',
    'needs-look': 'Data refreshed, but something needs a look (exit 2)',
    failed: 'FAILED — previous data is untouched',
  }[outcome] ?? 'No refresh has run since the server started';

  const cell = $('f-status');
  cell.textContent = '';
  const tag = document.createElement('span');
  tag.className = 'tag';
  if (outcome) tag.dataset.outcome = outcome;
  tag.textContent = label;
  cell.append(tag);
  if (run?.note) cell.append(` — ${run.note}`);

  $('f-started').textContent = stamp(run?.started_at);
  $('f-finished').textContent = stamp(run?.finished_at);
  $('f-scope').textContent = run
    ? (run.counties?.length ? run.counties.map(countyLabel).join(', ') : 'All counties')
    : '—';
  $('f-trigger').textContent = run ? (run.trigger === 'scheduled' ? 'Weekly schedule' : 'Manual') : '—';

  // Keep the log pinned to the bottom only if the reader already was there —
  // scrolling back to read an error must not be yanked away by the next line.
  const log = $('log');
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.textContent = (run?.log ?? []).join('\n');
  if (pinned) log.scrollTop = log.scrollHeight;
}

function setBusy(busy) {
  runButton.disabled = busy;
  runButton.textContent = busy ? 'Refreshing…' : 'Refresh data now';
}

async function poll() {
  let res;
  try {
    res = await api('/api/admin/refresh');
  } catch (err) {
    return say(`Could not reach the server: ${err.message}`, 'error');
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    setBusy(false);
    return say(body.error || `Server returned ${res.status}.`, 'error');
  }

  renderCounties(body.counties);
  renderRun(body.run);

  $('asof').textContent = body.as_of
    ? `Data as of ${stamp(body.as_of)}`
    : 'No successful ingest recorded';

  const running = Boolean(body.run?.running);
  setBusy(running);

  clearTimeout(timer);
  if (running) timer = setTimeout(poll, POLL_MS);
  return undefined;
}

refreshForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(true);
  say('Starting…');

  let res;
  try {
    res = await api('/api/admin/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        county: countySelect.value,
        skip_geocode: skipGeocode.checked,
      }),
    });
  } catch (err) {
    setBusy(false);
    return say(`Could not reach the server: ${err.message}`, 'error');
  }

  const body = await res.json().catch(() => ({}));

  if (res.status === 409) {
    // Not an error the operator caused — the weekly schedule got there first.
    say('A refresh is already running; watching it instead.');
  } else if (!res.ok) {
    setBusy(false);
    return say(body.error || `Server returned ${res.status}.`, 'error');
  } else {
    const scope = countySelect.value === 'all' ? 'all counties' : countyLabel(countySelect.value);
    say(`Refresh started for ${scope}. This takes a few seconds to a few minutes.`);
  }

  renderRun(body.run);
  return poll();
});

poll();
