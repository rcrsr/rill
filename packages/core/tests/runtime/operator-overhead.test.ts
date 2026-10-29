/**
 * Rill Runtime Tests: Operator Per-Chunk Overhead
 *
 * debounce, throttle, sample, iterate, batch<idle_flush:>, range and repeat
 * must cost time proportional to the chunk count. Each case runs the operator
 * at two sizes and asserts that a 4x increase in chunks gives a time ratio
 * below 8 (linear is near 4, quadratic is near 16). Every run also checks the
 * operator's result, so a fast but wrong implementation fails.
 *
 * debounce, throttle, sample and batch use a static-clock path: the input is
 * fully materialised, then filtered in one O(n) pass. iterate emits chunks
 * lazily, one closure invocation per chunk. range and repeat go through
 * makeGenericIterator.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { scalingRatio } from '../helpers/scaling.js';

const SMALL_COUNT = 1000;
const LARGE_COUNT = 4000;
const REPEATS = 5;

/**
 * Loose absolute ceiling on the best large-size run, per chunk. Far above
 * observed cost, so only a gross constant-factor slowdown trips it.
 */
const MAX_MS_PER_CHUNK = 10;

/** A 4x size increase must not multiply time by 8x or more. */
const MAX_SCALING_RATIO = 8;

interface OperatorCase {
  readonly name: string;
  readonly script: (n: number) => string;
  /** Returns a failure description, or undefined when the result is correct. */
  readonly check: (result: unknown, n: number) => string | undefined;
}

const expectEqual =
  (expected: (n: number) => unknown) =>
  (result: unknown, n: number): string | undefined =>
    JSON.stringify(result) === JSON.stringify(expected(n))
      ? undefined
      : `expected ${JSON.stringify(expected(n))?.slice(0, 40)}, got ${JSON.stringify(result)?.slice(0, 40)}`;

const CASES: readonly OperatorCase[] = [
  {
    name: 'debounce',
    script: (n) => `range(0, ${n}) -> debounce(duration(0, 0, 0, 0, 0, 0, 50))`,
    check: expectEqual((n) => [n - 1]),
  },
  {
    name: 'throttle',
    script: (n) =>
      `range(0, ${n}) -> throttle(duration(0, 0, 0, 0, 0, 0, 100))`,
    check: expectEqual(() => [0]),
  },
  {
    name: 'sample',
    script: (n) => `range(0, ${n}) -> sample(duration(0, 0, 0, 0, 0, 0, 100))`,
    check: expectEqual((n) => [n - 1]),
  },
  {
    name: 'iterate',
    script: (n) => `iterate(0, { $ + 1 }) -> take(${n})`,
    check: (result, n) => {
      const list = result as number[];
      return Array.isArray(list) &&
        list.length === n &&
        list[0] === 0 &&
        list[n - 1] === n - 1
        ? undefined
        : 'iterate did not yield the first n integers';
    },
  },
  {
    name: 'batch<idle_flush:>',
    script: (n) =>
      `range(0, ${n}) -> batch(10, dict[idle_flush: duration(0, 0, 0, 0, 0, 0, 50)])`,
    check: (result, n) =>
      Array.isArray(result) && result.length === n / 10
        ? undefined
        : 'batch did not produce n / 10 groups',
  },
  {
    name: 'range',
    script: (n) => `range(0, ${n}) -> seq({ $ })`,
    check: (result, n) =>
      Array.isArray(result) && result.length === n
        ? undefined
        : 'range -> seq did not yield n items',
  },
  {
    name: 'repeat',
    script: (n) => `repeat(1, ${n}) -> seq({ $ })`,
    check: (result, n) =>
      Array.isArray(result) && result.length === n
        ? undefined
        : 'repeat -> seq did not yield n items',
  },
];

describe('operator per-chunk overhead scales linearly', () => {
  it.each(CASES)(
    '$name',
    async ({ script, check }) => {
      // Warmup: let the JIT optimize before measuring.
      for (let i = 0; i < 3; i++) {
        await run(script(SMALL_COUNT));
        await run(script(LARGE_COUNT));
      }

      // No assertions inside the timed region; failures are collected and
      // asserted after timing.
      const failures: string[] = [];
      let bestLargeMs = Number.POSITIVE_INFINITY;
      const ratio = await scalingRatio(
        async (n) => {
          const start = performance.now();
          const result = await run(script(n));
          if (n === LARGE_COUNT) {
            bestLargeMs = Math.min(bestLargeMs, performance.now() - start);
          }
          const failure = check(result, n);
          if (failure !== undefined) failures.push(`n=${n}: ${failure}`);
        },
        SMALL_COUNT,
        LARGE_COUNT,
        REPEATS
      );

      expect(failures).toEqual([]);
      expect(ratio).toBeLessThan(MAX_SCALING_RATIO);
      expect(bestLargeMs / LARGE_COUNT).toBeLessThan(MAX_MS_PER_CHUNK);
    },
    60000
  );
});
