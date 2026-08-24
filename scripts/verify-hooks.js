'use strict';

/**
 * Asserts the guard tooling is actually wired — MVP-SE-001 §7.
 *
 * CI runs this so the gate cannot rot: a renamed hook, a cleared core.hooksPath,
 * or a hook that lost its exec bit would otherwise fail silently and every commit
 * would sail through unchecked. This is the same lesson as AUD F1 — a guard that
 * logs instead of failing is not a guard.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const problems = [];

function check(label, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    problems.push(`${label}: ${err.message}`);
    console.log(`  FAIL  ${label} — ${err.message}`);
  }
}

console.log('verify-hooks:');

check('.githooks/pre-commit exists', () => {
  const p = path.join(root, '.githooks', 'pre-commit');
  if (!fs.existsSync(p)) throw new Error('missing');
  return `${fs.statSync(p).size} bytes`;
});

check('pre-commit is executable in the index', () => {
  const out = execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'], {
    cwd: root, encoding: 'utf8',
  }).trim();
  if (!out) throw new Error('not tracked by git');
  const mode = out.split(/\s+/)[0];
  if (mode !== '100755') throw new Error(`mode is ${mode}, expected 100755`);
  return mode;
});

check('pre-commit invokes both guards', () => {
  const body = fs.readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8');
  for (const needle of ['scan-secrets.js', 'guard-sql.js']) {
    if (!body.includes(needle)) throw new Error(`does not call ${needle}`);
  }
  return 'scan-secrets + guard-sql';
});

check('npm prepare installs core.hooksPath', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const prepare = pkg.scripts && pkg.scripts.prepare;
  if (!prepare || !prepare.includes('install-hooks')) {
    throw new Error('package.json scripts.prepare does not run install-hooks.js');
  }
  return prepare;
});

check('Claude Code PreToolUse guard is wired', () => {
  const p = path.join(root, '.claude', 'settings.json');
  if (!fs.existsSync(p)) throw new Error('.claude/settings.json missing');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const entries = (cfg.hooks && cfg.hooks.PreToolUse) || [];
  const wired = entries.some((e) =>
    (e.hooks || []).some((h) => String(h.command || '').includes('guard-sql.js')));
  if (!wired) throw new Error('no PreToolUse hook calls guard-sql.js');
  return 'PreToolUse(Bash) -> guard-sql.js';
});

check('guards still block their canonical cases', () => {
  const { scan } = require('./scan-secrets.js');
  const { assess } = require('./guard-sql.js');

  const fakeKey = `AIza${'B'.repeat(35)}`;
  if (scan(`const k = "${fakeKey}";`, 'probe.js').length === 0) {
    throw new Error('credential scanner did not flag a Google-shaped key');
  }
  const remote = assess('psql -h db.prod.example.com -c "DROP TABLE establishment"'); // guard-sql: allow — self-test fixture
  if (remote.verdict !== 'block') throw new Error('SQL guard allowed a remote DROP');

  const local = assess('sqlite3 ./safe-eats.db "DROP TABLE establishment"'); // guard-sql: allow — self-test fixture
  if (local.verdict !== 'allow') throw new Error('SQL guard blocked a local DROP');

  return 'self-test passed';
});

if (problems.length > 0) {
  console.error(`\nverify-hooks: ${problems.length} problem(s) — the commit gate is not enforced.\n`);
  process.exit(1);
}
console.log('\nverify-hooks: all guards wired\n');
