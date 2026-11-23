#!/usr/bin/env node
/**
 * Dependency-free tests for test-tmp.cjs, the temp-directory lifecycle the
 * other tests in this package use.
 *
 * Every case runs inside a private scratch directory passed to
 * `sweepStaleRuns` as its root, or set as TMPDIR for a child process, so no
 * case reads or deletes anything in the real temp directory.
 *
 * Run standalone: `node test-tmp-test.cjs` from the package root.
 * Wired into: this package's `test` script.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { sweepStaleRuns } = require(path.join(__dirname, 'test-tmp.cjs'));

const stats = { pass: 0, fail: 0 };

function check(condition, label, detail) {
  if (condition) {
    stats.pass++;
    return;
  }
  stats.fail++;
  console.error(`FAIL: ${label}`);
  if (detail !== undefined) console.error(`  ${detail}`);
}

// Just past the one-hour cutoff, so the boundary is what the test exercises.
const STALE = new Date(Date.now() - 61 * 60 * 1000);

function age(target) {
  fs.lutimesSync(target, STALE, STALE);
}

// Every prefix the sweep owns, written out rather than imported, so dropping
// one from test-tmp.cjs fails here instead of shrinking the test with it.
const SWEPT_PREFIXES = [
  'rill-devtest-',
  'rill-baseline-',
  'rill-checkstd-',
  'rill-sentinel-',
];

// isSymlink — true when target exists as a symlink, false when it is gone.
function isSymlink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

// The six-character suffix mkdtemp appends.
const SUFFIX = 'Ab12Cd';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'test-tmp-test-'));

try {
  // sweepStaleRuns: each known prefix is swept once it is past the cutoff,
  // in the exact shape mkdtemp produces.
  {
    const root = fs.mkdtempSync(path.join(scratch, 'sweep-'));
    const stale = SWEPT_PREFIXES.map((prefix) => {
      const dir = path.join(root, prefix + SUFFIX);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'fixture.txt'), 'x');
      age(dir);
      return dir;
    });
    const young = path.join(root, 'rill-checkstd-Yo12Cd');
    fs.mkdirSync(young);
    const foreign = path.join(root, 'other-dir-old');
    fs.mkdirSync(foreign);
    age(foreign);
    // A hand-named directory shares a prefix but not the mkdtemp shape.
    const handNamed = path.join(root, 'rill-baseline-project');
    fs.mkdirSync(handNamed);
    age(handNamed);
    // A symlink with a swept name points outside the root.
    const target = fs.mkdtempSync(path.join(scratch, 'target-'));
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
    const link = path.join(root, 'rill-devtest-Ln34Kq');
    fs.symlinkSync(target, link, 'dir');
    age(link);

    sweepStaleRuns(root);

    for (const dir of stale) {
      check(
        !fs.existsSync(dir),
        `sweep: removes ${path.basename(dir)} past the cutoff`
      );
    }
    check(
      fs.existsSync(young),
      'sweep: keeps a run directory younger than the cutoff'
    );
    check(fs.existsSync(foreign), 'sweep: keeps a directory with another name');
    check(
      fs.existsSync(handNamed),
      'sweep: keeps a hand-named rill-baseline- directory'
    );
    check(isSymlink(link), 'sweep: keeps a symlink with a swept name');
    check(
      fs.existsSync(path.join(target, 'keep.txt')),
      'sweep: leaves the symlink target untouched'
    );
  }

  // sweepStaleRuns: a relative root is never swept, since it resolves against
  // the working directory rather than a scratch area.
  {
    const root = fs.mkdtempSync(path.join(scratch, 'relative-'));
    const stale = path.join(root, `rill-devtest-${SUFFIX}`);
    fs.mkdirSync(stale);
    age(stale);
    sweepStaleRuns(path.relative(process.cwd(), root));
    check(fs.existsSync(stale), 'sweep: ignores a relative root');
  }

  // createRunDir: a normal exit removes the run directory. A child process
  // with TMPDIR pointed at a private root proves it without touching the real
  // temp directory.
  {
    const root = fs.mkdtempSync(path.join(scratch, 'exit-'));
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const { createRunDir } = require(${JSON.stringify(path.join(__dirname, 'test-tmp.cjs'))});` +
          `const { dir } = createRunDir();` +
          `require('fs').writeFileSync(require('path').join(dir, 'f'), 'x');` +
          `console.log(dir);`,
      ],
      { encoding: 'utf8', env: { ...process.env, TMPDIR: root } }
    );
    const dir = (result.stdout || '').trim();
    check(
      result.status === 0,
      'createRunDir: the child exits 0',
      result.stderr
    );
    check(
      path.dirname(dir) === root &&
        path.basename(dir).startsWith('rill-devtest-'),
      'createRunDir: makes a rill-devtest- directory under TMPDIR',
      dir
    );
    check(
      fs.readdirSync(root).length === 0,
      'createRunDir: a normal exit removes the run directory',
      fs.readdirSync(root).join(', ')
    );
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (stats.fail > 0) {
  console.error(
    `FAIL test-tmp-test: ${stats.fail} failed, ${stats.pass} passed.`
  );
  process.exit(1);
}

console.log(
  `PASS test-tmp-test: ${stats.pass} assertions passed (temp-directory lifecycle).`
);
