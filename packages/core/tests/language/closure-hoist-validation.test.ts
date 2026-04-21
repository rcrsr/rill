/**
 * Rill Runtime Tests: Closure Hoist Validation
 *
 * Validates two assumptions logged during Phase 7 of the error-handling
 * initiative (see conduct/initiatives/error-handling/feedback.md):
 *
 * - VAL-1: After hoisting closure construction out of evaluateMap /
 *   evaluateEach (collections.ts:529-533, :625-629), the closure's
 *   definingScope is the outer ctx rather than a per-iteration child ctx.
 *   Late-bound variables defined in outer scopes must still resolve via the
 *   definingScope.parent walk for every iteration.
 * - VAL-2: captureClosureAnnotations (literals.ts:78) clears
 *   ctx.immediateAnnotation exactly once; annotations live on the
 *   ScriptCallable.annotations field at creation time. Repeated invocations
 *   and repeated `.^key` reads on the same closure must return the same
 *   reflection results.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Closure Hoist Validation', () => {
  describe('VAL-1: definingScope.parent resolution across map/each after hoist', () => {
    it('resolves outer variable inside map block body (hoisted closure path)', async () => {
      const script = `
        10 => $multiplier
        list[1, 2, 3] -> map { $multiplier * $ }
      `;
      expect(await run(script)).toEqual([10, 20, 30]);
    });

    it('resolves outer variable inside each block body (hoisted closure path)', async () => {
      const script = `
        10 => $multiplier
        list[1, 2, 3] -> each { $multiplier * $ }
      `;
      expect(await run(script)).toEqual([10, 20, 30]);
    });

    it('resolves outer variable inside map inline closure body', async () => {
      const script = `
        10 => $multiplier
        list[1, 2, 3] -> map |x| ($x * $multiplier)
      `;
      expect(await run(script)).toEqual([10, 20, 30]);
    });

    it('resolves outer variable inside each inline closure body', async () => {
      const script = `
        10 => $multiplier
        list[1, 2, 3] -> each |x| ($x * $multiplier)
      `;
      expect(await run(script)).toEqual([10, 20, 30]);
    });

    it('resolves outer variable defined in surrounding block for map body', async () => {
      const script = `
        "" -> {
          4 => $multiplier
          list[1, 2, 3] -> map { $multiplier * $ }
        }
      `;
      expect(await run(script)).toEqual([4, 8, 12]);
    });

    it('resolves outer variable defined in surrounding block for each body', async () => {
      const script = `
        "" -> {
          4 => $multiplier
          list[1, 2, 3] -> each { $multiplier * $ }
        }
      `;
      expect(await run(script)).toEqual([4, 8, 12]);
    });

    it('resolves nested outer bindings with both $ and outer var in map body', async () => {
      const script = `
        2 => $base
        "" -> {
          5 => $multiplier
          list[1, 2, 3] -> map { ($multiplier * $) + $base }
        }
      `;
      expect(await run(script)).toEqual([7, 12, 17]);
    });

    it('resolves nested outer bindings with both $ and outer var in each body', async () => {
      const script = `
        2 => $base
        "" -> {
          5 => $multiplier
          list[1, 2, 3] -> each { ($multiplier * $) + $base }
        }
      `;
      expect(await run(script)).toEqual([7, 12, 17]);
    });
  });

  describe('VAL-2: annotation persistence across 3+ invocations', () => {
    it('returns identical .^min across three repeated accesses', async () => {
      const script = `
        ^(min: 5, max: 99) |x|($x) => $fn
        list[$fn.^min, $fn.^min, $fn.^min]
      `;
      expect(await run(script)).toEqual([5, 5, 5]);
    });

    it('returns identical .^max across three repeated accesses', async () => {
      const script = `
        ^(min: 5, max: 99) |x|($x) => $fn
        list[$fn.^max, $fn.^max, $fn.^max]
      `;
      expect(await run(script)).toEqual([99, 99, 99]);
    });

    it('returns consistent reflection for mixed repeated accesses of .^min and .^max', async () => {
      const script = `
        ^(min: 5, max: 99) |x|($x) => $fn
        list[$fn.^min, $fn.^min, $fn.^min, $fn.^max, $fn.^max, $fn.^max]
      `;
      expect(await run(script)).toEqual([5, 5, 5, 99, 99, 99]);
    });

    it('preserves .^min after three regular invocations of the callable', async () => {
      const script = `
        ^(min: 5, max: 99) |x|($x) => $fn
        list[$fn(1), $fn(2), $fn(3)] => $calls
        $fn.^min
      `;
      expect(await run(script)).toBe(5);
    });

    it('preserves .^max after three regular invocations of the callable', async () => {
      const script = `
        ^(min: 5, max: 99) |x|($x) => $fn
        list[$fn(1), $fn(2), $fn(3)] => $calls
        $fn.^max
      `;
      expect(await run(script)).toBe(99);
    });
  });
});
