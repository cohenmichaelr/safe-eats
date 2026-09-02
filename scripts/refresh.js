'use strict';

/**
 * The weekly refresh — MVP-SE-001 §6 task 12, E7, FR-109.
 *
 * This is deliberately a plain script with an exit code rather than anything
 * host-specific. Whatever ends up scheduling it — cron, a systemd timer, a
 * platform's scheduler, a CI workflow — calls this and reads the code. The
 * hosting decision (OPEN-1) therefore does not block writing it, and changing
 * hosts later does not mean rewriting it.
 *
 * WHY THIS MATTERS MORE THAN "KEEPING DATA FRESH"
 *
 * DEC-010 established that the DBPR inspection extract is fiscal-year-to-date
 * and accumulating. Once the fiscal file rolls over, **our copy is the only
 * place the prior year exists**, because ingest upserts and never deletes. A
 * missed run is not a stale week; it is a permanent hole in the history. That
 * makes this script part of the data model, not an operational nicety.
 *
 * THE FAILURE THAT DEFINES IT
 *
 * v1's refresh "succeeded" every night for three years while serving 2022 data
 * (AUD F1). So this script's contract is the inverse:
 *
 *   exit 0   the data was refreshed and is verifiably newer than it was
 *   exit 1   something failed. Previous data and its as-of date are untouched,
 *            and the run is recorded as failed
 *   exit 2   the data is fine but a human needs to look at something —
 *            currently only the basemap canary (D-015)
 *
 * A run that changes nothing and reports success is the specific outcome this
 * refuses to produce: see the freshness assertion at the end.
 *
 *   node scripts/refresh.js [--skip-geocode] [--dry-run]
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { open, dataAsOf } = require('../src/db');

const ROOT = path.join(__dirname, '..');
const WEBHOOK = process.env.SAFE_EATS_ALERT_WEBHOOK;

const started = new Date();
const log = (...a) => console.log('[refresh]', ...a);

/**
 * Steps in order. `required` distinguishes "the data is wrong" from "something
 * else wants attention" — a basemap that needs eyes must not abort a data
 * refresh, and a failed ingest must not be softened into a warning.
 */
const STEPS = [
  {
    name: 'verify-sources',
    argv: ['scripts/verify-sources.js'],
    required: true,
    why: 'Every documented source is alive, is CSV, and has the pinned columns.',
  },
  {
    name: 'ingest',
    argv: ['src/ingest.js'],
    required: true,
    why: 'Fetch and load both extracts. Aborts rather than degrading.',
  },
  {
    name: 'geocode',
    argv: ['src/geocode.js'],
    required: true,
    skipFlag: '--skip-geocode',
    why: 'Resolve any address the previous run had not seen. Free tier only.',
  },
  {
    name: 'basemap',
    argv: ['scripts/check-basemap.js'],
    required: false,
    why: 'The map still has a map under it (D-015).',
  },
];

function runStep(step) {
  log(`── ${step.name} ${'─'.repeat(Math.max(0, 40 - step.name.length))}`);
  const t0 = Date.now();

  const result = spawnSync(process.execPath, [path.join(ROOT, ...step.argv[0].split('/'))], {
    cwd: ROOT,
    encoding: 'utf8',
    // Inherited stdio keeps each step's own reporting intact in the scheduler's
    // log. A refresh that swallows its steps' output is a refresh you cannot
    // debug from the only artefact you will have: the log.
    stdio: 'inherit',
    timeout: 15 * 60 * 1000,
  });

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const code = result.status;

  if (result.error) {
    log(`${step.name}: could not run — ${result.error.message}`);
    return { ...step, code: 1, seconds, note: result.error.message };
  }
  log(`${step.name}: exit ${code} in ${seconds}s`);
  return { ...step, code, seconds };
}

/**
 * Where a given outcome should be POSTed.
 *
 * Chat webhooks (Slack, Discord) carry the outcome in the message body — one
 * URL, and a human reads the words. Dead-man's-switch monitors do not work that
 * way: healthchecks.io decides up or down from **which URL you ping**, and a
 * plain ping means "success" no matter what the body says.
 *
 * So posting every outcome to the same healthchecks URL would mark the check
 * healthy on a failed refresh — a failure reported as success, which is the
 * precise fault this project exists to prevent. Failures go to `/fail`.
 *
 *   ok, needs-look  →  <ping-url>        the data pipeline did its job
 *   failed, stale   →  <ping-url>/fail   it did not
 *
 * `needs-look` pings success deliberately: the basemap needing human eyes does
 * not mean the refresh failed, and a monitor that cries wolf gets muted. The
 * detail travels in the body, which healthchecks.io records against the ping.
 */
const FAILURE_STATES = new Set(['failed', 'stale']);

