'use strict';

/**
 * The raw data browser.
 *
 * Its one rule: show what is in the database, and shape nothing. Where the map
 * page turns a disposition into a colour and a date into "3 months ago", this
 * page prints the disposition and the date. The moment it starts interpreting,
 * it stops being the thing you open when the map looks wrong.
 *
 * Sign-in is the same session cookie /admin.html uses — see src/admin-session.js
 * for why the raw rows are gated at all (DEC-009: the extract contains licence
 * types this product deliberately does not publish).
 */

const $ = (id) => document.getElementById(id);

const signinForm = $('signin-form');
const passwordInput = $('password');
const queryForm = $('query-form');
const statusLine = $('status');
const tbody = $('rows');

const PAGE = 100;
let offset = 0;
let total = 0;
let facetsLoaded = false;
let selectedId = null;

const api = (url, options = {}) =>
  fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });

function say(message, tone) {
  statusLine.textContent = message || '';
  if (tone) statusLine.dataset.tone = tone;
  else delete statusLine.dataset.tone;
}

function showSignIn(required) {
  signinForm.hidden = !required;
  queryForm.hidden = required;
  if (required) passwordInput.focus();
}

/** Blank cells say "empty in the source", which is itself a finding. */
function cell(row, value, className) {
  const td = document.createElement('td');
  if (value === null || value === undefined || value === '') {
    td.textContent = '—';
    td.className = 'muted';
  } else {
    td.textContent = String(value);
    if (className) td.className = className;
  }
  row.append(td);
}

function renderRows(rows) {
  tbody.textContent = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 14;
    td.className = 'muted';
    td.textContent = 'No rows match.';
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.dataset.id = row.establishment_id;
    if (row.establishment_id === selectedId) tr.setAttribute('aria-selected', 'true');

    cell(tr, row.name);
    cell(tr, row.address);
    cell(tr, row.city);
    cell(tr, row.zip);
    cell(tr, row.county_name || row.county_code);
    cell(tr, row.license_type_code);
    cell(tr, row.license_number);
    cell(tr, row.inspection_date);
    cell(tr, row.disposition);
    cell(tr, row.signal);
    cell(tr, row.inspection_count, 'num');
    cell(tr, row.lat === null ? null : row.lat.toFixed(6), 'num');
    cell(tr, row.lng === null ? null : row.lng.toFixed(6), 'num');
    cell(tr, row.geocode_quality);

    const open = () => showRecord(row.establishment_id);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    tbody.append(tr);
  }
}

function fillFacets(body) {
  if (facetsLoaded) return;
  facetsLoaded = true;

  for (const { code, name, n } of body.counties) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${name} (${n.toLocaleString()})`;
    $('county').append(option);
  }
  for (const { code, name, n } of body.types) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} — ${name} (${n.toLocaleString()})`;
    $('type').append(option);
  }
}

function params() {
  const search = new URLSearchParams();
  const q = $('q').value.trim();
  if (q) search.set('q', q);
  if ($('county').value) search.set('county', $('county').value);
  if ($('type').value) search.set('type', $('type').value);
  if ($('geocoded').value) search.set('geocoded', $('geocoded').value);
  search.set('limit', String(PAGE));
  search.set('offset', String(offset));
  return search;
}

async function load() {
  let res;
  try {
    res = await api(`/api/admin/data?${params()}`);
  } catch (err) {
    return say(`Could not reach the server: ${err.message}`, 'error');
  }

  const body = await res.json().catch(() => ({}));

  if (res.status === 401 && body.auth === 'password') {
    showSignIn(true);
    return say('');
  }
  if (!res.ok) return say(body.error || `Server returned ${res.status}.`, 'error');

  showSignIn(false);
  say('');
  fillFacets(body);
  renderRows(body.rows);

  total = body.total;
  $('asof').textContent = body.as_of
    ? `Data as of ${new Date(body.as_of).toLocaleString()}`
    : 'No successful ingest recorded';

  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + body.rows.length, total);
  $('count').innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = total.toLocaleString();
  $('count').append(strong, ` row${total === 1 ? '' : 's'} match`);
  $('range').textContent = total ? `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}` : '';

  $('prev').disabled = offset === 0;
  $('next').disabled = last >= total;
  return undefined;
}

/** One establishment, printed exactly as the API returns it. */
async function showRecord(establishmentId) {
  selectedId = establishmentId;
  for (const tr of tbody.querySelectorAll('tr')) {
    if (tr.dataset.id === establishmentId) tr.setAttribute('aria-selected', 'true');
    else tr.removeAttribute('aria-selected');
  }

  const res = await api(`/api/admin/data/${encodeURIComponent(establishmentId)}`);
  const body = await res.json().catch(() => ({}));

  if (!res.ok) return say(body.error || `Server returned ${res.status}.`, 'error');

  $('record').hidden = false;
  $('record-title').textContent = `${body.establishment.name} — raw record`;
  $('record-body').textContent = JSON.stringify(body, null, 2);

  const links = $('record-links');
  links.textContent = '';

  // Why a row might be missing from the map, stated rather than left to be
  // inferred from a licence type code.
  const note = document.createElement('span');
  note.textContent = body.establishment.displayed
    ? 'Shown on the map.'
    : `Not shown on the map — licence type ${body.establishment.license_type_code} (${body.establishment.license_type_name}).`;
  links.append(note);

  if (body.establishment.lat !== null && body.establishment.displayed) {
    const link = document.createElement('a');
    link.href = `/#${encodeURIComponent(establishmentId)}`;
    link.textContent = 'Open on the map';
    links.append(link);
  }

  $('record').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return undefined;
}

queryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  offset = 0;
  load();
});

$('clear').addEventListener('click', () => {
  $('q').value = '';
  $('county').value = '';
  $('type').value = '';
  $('geocoded').value = '';
  offset = 0;
  load();
});

$('prev').addEventListener('click', () => {
  offset = Math.max(0, offset - PAGE);
  load();
});

$('next').addEventListener('click', () => {
  if (offset + PAGE < total) offset += PAGE;
  load();
});

signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  say('Signing in…');

  const res = await api('/api/admin/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: passwordInput.value }),
  }).catch(() => null);

  if (!res) return say('Could not reach the server.', 'error');

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    passwordInput.select();
    return say(body.error || 'Sign-in failed.', 'error');
  }

  passwordInput.value = '';
  return load();
});

load();
