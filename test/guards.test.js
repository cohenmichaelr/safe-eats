'use strict';

/**
 * Tests for the commit-gate guards — MVP-SE-001 §7.
 *
 * Every credential literal here is BUILT AT RUNTIME by concatenation. A test file
 * containing a real-shaped key would be flagged by the very scanner it tests, and
 * `npm run scan:secrets` would fail CI on its own test fixtures.
 *
 * The SQL fixtures below cannot be dodged the same way — the guard has to see the
 * literal statement to judge it. This file is therefore exempted wholesale:
 *
 *   guard-sql: allow-file — every DROP/TRUNCATE here is an assertion, not a command
 *
 * That pragma works only when scanning files. `--hook` mode ignores it, so it
 * cannot be used to sneak a live command past the guard; the test below asserts it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { scan, redact } = require('../scripts/scan-secrets.js');
const { assess } = require('../scripts/guard-sql.js');

/* ------------------------------------------------ credential scanner ------ */

test('scan-secrets — vendor key shapes', async (t) => {
  const cases = [
    ['Google API key',   `AIza${'B'.repeat(35)}`],
    ['AWS access key',   `AKIA${'Q7ZX'.repeat(4)}`],
    ['GitHub token',     `ghp_${'a1B2'.repeat(9)}`],
    ['Stripe live key',  `sk_live_${'9xQ2'.repeat(6)}`],
    ['Anthropic key',    `sk-ant-${'a1B2c3D4'.repeat(4)}`],
    ['Google OAuth',     `GOCSPX-${'aB3d'.repeat(7)}`],
    ['Slack token',      `xoxb-${'12345678'.repeat(2)}`],
  ];

  for (const [label, value] of cases) {
    await t.test(`flags a ${label}`, () => {
      const findings = scan(`const key = "${value}";`, 'src/config.js');
      assert.ok(findings.length > 0, `${label} was not flagged`);
    });
  }
});

test('scan-secrets — private key blocks and JWTs', () => {
  assert.ok(scan('-----BEGIN RSA PRIVATE KEY-----', 'k.pem').length > 0); // pragma: allowlist secret
  const jwt = `eyJ${'abcdefgh'}.eyJ${'ijklmnop'}.${'qrstuvwx'}`;
  assert.ok(scan(`const t = "${jwt}";`, 'a.js').length > 0);
});

test('scan-secrets — a staged .env is a finding on its path alone', () => {
  const findings = scan('PORT=3000\n', '.env');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'env-file');
});

test('scan-secrets — .env.example is allowed', () => {
  assert.equal(scan('GOOGLE_MAPS_API_KEY=your-key-here\n', '.env.example').length, 0);
});

test('scan-secrets — hardcoded assignments', async (t) => {
  await t.test('flags a real-looking value', () => {
    const findings = scan(`const password = "hunter2Correct9Horse";`, 'src/db.js'); // pragma: allowlist secret
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'assigned-secret');
  });

  await t.test('ignores placeholders', () => {
    for (const v of ['your-key-here', 'xxxxxxxxxxxxxx', '<REDACTED_VALUE>', 'CHANGEME_BEFORE_USE', 'example-secret-x']) {
      assert.equal(scan(`const apiKey = "${v}";`, 'a.js').length, 0, `${v} should be ignored`);
    }
  });

  await t.test('ignores env indirection — the pattern we WANT', () => {
    assert.equal(scan('const apiKey = process.env.GOOGLE_MAPS_API_KEY;', 'a.js').length, 0);
  });
});

test('scan-secrets — the allowlist pragma suppresses a line', () => {
  const key = `AIza${'B'.repeat(35)}`;
  assert.ok(scan(`const k = "${key}";`, 'a.js').length > 0);
  assert.equal(scan(`const k = "${key}"; // pragma: allowlist secret`, 'a.js').length, 0);
});

test('scan-secrets — data and lockfiles are skipped', () => {
  const key = `AIza${'B'.repeat(35)}`;
  assert.equal(scan(key, 'data/raw/extract.csv').length, 0);
  assert.equal(scan(key, 'package-lock.json').length, 0);
});

test('scan-secrets — findings never echo the full credential', () => {
  const key = `AIza${'B'.repeat(35)}`;
  const [finding] = scan(`const k = "${key}";`, 'a.js');
  assert.ok(!finding.excerpt.includes(key), 'the raw key leaked into the report');
  assert.ok(finding.excerpt.includes('*'));
  assert.equal(redact('short'), '*****');
});

/* ------------------------------------------------------- SQL guard -------- */

