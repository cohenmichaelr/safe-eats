'use strict';

/**
 * Destructive-SQL guard — MVP-SE-001 §7 (tooling gate).
 *
 * Blocks destructive statements aimed at anything that is not provably a local
 * database. Enforced at two points:
 *
 *   .claude/settings.json  PreToolUse(Bash) → `--hook`    blocks the agent from RUNNING it
 *   .githooks/pre-commit                    → `--staged`  blocks the repo from CARRYING it
 *
 * Invariant 3 in CLAUDE.md says ingest aborts rather than warns. This is the same
 * posture applied to the database itself: the guard FAILS CLOSED. If a destructive
 * statement is present and the target cannot be *proven* local, it is blocked —
 * "no host flag" means the target is ambient (PGHOST, DATABASE_URL, a .pgpass
 * default), and ambient targets are exactly how a dev-shell command reaches prod.
 *
 * There is deliberately NO environment-variable bypass. The guard exists to stop an
 * automated agent; a bypass an agent can set is not a guard. A human who genuinely
 * intends the operation runs it in their own shell, where no hook applies.
 */

const LOCAL_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '', 'host.docker.internal',
]);

/** Managed-database domains — named so the reason message can be specific. */
const HOSTED_HINTS = [
  /\.render\.com\b/i, /\.supabase\.(co|com)\b/i, /\.neon\.tech\b/i,
  /\.rds\.amazonaws\.com\b/i, /\.planetscale\.com\b/i, /\.mongodb\.net\b/i,
  /\.aivencloud\.com\b/i, /\.cockroachlabs\.cloud\b/i, /\.redislabs\.com\b/i,
  /\.azure\.com\b/i, /\.googleapis\.com\b/i,
];

