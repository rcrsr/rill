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
export const PERCENTILE_WARMUP_COUNT = 5;
/** Number of timed samples collected per `measureP95` call. */
export const PERCENTILE_SAMPLE_COUNT = 100;

/** Sorts `samples` ascending and returns the p95 value (index 94 of 100). */
export function computeP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1
  );
  return sorted[index]!;
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
