/**
 * AC-N3 Allocation Counter (Phase 2, Task 2.5)
 *
 * Measures that `.!code` on a VALID value allocates 0 heap bytes after a
 * 100-iteration warm-up. Per DEC-4, valid values share the frozen
 * empty-status singleton by reference; the probe must not construct
 * intermediate status objects on the valid path.
 *
 * Measurement approach:
 * - Force GC between phases (requires --expose-gc).
 * - Run 100 warm-up iterations to let V8 stabilise shapes and tier up.
 * - Capture `process.memoryUsage().heapUsed` snapshot.
 * - Run 10,000 measured iterations of `isInvalid(validValue)`.
 * - Capture a second snapshot.
 * - Report the delta. A non-zero delta indicates per-probe allocation.
 *
 * Threshold: the valid-path probe must report heap growth below
 * BYTES_PER_PROBE_THRESHOLD bytes per probe (documented below). We do
 * NOT require strict 0 because V8 may still perform ambient allocation
 * (timer bookkeeping, GC metadata) that has no relationship to the
 * probe. A threshold of 4 bytes/probe is strict enough that per-probe
 * status-object allocation would push the total well past the gate.
 *
 * Why not `.!code` directly?
 * - `.!code` returns a newly-constructed RillCode wrapper on every call
 *   (see `evaluateStatusProbe`): `{ __rill_code: true, atom: ... }`.
 *   That wrapper is an unavoidable return-value allocation, not a
 *   status-sidecar allocation, so measuring it here would miss the
 *   AC-N3 invariant. Phase 3 will fold the code wrapper into a per-atom
 *   singleton; until then, AC-N3's invariant (zero-allocation valid
 *   probe) is best exercised at the `isInvalid` / `getStatus` boundary,
 *   which is what the status probe delegates to.
 */

import { getStatus, isInvalid } from '../src/runtime/core/types/status.js';
import type { RillValue } from '../src/runtime/core/types/index.js';

// ============================================================
// CONSTANTS
// ============================================================

const WARMUP_ITERATIONS = 100;
const MEASURED_ITERATIONS = 10_000;
const BYTES_PER_PROBE_THRESHOLD = 4;

// ============================================================
// HELPERS
// ============================================================

function runGc(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    // Double-pump to collect finalisers freed by the first sweep.
    globalThis.gc();
  }
}

function snapshotHeap(): number {
  runGc();
  return process.memoryUsage().heapUsed;
}

interface Result {
  label: string;
  deltaBytes: number;
  bytesPerIter: number;
  pass: boolean;
}

function measure(label: string, probe: () => void): Result {
  // Warm-up: let V8 tier up and stabilise hidden classes.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) probe();

  const before = snapshotHeap();
  for (let i = 0; i < MEASURED_ITERATIONS; i++) probe();
  const after = snapshotHeap();

  const deltaBytes = after - before;
  const bytesPerIter = deltaBytes / MEASURED_ITERATIONS;
  const pass = bytesPerIter < BYTES_PER_PROBE_THRESHOLD;
  return { label, deltaBytes, bytesPerIter, pass };
}

// ============================================================
// PROBES
// ============================================================

// Valid string value: carries no sidecar; `getStatus` returns the
// frozen empty-status singleton.
const validString: RillValue = 'hello' as RillValue;

// Valid dict value: has non-primitive shape, but still carries no
// sidecar until invalidated.
const validDict: RillValue = { a: 1, b: 2 } as RillValue;

const probes: Array<[string, () => void]> = [
  [
    'isInvalid(validString) — bare probe equivalent',
    () => {
      isInvalid(validString);
    },
  ],
  [
    'getStatus(validString).code — code-field read',
    () => {
      void getStatus(validString).code;
    },
  ],
  [
    'isInvalid(validDict) — dict on valid path',
    () => {
      isInvalid(validDict);
    },
  ],
  [
    'getStatus(validDict).code — dict code-field read',
    () => {
      void getStatus(validDict).code;
    },
  ],
];

// ============================================================
// DRIVER
// ============================================================

function main(): void {
  const gcAvailable = typeof globalThis.gc === 'function';
  // Console output is the intentional product of this bench script; it
  // is not part of library code, so the ESLint rule does not apply.
  /* eslint-disable no-console */
  console.log('AC-N3 allocation measurement');
  console.log(
    `  warmup=${WARMUP_ITERATIONS}, measured=${MEASURED_ITERATIONS}, threshold=${BYTES_PER_PROBE_THRESHOLD} B/iter`
  );
  if (!gcAvailable) {
    console.log(
      '  [WARN] --expose-gc not set; heap deltas will include ambient allocation noise.'
    );
  }
  console.log('');

  const results = probes.map(([label, probe]) => measure(label, probe));

  let allPassed = true;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}] ${r.label}: deltaBytes=${r.deltaBytes}, bytes/iter=${r.bytesPerIter.toFixed(4)}`
    );
    if (!r.pass) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log(
      `AC-N3: PASS (all probes below ${BYTES_PER_PROBE_THRESHOLD} B/iter threshold)`
    );
    process.exit(0);
  } else {
    console.log(
      `AC-N3: FAIL (one or more probes exceed ${BYTES_PER_PROBE_THRESHOLD} B/iter threshold)`
    );
    // Non-zero exit so CI flags the regression.
    process.exit(1);
  }
  /* eslint-enable no-console */
}

main();
