'use strict';

/**
 * In-process weekly refresh — MVP-SE-001 §6 task 12, E7.
 *
 * WHY THIS IS NOT A CRON JOB
 *
 * The plan says "weekly scheduled ingest", and on Render the obvious shape for
 * that is a Cron Job. It cannot be. From Render's own documentation:
 *
 *   "Cron jobs can't provision or access a persistent disk."
 *   "A persistent disk is accessible by only a single service instance."
 *
 * Our data is a SQLite file on a disk. A cron job is a separate service, so it
 * cannot see that file — it would ingest into its own ephemeral filesystem and
 * throw the result away on exit, reporting success every week. That is v1's
 * failure mode wearing new infrastructure, and it would be invisible.
 *
 * So the refresh runs inside the service that owns the disk. The cost is
 * measured and small: a full refresh — verify, ingest, geocode, basemap — took
 * 3.3 seconds against the real dataset. It runs once a week.
 *
 * HOW IT DECIDES TO RUN
 *
 * Not on a timer since boot. Render restarts services for its own reasons —
 * deploys, host moves, idling — and a naive `setInterval(WEEK)` would be reset
 * by each one, so a service that restarts every few days would never refresh at
 * all while looking perfectly healthy.
 *
 * Instead the schedule is derived from the data itself: the newest successful
 * ingest recorded in `ingest_run`. That survives restarts, because it is in the
 * database rather than in memory, and it is the same value the UI shows as the
 * as-of date. The question "is a refresh due" and the question "is the data
 * stale" therefore have exactly one answer, and it is the one the user sees.
 *
 * Disabled unless SAFE_EATS_SCHEDULE is set, so running the server locally
 * never reaches out to DBPR on its own.
 */

const { dataAsOf } = require('./db');
const { createRefreshRunner } = require('./refresh-runner');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How stale the data may get before a refresh is due. */
const REFRESH_AFTER = Number(process.env.SAFE_EATS_REFRESH_DAYS || 7) * DAY;

/** How often to ask whether one is due. Cheap: one indexed SELECT. */
const CHECK_EVERY = Number(process.env.SAFE_EATS_CHECK_HOURS || 1) * HOUR;

/**
 * Wait after boot before the first check, so a deploy serves traffic promptly
 * and a crash-loop cannot hammer DBPR — a service restarting every 30 seconds
 * must not issue an ingest every 30 seconds.
 */
const BOOT_DELAY = 2 * 60 * 1000;

const log = (...a) => console.log('[scheduler]', ...a);

function dueIn(db, now = Date.now()) {
  const asOf = dataAsOf(db);
  if (!asOf) return 0; // never successfully ingested — run as soon as we can

  const age = now - Date.parse(asOf);
  if (Number.isNaN(age)) return 0;
  return Math.max(0, REFRESH_AFTER - age);
}

function createScheduler(db, { runner = createRefreshRunner() } = {}) {
  let timer = null;

  /**
   * Starting a refresh is `runner`'s job, not the scheduler's. The overlap
   * guard lives there because the manual trigger on /admin.html is a second
   * caller, and a guard that only one of two callers consults is not a guard.
   */
  function runRefresh() {
    const started = Date.now();
    const { started: ok, reason } = runner.start({ trigger: 'scheduled' });
    if (!ok) return log(`${reason} — skipping this check`);

    log('refresh starting');

    const settle = setInterval(() => {
      if (runner.isRunning()) return;
      clearInterval(settle);

      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const { exit_code: code, note } = runner.state() ?? {};
      if (code === 0) log(`refresh ok in ${seconds}s`);
      else if (code === 2) log(`refresh ok in ${seconds}s, but something needs a look (exit 2)`);
      else log(`refresh FAILED in ${seconds}s (exit ${code ?? note}) — previous data is untouched`);
    }, 1000);
    settle.unref?.();
  }

  function check() {
    let remaining;
    try {
      remaining = dueIn(db);
    } catch (err) {
      // A scheduler that cannot read the clock must not take the server with it.
      return log(`could not determine refresh age: ${err.message}`);
    }

    if (remaining === 0) runRefresh();
    else log(`next refresh due in ${(remaining / DAY).toFixed(1)} day(s)`);
  }

  return {
    start() {
      if (!process.env.SAFE_EATS_SCHEDULE) {
        return log('disabled (set SAFE_EATS_SCHEDULE=1 to enable)');
      }
      log(
        `enabled — refresh when data is older than ${(REFRESH_AFTER / DAY).toFixed(0)} day(s), ` +
          `checked every ${(CHECK_EVERY / HOUR).toFixed(0)}h`
      );

      timer = setTimeout(function tick() {
        check();
        timer = setTimeout(tick, CHECK_EVERY);
        timer.unref?.();
      }, BOOT_DELAY);
      timer.unref?.();
    },

    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },

    /** The shared runner, so a caller that built its own scheduler can find it. */
    runner,

    // Exported for tests: the decision is pure given a database.
    dueIn: (now) => dueIn(db, now),
  };
}

module.exports = { createScheduler, REFRESH_AFTER, CHECK_EVERY };
