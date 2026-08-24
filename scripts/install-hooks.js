'use strict';

/**
 * Points git at the version-controlled hooks in .githooks/ — MVP-SE-001 §7.
 *
 * Wired to npm `prepare`, so `npm install` configures the gate. v1's hooks (had
 * there been any) would have lived in .git/hooks, which is not committed and not
 * cloned; core.hooksPath is what makes the guard survive a fresh checkout.
 *
 * Exits 0 on every failure path: a missing git binary or a tarball install must
 * not break `npm install`.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const hooksDir = path.join(root, '.githooks');

try {
  if (!fs.existsSync(path.join(root, '.git'))) {
    console.log('install-hooks: no .git directory — skipping');
    process.exit(0);
  }
  if (!fs.existsSync(hooksDir)) {
    console.log('install-hooks: no .githooks directory — skipping');
    process.exit(0);
  }

  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'pipe' });

  // Windows checkouts do not carry the exec bit; git for Windows runs the hook via
  // sh regardless, but CI runners on Linux need it set in the index.
  for (const name of fs.readdirSync(hooksDir)) {
    const file = path.join(hooksDir, name);
    try {
      fs.chmodSync(file, 0o755);
    } catch { /* best effort */ }
  }

  console.log('install-hooks: core.hooksPath -> .githooks');
} catch (err) {
  console.log(`install-hooks: skipped (${err.message})`);
}
process.exit(0);
