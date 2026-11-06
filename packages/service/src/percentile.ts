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
  const value = sorted[index];
  // Unreachable in practice: measureP95 always passes PERCENTILE_SAMPLE_COUNT
  // samples. The type system cannot express that, so empty input yields NaN.
  return value === undefined ? Number.NaN : value;
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
 * Returns `fn`'s p95 as a multiple of `referenceFn`'s p95, sampling the two
 * interleaved: each round times one call of each, alternating which runs
 * first.
 *
 * `measureRatioP95` takes a reference measured earlier, so load that rises
 * or falls between the two measurements lands on one side of the ratio
 * only. Under a parallel test run that shift alone has pushed a linear
 * workload's ratio to twice its quiet value. Interleaving puts every
 * sample of `fn` next to a sample of `referenceFn` taken under the same
 * load, so a sustained or drifting slowdown inflates both and cancels.
 *
 * Use this where the budget is tight relative to the noise, or where the
 * reference is a different size of the same workload. It costs one
 * reference run per sample, so a suite that shares one reference across
 * many cases may prefer `measureRatioP95`.
 */
export function measureInterleavedRatioP95(
  fn: () => void,
  referenceFn: () => void
): number {
  for (let i = 0; i < PERCENTILE_WARMUP_COUNT; i++) {
    referenceFn();
    fn();
  }

  const samples: number[] = [];
  const referenceSamples: number[] = [];
  for (let i = 0; i < PERCENTILE_SAMPLE_COUNT; i++) {
    if (i % 2 === 0) {
      referenceSamples.push(timeOnce(referenceFn));
      samples.push(timeOnce(fn));
    } else {
      samples.push(timeOnce(fn));
      referenceSamples.push(timeOnce(referenceFn));
    }
  }
  return computeP95(samples) / computeP95(referenceSamples);
}

/**
 * Returns the median, over interleaved rounds, of `fn`'s time divided by
 * `referenceFn`'s time in the same round.
 *
 * `measureInterleavedRatioP95` divides two independently sorted tails, so a
 * single preemption that lands in one series and not the other moves the
 * ratio, and a correct workload has read 1.55x against a 1.5x budget. Here
 * each ratio comes from two calls timed back to back under the same load,
 * and the median discards the rounds a preemption hit. A sustained
 * regression still moves every round, so a 2x slowdown reads 2x.
 *
 * Use this where the budget sits close to the correct reading and a tail
 * spike is noise rather than signal.
 */
export function measureInterleavedRatioMedian(
  fn: () => void,
  referenceFn: () => void
): number {
  for (let i = 0; i < PERCENTILE_WARMUP_COUNT; i++) {
    referenceFn();
    fn();
  }

  const ratios: number[] = [];
  for (let i = 0; i < PERCENTILE_SAMPLE_COUNT; i++) {
    let sample: number;
    let reference: number;
    if (i % 2 === 0) {
      reference = timeOnce(referenceFn);
      sample = timeOnce(fn);
    } else {
      sample = timeOnce(fn);
      reference = timeOnce(referenceFn);
    }
    ratios.push(sample / reference);
  }
  const sorted = ratios.sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return Number.NaN;
  return (lower + upper) / 2;
}

/** Times a single call of `fn` in ms. */
function timeOnce(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
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
