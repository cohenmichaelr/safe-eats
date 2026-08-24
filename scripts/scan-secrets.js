'use strict';

/**
 * Credential-shape scanner — MVP-SE-001 §7 (tooling gate).
 *
 * One implementation, three callers:
 *   .githooks/pre-commit      → `--staged`  (blocks the commit)
 *   .github/workflows/ci.yml  → `--tracked` (blocks the push)
 *   test/scan-secrets.test.js → `scan()`    (proves the patterns)
 *
 * The scanner FAILS CLOSED on anything credential-shaped. A false positive costs
 * one `pragma: allowlist secret` comment; a false negative costs a key rotation
 * and a rewritten public history. That trade is deliberate.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/** Vendor-specific shapes. High-confidence: the placeholder check does not apply. */
const VENDOR_RULES = [
  { id: 'google-api-key',    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,                            label: 'Google API key' },
  { id: 'google-oauth',      re: /\bGOCSPX-[0-9A-Za-z_-]{28}\b/g,                         label: 'Google OAuth client secret' },
  { id: 'aws-access-key',    re: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[0-9A-Z])[0-9A-Z]{16}\b/g,  label: 'AWS access key id' },
  { id: 'github-token',      re: /\bgh[pousr]_[0-9A-Za-z]{36}\b/g,                        label: 'GitHub token' },
  { id: 'slack-token',       re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,                       label: 'Slack token' },
  { id: 'stripe-live-key',   re: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g,                      label: 'Stripe live key' },
  { id: 'anthropic-key',     re: /\bsk-ant-[0-9A-Za-z_-]{20,}/g,                          label: 'Anthropic API key' },
  { id: 'openai-key',        re: /\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}/g,                    label: 'OpenAI API key' },
  { id: 'private-key-block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g,             label: 'private key block' },
  { id: 'jwt',               re: /\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g, label: 'JSON Web Token' },
];

/**
 * Generic `SECRET = "…"` assignments. Far noisier than the vendor shapes, so a
 * match is only reported when the value does not look like a placeholder.
 */
const ASSIGNMENT_RE =
  /\b(api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|access[_-]?token|auth[_-]?token|token|credentials?)\b\s*[:=]\s*(['"`])([^'"`\n]{12,})\2/gi;

/** Values that are obviously not live credentials. */
const PLACEHOLDER_RE = /^(?:x{3,}|\.{3,}|-+|_+|\*{3,}|\$\{[^}]*\}|<[^>]*>|%[A-Z_]+%)$/i;
const PLACEHOLDER_WORDS =
  /(example|sample|placeholder|redacted|dummy|fake|test[_-]?only|your[_-]?|changeme|replace[_-]?me|insert[_-]?|todo|xxxx|process\.env|import\.meta\.env|os\.environ|getenv)/i;

const ALLOW_PRAGMA = /pragma:\s*allowlist\s+secret/i;

/** Paths whose contents are data or vendored, not authored source. */
const SKIP_PATHS = [
  /^data\//,
  /^node_modules\//,
  /(^|\/)package-lock\.json$/,
  /\.(db|sqlite|png|jpg|jpeg|gif|ico|pdf|zip|gz|woff2?|ttf)$/i,
];

/** A staged `.env` is a finding in itself, regardless of contents. */
const ENV_FILE_RE = /(^|\/)\.env(\.|$)/;

function isPlaceholder(value) {
  if (PLACEHOLDER_RE.test(value)) return true;
  if (PLACEHOLDER_WORDS.test(value)) return true;
  // A value with fewer than 5 distinct characters carries no entropy.
  return new Set(value).size < 5;
}

/** NUL bytes are the cheapest reliable binary signal. */
function looksBinary(text) {
  return text.includes(String.fromCharCode(0));
}

/** Never echo a live credential into a terminal, a CI log, or a hook message. */
function redact(value) {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 24))}${value.slice(-4)}`;
}

/**
 * @param {string} text     file contents
 * @param {string} pathname repo-relative path, used for path-shaped rules
 * @returns {Array<{path:string,line:number,rule:string,label:string,excerpt:string}>}
 */
function scan(text, pathname = '<stdin>') {
  if (SKIP_PATHS.some((re) => re.test(pathname))) return [];

  const findings = [];

  if (ENV_FILE_RE.test(pathname) && !/\.example$/.test(pathname)) {
    findings.push({
      path: pathname, line: 1, rule: 'env-file', label: 'environment file',
      excerpt: '.env carries live credentials and must never be committed',
    });
  }

  if (looksBinary(text)) return findings;

  text.split(/\r?\n/).forEach((line, i) => {
    if (ALLOW_PRAGMA.test(line)) return;

    for (const rule of VENDOR_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        findings.push({
          path: pathname, line: i + 1, rule: rule.id,
          label: rule.label, excerpt: redact(m[0]),
        });
      }
    }

    ASSIGNMENT_RE.lastIndex = 0;
    let a;
    while ((a = ASSIGNMENT_RE.exec(line)) !== null) {
      if (isPlaceholder(a[3])) continue;
      findings.push({
        path: pathname, line: i + 1, rule: 'assigned-secret',
        label: `hardcoded ${a[1].toLowerCase()}`, excerpt: redact(a[3]),
      });
    }
  });

  return findings;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Split git's line-oriented output; `-c core.quotePath=false` keeps UTF-8 paths intact. */
function gitLines(args) {
  return git(['-c', 'core.quotePath=false', ...args]).split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Files staged for commit, read from the INDEX (not the worktree copy). */
function scanStaged() {
  const paths = gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  const findings = [];
  for (const p of paths) {
    let content;
    try {
      content = git(['show', `:${p}`]);
    } catch {
      continue; // unmerged, or removed between listing and read
    }
    findings.push(...scan(content, p));
  }
  return findings;
}

/** Every tracked file in the worktree — the CI sweep. */
function scanTracked() {
  const findings = [];
  for (const p of gitLines(['ls-files'])) {
    let content;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    findings.push(...scan(content, p));
  }
  return findings;
}

function report(findings, mode) {
  if (findings.length === 0) {
    console.log(`scan-secrets: clean (${mode})`);
    return 0;
  }
  console.error('');
  console.error(`  BLOCKED — ${findings.length} credential-shaped string(s) found:`);
  console.error('');
  for (const f of findings) {
    console.error(`    ${f.path}:${f.line}  ${f.label}`);
    console.error(`      ${f.excerpt}`);
  }
  console.error('');
  console.error('  Move the value into .env (gitignored) and read it via process.env.');
  console.error('  If this is genuinely not a credential, append to the line:');
  console.error('      pragma: allowlist secret');
  console.error('');
  return 1;
}

if (require.main === module) {
  const mode = process.argv[2] || '--staged';
  const findings = mode === '--tracked' ? scanTracked() : scanStaged();
  process.exit(report(findings, mode.replace('--', '')));
}

module.exports = { scan, scanStaged, scanTracked, redact };
