'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SAFE_EATS_DB || path.join(__dirname, '..', 'safe-eats.db');

/**
 * Schema — MVP-SE-001 §4, SE-101.
 *
 * The DDL used to live here as a SCHEMA constant exec'd on every open. It now
 * lives in `migrations/`, one numbered file per change, applied and recorded by
 * `src/migrate.js`. `migrations/001_initial_schema.sql` is this file's former
 * contents, byte for byte, so nothing about the loaded database changed when it
 * moved — only whether its history is answerable.
 *
 * The two invariants the schema exists to enforce are unchanged, and as of
 * `005_ifc1_boundary.sql` they are enforced by the database rather than by
 * convention:
 *
 * 1. `establishment.lat/lng` are written ONLY by geocode.js, from geocode_cache.
 *    v1 used `INSERT OR REPLACE`, which deletes and reinserts the row, nulling
 *    every accumulated coordinate on each import (AUD F4) — that is why only
 *    1.6% of 64,110 rows ever had coordinates. Triggers IFC-1a and IFC-1b now
 *    make both halves of that failure an abort.
 *
 * 2. `geocode_cache` is keyed on normalized address and is never truncated by an
 *    ingest. Coordinates survive a full source reload, so geocoding accumulates
 *    instead of resetting.
 */

function open({ readonly = false } = {}) {
  const db = new Database(DB_PATH, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // A read-only handle cannot migrate, and must not silently run against a
  // schema older than the code expects — callers that need current shape open
  // for write. Migration is idempotent: on an up-to-date database it is a
  // single SELECT against the ledger.
  if (!readonly) require('./migrate').migrate(db);
  return db;
}

/**
 * The as-of date shown to users (FR-601). Derived from the newest successful
 * ingest, never from `now` — if the pipeline stops, the displayed date must stop
 * with it rather than implying freshness the data does not have.
 */
function dataAsOf(db) {
  const row = db
    .prepare(`SELECT finished_at FROM ingest_run WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`)
    .get();
  return row?.finished_at ?? null;
}

module.exports = { open, dataAsOf, DB_PATH };