test('guard-sql — blocks destructive SQL against remote targets', async (t) => {
  const blocked = [
    ['remote psql host',   'psql -h db.prod.example.com -c "DROP TABLE establishment"'],
    ['managed postgres',   'psql postgres://u:p@dpg-abc123.render.com:5432/safeeats -c "TRUNCATE inspection"'],
    ['supabase',           'psql postgresql://postgres@db.xyz.supabase.co/postgres -c "DELETE FROM establishment"'],
    ['env var target',     'psql "$DATABASE_URL" -c "DROP TABLE inspection"'],
    ['prod-named var',     'psql "$PROD_DB_URL" -c "TRUNCATE TABLE violation"'],
    ['no target at all',   'psql -c "DROP TABLE establishment"'],
    ['update without where', 'psql -h db.example.com -c "UPDATE establishment SET lat = NULL"'],
    ['alter drop column',  'psql -h db.example.com -c "ALTER TABLE establishment DROP COLUMN lat"'],
  ];

  for (const [label, cmd] of blocked) {
    await t.test(`blocks: ${label}`, () => {
      const r = assess(cmd);
      assert.equal(r.verdict, 'block', `expected block for: ${cmd}`);
      assert.ok(r.destructive.length > 0);
      assert.ok(r.reason.length > 0);
    });
  }
});

test('guard-sql — allows destructive SQL against provably local targets', async (t) => {
  const allowed = [
    ['local sqlite file',  'sqlite3 ./safe-eats.db "DROP TABLE establishment"'],
    ['repo sqlite file',   'sqlite3 safe-eats.db "DELETE FROM inspection"'],
    ['loopback host',      'psql -h localhost -c "TRUNCATE establishment"'],
    ['loopback ip',        'psql -h 127.0.0.1 -c "DROP TABLE inspection"'],
    ['local uri',          'psql postgres://dev@localhost:5432/safeeats -c "DROP SCHEMA public CASCADE"'],
  ];

  for (const [label, cmd] of allowed) {
    await t.test(`allows: ${label}`, () => {
      assert.equal(assess(cmd).verdict, 'allow', `expected allow for: ${cmd}`);
    });
  }
});

test('guard-sql — non-destructive statements pass regardless of target', () => {
  for (const cmd of [
    'psql -h db.prod.example.com -c "SELECT count(*) FROM establishment"',
    'psql -h db.prod.example.com -c "DELETE FROM inspection WHERE inspection_date < \'2020-01-01\'"',
    'psql -h db.prod.example.com -c "UPDATE establishment SET lat = 1 WHERE establishment_id = \'x\'"',
    'psql -h db.prod.example.com -c "CREATE TABLE IF NOT EXISTS establishment (id text)"',
  ]) {
    assert.equal(assess(cmd).verdict, 'allow', `expected allow for: ${cmd}`);
  }
});

test('guard-sql — commented-out SQL is not a finding', () => {
  assert.equal(assess('psql -h db.prod.example.com -c "SELECT 1" # DROP TABLE establishment').verdict, 'allow');
  assert.equal(assess('-- DROP TABLE establishment').verdict, 'allow');
  assert.equal(assess('/* TRUNCATE inspection */').verdict, 'allow');
});

test('guard-sql — WHERE in a neighbouring statement does not excuse a bare DELETE', () => {
  const cmd = 'psql -h localhost -c "DELETE FROM a WHERE id=1; DELETE FROM b"';
  const r = assess(cmd);
  assert.ok(r.destructive.some((d) => d.rule === 'delete-all'),
    'the unqualified DELETE in the second statement was missed');
});

test('guard-sql — a long option is not a SQL comment (regression)', () => {
  // `--host=…` starts with the SQL comment marker. Stripping dash-dash to
  // end-of-line unconditionally would delete the DROP along with it and return
  // "allow" for a command that drops a table on a production host.
  const r = assess('psql --host=db.prod.example.com -c "DROP TABLE establishment"');
  assert.equal(r.verdict, 'block');
  assert.ok(r.destructive.length > 0, 'the DROP was swallowed by comment stripping');
  assert.match(r.reason, /db\.prod\.example\.com/);
});

test('guard-sql — UNC sqlite paths are not local', () => {
  const r = assess('sqlite3 //fileserver/share/safe-eats.db "DROP TABLE establishment"');
  assert.equal(r.verdict, 'block');
});

test('guard-sql — the allow pragma is honoured for files but NOT for live commands', async (t) => {
  const cmd = 'psql -h db.prod.example.com -c "DROP TABLE establishment" // guard-sql: allow';

  await t.test('a live command cannot exempt itself', () => {
    assert.equal(assess(cmd).verdict, 'block',
      'an agent appended a pragma to its own command and was waved through');
  });

  await t.test('file scanning honours it', () => {
    assert.equal(assess(cmd, { allowPragma: true }).verdict, 'allow');
  });

  await t.test('the pragma only exempts its own line', () => {
    const src = [
      'const a = "DROP TABLE x"; // guard-sql: allow',
      'psql -h db.prod.example.com -c "TRUNCATE inspection"',
    ].join('\n');
    assert.equal(assess(src, { allowPragma: true }).verdict, 'block');
  });
});

test('guard-sql — the explain output names the reason and never claims a bypass', () => {
  const { explain } = require('../scripts/guard-sql.js');
  const text = explain(assess('psql -h db.prod.example.com -c "DROP TABLE establishment"'));
  assert.match(text, /BLOCKED/);
  assert.match(text, /non-local/i);
  assert.doesNotMatch(text, /SKIP_GUARD|FORCE=1|--force/);
});