function alertTarget(webhook, status) {
  if (!webhook) return null;

  let host;
  try {
    host = new URL(webhook).hostname.toLowerCase();
  } catch {
    return webhook; // not parseable as a URL; post it as given and let it fail loudly
  }

  // hc-ping.com is the hosted service; the env var covers a self-hosted instance,
  // whose hostname we cannot guess.
  const isHealthchecks =
    host === 'hc-ping.com' ||
    host.endsWith('.hc-ping.com') ||
    process.env.SAFE_EATS_ALERT_STYLE === 'healthchecks';

  if (!isHealthchecks) return webhook;
  return FAILURE_STATES.has(status) ? `${webhook.replace(/\/$/, '')}/fail` : webhook;
}

/**
 * Optional outbound alert. A webhook rather than an integration: it works with
 * Slack, Discord, healthchecks.io and anything else that accepts a POST, so it
 * does not become another thing to rewrite when OPEN-1 is decided.
 *
 * Best-effort by design — a refresh must not be reported as failed merely
 * because the notification failed. The exit code is the authoritative signal.
 */
async function alert(payload) {
  if (!WEBHOOK) return;
  const target = alertTarget(WEBHOOK, payload.status);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const where = target === WEBHOOK ? '' : ' (failure endpoint)';
      log(`alert posted${where} — HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log(`alert could not be delivered (${err.message}) — the exit code still stands`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  log(`starting ${started.toISOString()}`);

  let before = null;
  try {
    const db = open({ readonly: true });
    before = dataAsOf(db);
    db.close();
  } catch {
    // A first run against a database that does not exist yet is legitimate.
    log('no existing database — treating this as a first run');
  }
  log(`data as of ${before ?? '(none)'} before this run`);

  if (dryRun) {
    log('--dry-run: listing steps only');
    for (const s of STEPS) log(`  ${s.required ? 'required' : 'optional'}  ${s.name} — ${s.why}`);
    return;
  }

  const results = [];
  for (const step of STEPS) {
    if (step.skipFlag && argv.includes(step.skipFlag)) {
      log(`${step.name}: skipped (${step.skipFlag})`);
      continue;
    }

    const result = runStep(step);
    results.push(result);

    // A required step that failed stops the run. Continuing would geocode
    // against data an ingest just refused to load.
    if (result.code !== 0 && step.required) {
      log(`${step.name} failed — stopping. Previous data and its as-of date are untouched.`);
      await alert({
        text: `Safe Eats refresh FAILED at ${step.name} (exit ${result.code}). Data unchanged, as of ${before ?? 'none'}.`,
        status: 'failed',
        step: step.name,
        code: result.code,
        as_of: before,
      });
      process.exitCode = 1;
      return;
    }
  }

  /*
   * The freshness assertion — the whole reason this script is not just three
   * commands in a shell file.
   *
   * v1 reported success on every run while its data sat frozen for three years.
   * Every individual step can exit 0 and leave the data exactly as it was: a
   * source that serves a cached identical file, an ingest that upserts nothing
   * new. So "did it work" is not the union of the steps' exit codes — it is
   * whether the as-of date moved. This is the one check v1 never had.
   */
  let after = null;
  try {
    const db = open({ readonly: true });
    after = dataAsOf(db);
    db.close();
  } catch (err) {
    log(`could not read the as-of date back: ${err.message}`);
  }

  const advanced = after && after !== before;
  log(`data as of ${after ?? '(none)'} after this run`);

  const needsLook = results.filter((r) => r.code !== 0 && !r.required);

  if (!advanced) {
    log('');
    log('FAILED — the as-of date did not move. Every step reported success and the');
    log('data is no newer than it was. That combination is exactly how v1 served');
    log('2022 records for three years, so it is treated as a failure, not a no-op.');
    await alert({
      text: `Safe Eats refresh reported success but the as-of date did not move (still ${before ?? 'none'}).`,
      status: 'stale',
      as_of: before,
    });
    process.exitCode = 1;
    return;
  }

  const summary = `Safe Eats refresh OK — data now as of ${after} (was ${before ?? 'none'})`;
  log('');
  log(summary);

  if (needsLook.length) {
    const names = needsLook.map((r) => `${r.name} (exit ${r.code})`).join(', ');
    log(`NEEDS A LOOK — ${names}. The data is fine; something else wants human eyes.`);
    await alert({ text: `${summary}. Needs a look: ${names}.`, status: 'needs-look', as_of: after });
    process.exitCode = 2;
    return;
  }

  await alert({ text: summary, status: 'ok', as_of: after });
}

module.exports = { alertTarget };

// Only run when invoked directly. Without this guard, `require`-ing the module
// to test alertTarget would kick off a real ingest against live DBPR data.
if (require.main === module) {
  main().catch((err) => {
    console.error(`[refresh] unhandled failure: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
