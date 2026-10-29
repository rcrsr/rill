/**
 * Size-ratio timing helper for performance regression tests.
 *
 * Absolute millisecond budgets flake under CI load and are too loose to catch
 * a real slowdown. A ratio between two input sizes measured on the same
 * machine in the same process cancels out runner speed, so it only moves when
 * the algorithm's growth rate changes.
 */

async function measureBestMs(
  runAt: (n: number) => unknown | Promise<unknown>,
  n: number,
  repeats: number
): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    await runAt(n);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * Best-of-`repeats` time at size `large` divided by best-of-`repeats` time at
 * size `small`. Taking the minimum discards load spikes, which only inflate a
 * sample. A linear workload yields a ratio near `large / small`.
 */
export async function scalingRatio(
  runAt: (n: number) => unknown | Promise<unknown>,
  small: number,
  large: number,
  repeats: number
): Promise<number> {
  const smallMs = await measureBestMs(runAt, small, repeats);
  const largeMs = await measureBestMs(runAt, large, repeats);
  return largeMs / smallMs;
}
