/**
 * Size-ratio timing helper for performance regression tests.
 *
 * Absolute millisecond budgets flake under CI load and are too loose to catch
 * a real slowdown. A ratio between two input sizes measured on the same
 * machine in the same process cancels out runner speed, so it only moves when
 * the algorithm's growth rate changes.
 */

async function timeOnce(
  runAt: (n: number) => unknown,
  n: number
): Promise<number> {
  const start = performance.now();
  await runAt(n);
  return performance.now() - start;
}

/**
 * Best-of-`repeats` time at size `large` divided by best-of-`repeats` time at
 * size `small`. Taking the minimum discards load spikes, which only inflate a
 * sample. A linear workload yields a ratio near `large / small`.
 *
 * The two sizes are sampled interleaved, alternating which runs first, so
 * load that rises or falls during the measurement lands on both sides. Timing
 * every small run before every large run let a load shift between the two
 * blocks move the ratio past its bound under a parallel test run.
 */
export async function scalingRatio(
  runAt: (n: number) => unknown,
  small: number,
  large: number,
  repeats: number
): Promise<number> {
  let smallBest = Number.POSITIVE_INFINITY;
  let largeBest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < repeats; i++) {
    if (i % 2 === 0) {
      smallBest = Math.min(smallBest, await timeOnce(runAt, small));
      largeBest = Math.min(largeBest, await timeOnce(runAt, large));
    } else {
      largeBest = Math.min(largeBest, await timeOnce(runAt, large));
      smallBest = Math.min(smallBest, await timeOnce(runAt, small));
    }
  }
  return largeBest / smallBest;
}
