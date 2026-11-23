/**
 * Temp-directory lifecycle for the dependency-free tests in this package.
 *
 * `createRunDir()` makes one directory per test run, so fixtures nest under a
 * single tree, removed when the process exits. A signal, such as pnpm's
 * fail-fast abort of a sibling script, ends the process without that cleanup.
 * A signal handler cannot help: the tests block in `spawnSync`, so Node would
 * deliver the signal only after the run finished, keeping a killed run alive.
 * Instead a killed run leaves one directory, and each later run sweeps run
 * directories whose mtime is over an hour old. A directory's mtime moves only
 * when a direct child is added or removed, so the sweep spares a run younger
 * than an hour, not every run still in progress. A full run takes about a
 * minute.
 *
 * Not published: test support only.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_PREFIX = 'rill-devtest-';
// The run prefix, plus the prefixes baseline-test.cjs used before the per-run
// directory, swept with it.
const STALE_PREFIXES = [
  RUN_PREFIX,
  'rill-baseline-',
  'rill-checkstd-',
  'rill-sentinel-',
];
// mkdtemp appends exactly six characters. Matching that shape keeps the sweep
// off a directory someone named by hand, such as a project called rill-baseline-x.
const STALE_NAME = new RegExp(
  `^(?:${STALE_PREFIXES.join('|')})[A-Za-z0-9]{6}$`
);
const STALE_AGE_MS = 60 * 60 * 1000;

function removeTree(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort: another run may have removed it first */
  }
}

// ownedByMe — true when the current user owns stat, or the platform has no uids.
function ownedByMe(stat) {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

// sweepStaleRuns — remove this user's run directories older than maxAgeMs
// under tmp. A relative tmp, such as a relative TMPDIR, is not swept: it
// resolves against the working directory, which is not a scratch area.
function sweepStaleRuns(tmp = os.tmpdir(), maxAgeMs = STALE_AGE_MS) {
  if (!path.isAbsolute(tmp)) return;
  const cutoff = Date.now() - maxAgeMs;
  let entries = [];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!STALE_NAME.test(name)) continue;
    const full = path.join(tmp, name);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff && ownedByMe(stat)) {
        removeTree(full);
      }
    } catch {
      /* best-effort */
    }
  }
}

// createRunDir — sweep stale runs, then make this run's directory and arrange
// its removal on exit.
function createRunDir() {
  sweepStaleRuns();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX));
  const cleanup = () => removeTree(dir);
  process.on('exit', cleanup);
  return { dir, cleanup };
}

module.exports = { createRunDir, sweepStaleRuns };
