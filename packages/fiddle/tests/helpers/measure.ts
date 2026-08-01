/**
 * Warm-state latency measurement for the performance tests.
 *
 * A single `performance.now()` around one call measures JIT compilation and
 * first-touch page faults as much as the code under test. That is not a
 * small effect at this scale: tokenising an *empty* document once measured
 * 3.08ms against a 1ms budget on CI, and an empty document has no work in
 * it to be slow at. The number was entirely cold-start.
 *
 * Discarding warmup iterations and taking a percentile over the rest
 * measures the steady state these budgets are actually about - the editor
 * highlighting on every keystroke, not the first frame after page load.
 */

/** Sorts `samples` ascending and returns the p95 value. */
function computeP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1
  );
  return sorted[index]!;
}

/**
 * Runs `fn` `warmup` times untimed, then `samples` times timed, and returns
 * the p95 in milliseconds.
 *
 * Scale the counts to the workload. Cheap operations want many samples,
 * because at microsecond scale a single preemption dominates any one
 * reading. Operations already costing hundreds of milliseconds want few:
 * they self-average over their own internal iterations, and 100 samples of
 * a 10,000-line document would cost more wall-clock than the rest of the
 * suite combined.
 */
export function measureP95(
  fn: () => void,
  { samples, warmup }: { samples: number; warmup: number }
): number {
  // A zero sample count reaches computeP95 with an empty array, which
  // returns undefined rather than throwing, and `expect(undefined)
  // .toBeLessThan(budget)` then fails for a reason the message never
  // mentions. A benchmark that measured nothing should say so.
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`measureP95 needs at least one sample, got ${samples}.`);
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new Error(
      `measureP95 needs a non-negative warmup count, got ${warmup}.`
    );
  }

  for (let i = 0; i < warmup; i++) {
    fn();
  }

  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    timings.push(performance.now() - start);
  }
  return computeP95(timings);
}
