/**
 * Temp-directory lifecycle for the dependency-free tests in this package.
 *
 * `createRunDir()` makes one directory per test run, so fixtures nest under a
 * single tree, removed when the process exits. A signal, such as pnpm's
 * fail-fast abort of a sibling script, ends the process without that cleanup.
 * A signal handler cannot help: the tests block in `spawnSync`, so Node would
 * deliver the signal only after the run finished, keeping a killed run alive.
 * Instead a killed run leaves one directory, and each later run sweeps run
 * directories older than an hour, which spares a run still in progress.
 *
 * Not published: test support only.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_PREFIX = 'rill-devtest-';
// Prefixes baseline-test.cjs used before the per-run directory, swept with it.
const STALE_PREFIXES = [
  RUN_PREFIX,
  'rill-baseline-',
  'rill-checkstd-',
  'rill-sentinel-',
];
const STALE_AGE_MS = 60 * 60 * 1000;

function removeTree(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort: another run may have removed it first */
  }
}

// sweepStaleRuns — remove run directories older than maxAgeMs under tmp.
function sweepStaleRuns(tmp = os.tmpdir(), maxAgeMs = STALE_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  let entries = [];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const full = path.join(tmp, name);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) removeTree(full);
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

module.exports = { createRunDir, sweepStaleRuns, RUN_PREFIX, STALE_PREFIXES };