const DB_URI_RE =
  /\b(postgres|postgresql|mysql|mariadb|mongodb\+srv|mongodb|rediss?|mssql|sqlserver|clickhouse)::?\/\/([^\s'"`;]+)/gi;

/** `-h host`, `--host host`, `--host=host` as used by psql / mysql / mongosh. */
const HOST_FLAG_RE = /(?:^|\s)(?:-h|--host)[=\s]+(['"]?)([^\s'"`;]+)\1/gi;

/** An interpolated variable is an unknowable target: `$DATABASE_URL`, `%DB%`, `process.env.X`. */
const VAR_TARGET_RE =
  /\$\{?[A-Z_][A-Z0-9_]*\}?|%[A-Z_][A-Z0-9_]*%|process\.env\.[A-Za-z_$][\w$]*/g;

/** Variables whose name alone says "not local". */
const PROD_VAR_RE = /\b(PROD|PRODUCTION|LIVE|STAGING|REMOTE)\w*/i;

/**
 * A SQLite path, with any `//` or `\\` prefix CAPTURED — without it a UNC path
 * matches from the first word character and reads as a local file.
 */
const SQLITE_FILE_RE =
  /(?:^|[\s'"=(])((?:\/\/|\\\\)?[\w.:/\\-]+\.(?:db|sqlite3?))(?=$|[\s'"),;])/gi;

/**
 * Destructive statement shapes. Each is tested against a single statement, so the
 * `WHERE` lookarounds cannot be satisfied by a different statement in the batch.
 */
const DESTRUCTIVE_RULES = [
  { id: 'drop-object',   re: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|VIEW|INDEX|TYPE)\b/i, label: 'DROP' },
  { id: 'truncate',      re: /\bTRUNCATE\s+(?:TABLE\s+)?[\w."`[\]]+/i,                label: 'TRUNCATE' },
  { id: 'alter-drop',    re: /\bALTER\s+TABLE\s+[\w."`[\]]+\s+DROP\b/i,               label: 'ALTER TABLE … DROP' },
  { id: 'delete-all',    re: /\bDELETE\s+FROM\s+[\w."`[\]]+\s*$/i,                    label: 'DELETE without WHERE' },
  { id: 'update-all',    re: /\bUPDATE\s+[\w."`[\]]+\s+SET\b(?![\s\S]*\bWHERE\b)/i,   label: 'UPDATE without WHERE' },
  { id: 'drop-cascade',  re: /\bDROP\b[\s\S]*\bCASCADE\b/i,                           label: 'DROP … CASCADE' },
];

/**
 * Strip SQL and shell comments so a commented-out DROP is not a finding.
 *
 * `--` only opens a SQL comment when followed by whitespace or end of line. A
 * naive "dash-dash to end of line" rule also eats long options, so
 * `psql --host=prod -c "DROP TABLE x"` would have its DROP stripped and the
 * command would be waved through — a false negative, the one outcome this
 * file exists to prevent.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--(?=\s|$)[^\n]*/g, ' ')
    .replace(/(^|\s)#[^\n]*/g, '$1 ');
}

/**
 * Opt-out marker for source files that legitimately contain destructive SQL as
 * data — test fixtures, documentation, this file's own rule table.
 *
 * Honoured ONLY when scanning files (`--staged` / `--tracked`), where a human
 * wrote the pragma and it is visible in the diff. It is deliberately NOT honoured
 * for a live command in `--hook` mode: an agent that can append a comment to its
 * own command could otherwise wave itself through, which would make the guard
 * decorative.
 */
const ALLOW_PRAGMA = /guard-sql:\s*allow\b/i;

/**
 * File-level opt-out, for files that are entirely fixtures (the guard's own tests).
 * Same rule as ALLOW_PRAGMA: file scans only, never a live command.
 */
const ALLOW_FILE_PRAGMA = /guard-sql:\s*allow-file\b/i;

function dropAllowlistedLines(text) {
  return text.split(/\r?\n/).filter((line) => !ALLOW_PRAGMA.test(line)).join('\n');
}

/** Split a command into candidate statements; `;` is good enough for this purpose. */
function statements(text) {
  return stripComments(text)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function findDestructive(text) {
  const hits = [];
  for (const stmt of statements(text)) {
    for (const rule of DESTRUCTIVE_RULES) {
      if (rule.re.test(stmt)) {
        hits.push({ rule: rule.id, label: rule.label, statement: truncate(stmt) });
        break; // one finding per statement is enough to block
      }
    }
  }
  return hits;
}

function truncate(s, n = 120) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function hostOf(uriTail) {
  // strip credentials, then take up to the first `/`, `:` or `?`
  const afterAuth = uriTail.includes('@') ? uriTail.slice(uriTail.lastIndexOf('@') + 1) : uriTail;
  const host = afterAuth.split(/[/?,]/)[0].replace(/:\d+$/, '');
  return host.toLowerCase();
}

/**
 * Resolve every database target mentioned in the command.
 * @returns {Array<{kind:string, value:string, local:boolean|null, why:string}>}
 *          `local: null` means unprovable — which the verdict treats as non-local.
 */
function targets(command) {
  const found = [];
  const text = stripComments(command);

  let m;
  DB_URI_RE.lastIndex = 0;
  while ((m = DB_URI_RE.exec(text)) !== null) {
    const host = hostOf(m[2]);
    const hosted = HOSTED_HINTS.find((re) => re.test(host));
    found.push({
      kind: 'uri', value: `${m[1]}://${host}`,
      local: LOCAL_HOSTS.has(host),
      why: hosted ? 'managed database host' : LOCAL_HOSTS.has(host) ? 'loopback host' : 'remote host',
    });
  }

  HOST_FLAG_RE.lastIndex = 0;
  while ((m = HOST_FLAG_RE.exec(text)) !== null) {
    const host = m[2].toLowerCase();
    // `-h` on sqlite3/other tools may not mean host; only trust it when it looks like one.
    if (/^-/.test(host)) continue;
    found.push({
      kind: 'host-flag', value: host,
      local: LOCAL_HOSTS.has(host),
      why: LOCAL_HOSTS.has(host) ? 'loopback host' : 'remote host',
    });
  }

  VAR_TARGET_RE.lastIndex = 0;
  while ((m = VAR_TARGET_RE.exec(text)) !== null) {
    const name = m[0];
    // Only variables that plausibly name a database target.
    if (!/(DB|DATABASE|PG|MYSQL|MONGO|REDIS|CONN|DSN|URL|URI|HOST)/i.test(name)) continue;
    found.push({
      kind: 'variable', value: name, local: null,
      why: PROD_VAR_RE.test(name)
        ? 'variable names a non-local environment'
        : 'target resolved at runtime and cannot be verified',
    });
  }

  SQLITE_FILE_RE.lastIndex = 0;
  while ((m = SQLITE_FILE_RE.exec(text)) !== null) {
    const file = m[1];
    const unc = /^\\\\/.test(file) || /^\/\//.test(file);
    found.push({
      kind: 'sqlite-file', value: file, local: !unc,
      why: unc ? 'UNC path — file lives on another machine' : 'local SQLite file',
    });
  }

  return found;
}

/**
 * @param {string} command
 * @param {{allowPragma?:boolean}} [opts] `allowPragma` honours `guard-sql: allow`
 *        lines. File scans pass true; live command checks must not — see ALLOW_PRAGMA.
 * @returns {{verdict:'allow'|'block', destructive:Array, targets:Array, reason:string}}
 */
function assess(command, opts = {}) {
  const text = opts.allowPragma ? dropAllowlistedLines(command) : command;
  const destructive = findDestructive(text);
  const found = targets(text);

  if (destructive.length === 0) {
    return { verdict: 'allow', destructive, targets: found, reason: 'no destructive statement' };
  }

  const offending = found.filter((t) => t.local !== true);

  if (found.length === 0) {
    return {
      verdict: 'block', destructive, targets: found,
      reason:
        'destructive SQL with no explicit target — the database would be chosen by ' +
        'ambient configuration (DATABASE_URL, PGHOST, .pgpass), which cannot be verified as local',
    };
  }

  if (offending.length > 0) {
    const t = offending[0];
    return {
      verdict: 'block', destructive, targets: found,
      reason: `destructive SQL against a non-local target: ${t.value} (${t.why})`,
    };
  }

  return {
    verdict: 'allow', destructive, targets: found,
    reason: `destructive SQL, but every target is local (${found.map((t) => t.value).join(', ')})`,
  };
}

function explain(result) {
  const lines = [
    '',
    '  BLOCKED — destructive SQL against a non-local database.',
    '',
    `  Reason: ${result.reason}`,
    '',
    '  Statements:',
    ...result.destructive.map((d) => `    ${d.label}: ${d.statement}`),
  ];
  if (result.targets.length) {
    lines.push('', '  Targets seen:');
    for (const t of result.targets) {
      const mark = t.local === true ? 'local' : t.local === false ? 'NON-LOCAL' : 'UNVERIFIABLE';
      lines.push(`    [${mark}] ${t.value} — ${t.why}`);
    }
  }
  lines.push(
    '',
    '  If the target really is local, name it explicitly:',
    '      psql -h localhost …      sqlite3 ./safe-eats.db …',
    '',
    '  If you intend this against a real database, run it yourself in your own',
    '  shell. This guard deliberately has no bypass flag.',
    '',
  );
  return lines.join('\n');
}

/* ------------------------------------------------------------------ CLI ---- */

/** PreToolUse(Bash): read the hook payload on stdin, exit 2 to deny. */
function runHook() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      process.exit(0); // malformed payload is not our failure mode
    }
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string' || command.length === 0) process.exit(0);

    const result = assess(command);
    if (result.verdict === 'block') {
      process.stderr.write(explain(result));
      process.exit(2); // 2 = deny, and show stderr to Claude
    }
    process.exit(0);
  });
}

const SOURCE_RE = /\.(js|mjs|cjs|ts|sql|sh|ps1|yml|yaml|json)$/i;

function gitOut(args) {
  const { execFileSync } = require('node:child_process');
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Scan a set of files and block if any carries destructive SQL at a non-local target.
 * @param {(p:string)=>string} read  resolves a repo path to its contents
 */
function scanFiles(paths, read, mode) {
  let blocked = 0;
  for (const p of paths) {
    let content;
    try {
      content = read(p);
    } catch {
      continue;
    }
    if (ALLOW_FILE_PRAGMA.test(content)) {
      console.log(`guard-sql: skipping ${p} (allow-file)`);
      continue;
    }
    const result = assess(content, { allowPragma: true });
    if (result.verdict === 'block') {
      blocked += 1;
      console.error(`\n  ${p}:`);
      console.error(explain(result));
    }
  }
  if (blocked > 0) {
    process.exit(1);
  }
  console.log(`guard-sql: clean (${mode})`);
  process.exit(0);
}

/** pre-commit: refuse to record source that carries the same hazard. */
function runStaged() {
  const paths = gitOut(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n').map((s) => s.trim()).filter((p) => p && SOURCE_RE.test(p));
  scanFiles(paths, (p) => gitOut(['show', `:${p}`]), 'staged');
}

/** CI: the same sweep over every tracked file, since --no-verify skips the hook. */
function runTracked() {
  const fs = require('node:fs');
  const paths = gitOut(['ls-files'])
    .split('\n').map((s) => s.trim()).filter((p) => p && SOURCE_RE.test(p));
  scanFiles(paths, (p) => fs.readFileSync(p, 'utf8'), 'tracked');
}

if (require.main === module) {
  const mode = process.argv[2] || '--hook';
  if (mode === '--staged') runStaged();
  else if (mode === '--tracked') runTracked();
  else if (mode === '--check') {
    // `node scripts/guard-sql.js --check "<command>"` — used by the proof script.
    const result = assess(process.argv[3] || '');
    if (result.verdict === 'block') {
      process.stderr.write(explain(result));
      process.exit(2);
    }
    console.log(`guard-sql: allow — ${result.reason}`);
    process.exit(0);
  } else runHook();
}

module.exports = { assess, findDestructive, targets, explain };
