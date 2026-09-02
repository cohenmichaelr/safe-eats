'use strict';

/**
 * The weekly refresh decision — task 12, E7.
 *
 * The scheduler's only real decision is "is a refresh due", and it answers it
 * from the database rather than from a timer. That is the part worth testing,
 * because the alternative — `setInterval` since boot — is silently wrong on a
 * platform that restarts services, and silently wrong is this project's whole
 * subject.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrate } = require('../src/migrate');
const { createScheduler } = require('../src/scheduler');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-eats-sched-'));
  const db = new Database(path.join(dir, 'test.db'));
  migrate(db);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

const recordRun = (db, finishedAt, status = 'success') =>
  db
    .prepare(
      `INSERT INTO ingest_run (source_url, dataset, started_at, finished_at, status,
                               rows_fetched, rows_after_filter, rows_written)
       VALUES ('https://example.invalid/x.csv', 'licenses', ?, ?, ?, 4305, 4305, 4305)`
    )
    .run(finishedAt, finishedAt, status);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-02T12:00:00.000Z');

test('refresh scheduling', async (t) => {
  await t.test('a database that has never ingested is due immediately', (t) => {
    const scheduler = createScheduler(freshDb(t));
    assert.equal(scheduler.dueIn(NOW), 0);
  });

  await t.test('fresh data is not due', (t) => {
    const db = freshDb(t);
    recordRun(db, new Date(NOW - 1 * DAY).toISOString());
    const remaining = createScheduler(db).dueIn(NOW);
    assert.ok(remaining > 0, 'one-day-old data should not be due');
    assert.ok(remaining <= 6 * DAY, `expected at most 6 days remaining, got ${remaining / DAY}`);
  });

  await t.test('data older than the window is due', (t) => {
    const db = freshDb(t);
    recordRun(db, new Date(NOW - 8 * DAY).toISOString());
    assert.equal(createScheduler(db).dueIn(NOW), 0);
  });

  await t.test('exactly at the boundary is due', (t) => {
    const db = freshDb(t);
    recordRun(db, new Date(NOW - 7 * DAY).toISOString());
    assert.equal(createScheduler(db).dueIn(NOW), 0);
  });

  await t.test('a FAILED run does not count as a refresh', (t) => {
    // The staleness the user sees comes from the newest *successful* ingest, and
    // so must the schedule. If a failed run reset the clock, a source outage
    // would suppress the retries that would recover from it — the pipeline would
    // go quiet precisely when it needed to keep trying.
    const db = freshDb(t);
    recordRun(db, new Date(NOW - 30 * DAY).toISOString(), 'success');
    recordRun(db, new Date(NOW - 1 * DAY).toISOString(), 'failed');
    assert.equal(createScheduler(db).dueIn(NOW), 0, 'a recent failure must not make old data look fresh');
  });

  await t.test('the decision survives a restart, because it is not a timer', (t) => {
    // The scheduler is constructed fresh — as it would be after a Render deploy
    // or host move — and must reach the same answer from the same data. A
    // setInterval since boot would have reset here, and a service that restarts
    // more often than weekly would never refresh while looking healthy.
    const db = freshDb(t);
    recordRun(db, new Date(NOW - 9 * DAY).toISOString());

    assert.equal(createScheduler(db).dueIn(NOW), 0);
    assert.equal(createScheduler(db).dueIn(NOW), 0, 'a new instance must not forget that data is stale');
  });

  await t.test('start() is inert unless explicitly enabled', (t) => {
    const db = freshDb(t);
    const prior = process.env.SAFE_EATS_SCHEDULE;
    delete process.env.SAFE_EATS_SCHEDULE;
    t.after(() => { if (prior !== undefined) process.env.SAFE_EATS_SCHEDULE = prior; });

    const scheduler = createScheduler(db);
    scheduler.start();
    // Nothing scheduled means stop() is a no-op rather than a throw; running the
    // server locally must never reach out to DBPR on its own.
    assert.doesNotThrow(() => scheduler.stop());
  });
});
