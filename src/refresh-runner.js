'use strict';

/**
 * The single owner of "a refresh is running" — E7, FR-109.
 *
 * `scripts/refresh.js` is the refresh. This module is only the thing that
 * starts it, and it exists for one reason: as of the manual trigger there are
 * now two callers — the weekly scheduler and the operator pressing a button on
 * /admin.html. The scheduler used to hold its own `running` flag, which was a
 * correct guard for exactly as long as it was the only caller.
 *
 * Two ingests writing the same rows concurrently is not a case the invariants
 * were designed against, and it must not be reachable by clicking a button
 * while the Monday run is in flight. So the guard moves here, both callers
 * share one instance, and "already running" is a state the API can report
 * rather than a race it can lose.
 *
 * The child process is deliberate, not incidental: a refresh that throws, leaks
 * or exhausts memory must not take the web service down with it. The map
 * staying up on last week's data is a far better failure than the map going
 * away.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const { COUNTIES } = require('./display');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'refresh.js');

/** How much of the child's output to keep for the admin page. */
const LOG_LINES = 300;

/** Hard stop, matching the per-step timeout in refresh.js with headroom. */
const RUN_TIMEOUT = 30 * 60 * 1000;

/**
 * The exit-code contract is `scripts/refresh.js`'s, restated in one place so the
 * UI never has to know that 2 is not a failure:
 *
 *   0  refreshed, and the as-of date verifiably moved
 *   1  a required step failed, or the date did NOT move (v1's exact failure)
 *   2  the data is fine; something else wants human eyes (the basemap canary)
 */
function outcomeFor(code) {
  if (code === 0) return 'ok';
  if (code === 2) return 'needs-look';
  return 'failed';
}

/** Codes must be known counties — a typo would refresh nothing and look fine. */
function assertCounties(counties) {
  const unknown = counties.filter((c) => !(String(c) in COUNTIES));
  if (unknown.length) {
    const err = new Error(`Not a displayed county: ${unknown.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

function createRefreshRunner({
  script = SCRIPT,
  cwd = ROOT,
  spawnFn = spawn,
  logLines = LOG_LINES,
  echo = (line) => console.log(line),
} = {}) {
  /**
   * One record, updated in place and left behind when the child exits, so a
   * page loaded after the fact still shows how the last run went. `null` until
   * a refresh has been started in this process — which is not the same as "the
   * data has never been refreshed", and the API keeps them distinct.
   */
  let run = null;
  let child = null;

  const snapshot = () => (run ? { ...run, log: [...run.log] } : null);

  function append(chunk, stream) {
    if (!run) return;
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      run.log.push(line);
      if (run.log.length > logLines) run.log.shift();
      echo(stream === 'stderr' ? `[refresh:err] ${line}` : line);
    }
  }

  function start({ counties, trigger = 'manual', skipGeocode = false } = {}) {
    const scope = (counties ?? []).map(String).filter(Boolean);
    assertCounties(scope);

    if (run?.running) {
      return { started: false, reason: 'A refresh is already running.', run: snapshot() };
    }

    const argv = [script];
    if (skipGeocode) argv.push('--skip-geocode');

    run = {
      running: true,
      trigger,
      // An empty scope means "whatever ingest.js is configured for", which is
      // every county in scope. Recorded as [] rather than expanded, so the
      // record says what was asked for rather than what it resolved to today.
      counties: scope,
      started_at: new Date().toISOString(),
      finished_at: null,
      exit_code: null,
      outcome: null,
      note: null,
      log: [],
    };

    try {
      child = spawnFn(process.execPath, argv, {
        cwd,
        // The county scope reaches ingest.js the same way it does on the command
        // line: through the environment it already reads (SAFE_EATS_COUNTY_CODES).
        // No new plumbing, and `npm run refresh` stays the same program.
        env: scope.length
          ? { ...process.env, SAFE_EATS_COUNTY_CODES: scope.join(',') }
          : { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: RUN_TIMEOUT,
      });
    } catch (err) {
      run.running = false;
      run.finished_at = new Date().toISOString();
      run.outcome = 'failed';
      run.note = `could not start: ${err.message}`;
      return { started: false, reason: run.note, run: snapshot() };
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c) => append(c, 'stdout'));
    child.stderr?.on('data', (c) => append(c, 'stderr'));

    child.on('error', (err) => {
      if (!run) return;
      run.running = false;
      run.finished_at = new Date().toISOString();
      run.outcome = 'failed';
      run.note = err.message;
      child = null;
    });

    child.on('close', (code, signal) => {
      if (!run) return;
      run.running = false;
      run.finished_at = new Date().toISOString();
      // A killed child has a null code. Treating that as anything but a failure
      // would be reporting success for a run that did not finish.
      run.exit_code = code;
      run.outcome = code === null ? 'failed' : outcomeFor(code);
      if (signal) run.note = `terminated by ${signal}`;
      child = null;
    });

    return { started: true, run: snapshot() };
  }

  return {
    start,
    state: snapshot,
    isRunning: () => Boolean(run?.running),
    /** Tests and shutdown; a refresh is never cancelled by a user request. */
    stop() {
      child?.kill('SIGTERM');
    },
  };
}

module.exports = { createRefreshRunner, outcomeFor, LOG_LINES };
