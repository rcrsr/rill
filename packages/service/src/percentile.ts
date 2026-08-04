/**
 * Shared p95 latency measurement helpers.
 *
 * Extracted from `latency.test.ts` so complexity/latency suites elsewhere
 * (e.g. `rules/nesting-scale.test.ts`) can reuse the exact same percentile
 * computation without importing a `.test.ts` module - importing a test
 * module would re-execute its top-level `describe`/`it` calls as a side
 * effect, duplicating that suite's tests under the importing file.
 */

/** Warmup iterations run (and discarded) before timed sampling begins. */
const PERCENTILE_WARMUP_COUNT = 5;
/** Number of timed samples collected per `measureP95` call. */
const PERCENTILE_SAMPLE_COUNT = 100;

/** Sorts `samples` ascending and returns the p95 value (index 94 of 100). */
function computeP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1
  );
  return sorted[index]!;
}

/**
 * Returns `fn`'s p95 as a multiple of `referenceP95Ms`, a reference
 * workload's p95 measured by `measureP95` in the same process.
 *
 * An absolute millisecond budget conflates two questions: is this code
 * slow, and is this machine slow. On a contended shared runner the second
 * dominates, which is why every absolute budget in this repository has been
 * raised after a flake rather than after a regression. Dividing by a
 * reference measured on the same machine cancels the machine out: a runner
 * 5x slower inflates both numerator and denominator, so the ratio holds and
 * the budget can be tight.
 *
 * Pick a reference of the same order of magnitude and shape as `fn`. The
 * cancellation is empirical, not exact - it depends on both workloads
 * responding to cache pressure and preemption alike - and it degrades for
 * operations short enough that scheduler noise is large next to their own
 * cost.
 *
 * The caller passes a number rather than a thunk so one reference
 * measurement can normalise a whole suite. Measure it near the cases it
 * normalises, in a `beforeAll` rather than at module scope: sustained load
 * is what a shared runner imposes, but a reference measured minutes away
 * from its cases is normalising against different conditions.
 *
 * The tradeoff is that a regression in the reference masks a regression in
 * `fn`. Reference the cheapest workload that still tracks `fn`, and keep it
 * under its own guard.
 */
export function measureRatioP95(
  fn: () => void,
  referenceP95Ms: number
): number {
  // Most bad references fail closed: 0 gives Infinity and NaN gives NaN,
  // and no budget accepts either. A negative one is the exception. It makes
  // the ratio negative, every budget accepts a negative, and the suite goes
  // green having measured nothing - the one failure this file exists to
  // prevent. Reject all of them here so the cause arrives as itself rather
  // than as a budget breach with no explanation.
  if (!Number.isFinite(referenceP95Ms) || referenceP95Ms <= 0) {
    throw new Error(
      `measureRatioP95 needs a positive reference p95 in ms, got ${referenceP95Ms}. ` +
        'Zero usually means the beforeAll that measures the reference did not run.'
    );
  }
  return measureP95(fn) / referenceP95Ms;
}

/**
 * Runs `fn` for `PERCENTILE_WARMUP_COUNT` warmup iterations, then measures
 * `PERCENTILE_SAMPLE_COUNT` timed samples and returns the p95 in ms.
 */
export function measureP95(fn: () => void): number {
  for (let i = 0; i < PERCENTILE_WARMUP_COUNT; i++) {
    fn();
  }

  const samples: number[] = [];
  for (let i = 0; i < PERCENTILE_SAMPLE_COUNT; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return computeP95(samples);
}
