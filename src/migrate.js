'use strict';

/**
 * Migration runner — SE-101.
 *
 * The story's rule is "migrations in versioned files, not inline DDL". The reason
 * is not tidiness: inline DDL executed on every open has no history, so there is
 * no way to ask what shape the database is in, and no way to tell a fresh install
 * from one that silently missed a change. A numbered file plus a recorded
 * checksum answers both.
 *
 * Three properties, in order of how much they matter:
 *
 *   1. Applied exactly once, in version order, each inside a transaction.
 *      SQLite DDL is transactional, so a migration that throws half way leaves
 *      the database exactly as it was.
 *
 *   2. Drift is an error. The checksum of every applied migration is stored. If
 *      a file changes after it was applied, this refuses to run rather than
 *      guessing — two databases whose histories claim the same version but hold
 *      different schemas is the failure that makes migrations worthless.
 *
 *   3. Legacy databases baseline themselves. 001 is the schema that src/db.js
 *      used to exec inline and every statement in it is IF NOT EXISTS, so the
 *      existing safe-eats.db records it as applied without changing a byte.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migration (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);
`;

const checksum = (sql) => crypto.createHash('sha256').update(sql, 'utf8').digest('hex').slice(0, 16);

/** Every migration on disk, in version order. Throws on a malformed set. */
function discover(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) throw new Error(`No migrations directory at ${dir}`);

  const found = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;

    const match = FILE_RE.exec(file);
    if (!match) {
      throw new Error(
        `Migration filename "${file}" does not match NNN_lower_snake_case.sql. ` +
          `The number is the version and the sort order; an unparseable name has neither.`
      );
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    found.push({ version: Number(match[1]), name: match[2], file, sql, checksum: checksum(sql) });
  }

  const versions = found.map((m) => m.version);
  const duplicate = versions.find((v, i) => versions.indexOf(v) !== i);
  if (duplicate !== undefined) {
    throw new Error(`Two migrations share version ${String(duplicate).padStart(3, '0')}. Renumber one.`);
  }

  return found.sort((a, b) => a.version - b.version);
}

/** What the database says it has already run. */
function applied(db) {
  db.exec(LEDGER);
  return db.prepare('SELECT version, name, checksum, applied_at FROM schema_migration ORDER BY version').all();
}

/**
 * Compare disk against ledger. Returns { pending, drifted, missing }.
 * `missing` is a migration the database has applied that no longer exists on
 * disk — someone deleted a file, and the history is now unreproducible.
 */
function status(db, dir = MIGRATIONS_DIR) {
  const onDisk = discover(dir);
  const inDb = applied(db);
  const byVersion = new Map(inDb.map((r) => [r.version, r]));

  const drifted = onDisk.filter((m) => byVersion.has(m.version) && byVersion.get(m.version).checksum !== m.checksum);
  const pending = onDisk.filter((m) => !byVersion.has(m.version));
  const missing = inDb.filter((r) => !onDisk.some((m) => m.version === r.version));

  return { onDisk, inDb, pending, drifted, missing };
}

/**
 * Apply every pending migration. Returns the list applied, newest last.
 * Refuses to do anything at all if the ledger and the directory disagree —
 * a partial run against a drifted history is worse than no run.
 */
function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const { pending, drifted, missing } = status(db, dir);

  if (drifted.length) {
    throw new Error(
      `Migration drift: ${drifted.map((m) => m.file).join(', ')} changed after being applied. ` +
        `An applied migration is history and cannot be edited — add a new numbered file instead. ` +
        `If this database is disposable, delete it and re-run.`
    );
  }

  if (missing.length) {
    throw new Error(
      `The database has applied ${missing.map((r) => `${r.version}_${r.name}`).join(', ')}, ` +
        `which no longer exists on disk. Restore the file or the schema history is unreproducible.`
    );
  }

  const record = db.prepare(
    'INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
  );

  const done = [];
  for (const m of pending) {
    // Explicit BEGIN/COMMIT rather than db.transaction(): the migration body is
    // multi-statement DDL run through exec(), which cannot nest inside one.
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      record.run(m.version, m.name, m.checksum, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.file} failed and was rolled back: ${error.message}`, { cause: error });
    }
    log(`  applied ${m.file}`);
    done.push(m);
  }

  return done;
}

module.exports = { migrate, status, discover, MIGRATIONS_DIR };

if (require.main === module) {
  const { open } = require('./db');
  const db = open();

  if (process.argv.includes('--status')) {
    const s = status(db);
    console.log(`schema version ${s.inDb.at(-1)?.version ?? 0} · ${s.onDisk.length} migrations on disk`);
    for (const m of s.onDisk) {
      const row = s.inDb.find((r) => r.version === m.version);
      const state = !row ? 'PENDING' : row.checksum !== m.checksum ? 'DRIFTED' : `applied ${row.applied_at}`;
      console.log(`  ${m.file.padEnd(38)} ${state}`);
    }
  } else {
    const done = migrate(db, { log: (m) => console.log(m) });
    console.log(done.length ? `${done.length} migration(s) applied.` : 'Already up to date.');
  }

  db.close();
}
