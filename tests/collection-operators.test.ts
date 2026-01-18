/**
 * Rill Runtime Tests: Collection Operators (each, map, fold)
 *
 * Tests for each (sequential iteration), map (parallel iteration), and fold (reduction).
 */

import type { RillValue } from '../src/index.js';
import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

// Helper functions
const double = (args: RillValue[]): number => {
  const x = args[0];
  return typeof x === 'number' ? x * 2 : 0;
};

const add = (args: RillValue[]): number => {
  const a = args[0];
  const b = args[1];
  return (typeof a === 'number' ? a : 0) + (typeof b === 'number' ? b : 0);
};

describe('Rill Runtime: Collection Operators', () => {
  describe('each - Sequential Iteration', () => {
    it('iterates with inline closure', async () => {
      const result = await run('[1, 2, 3] -> each |x| ($x * 2)');
      expect(result).toEqual([2, 4, 6]);
    });

    it('iterates with block body', async () => {
      const result = await run('[1, 2, 3] -> each { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });

    it('iterates with grouped expression', async () => {
      const result = await run('[1, 2, 3] -> each ($ + 10)');
      expect(result).toEqual([11, 12, 13]);
    });

    it('iterates with variable closure', async () => {
      // Define $fn as a closure first, then use it in each
      const script = `
        |x| ($x * 2) -> $fn
        [1, 2, 3] -> each $fn
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('identity with bare $', async () => {
      const result = await run('[1, 2, 3] -> each $');
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty list for empty collection', async () => {
      const result = await run('[] -> each { $ * 2 }');
      expect(result).toEqual([]);
    });

    it('iterates over string characters', async () => {
      const result = await run('"abc" -> each { "{$}!" }');
      expect(result).toEqual(['a!', 'b!', 'c!']);
    });

    it('iterates over dict entries', async () => {
      const result = await run('[a: 1, b: 2] -> each { $.value * 2 }');
      expect(result).toEqual([2, 4]);
    });

    it('supports break for early termination', async () => {
      const script = `
        [1, 2, 3, 4, 5] -> each {
          ($ == 3) ? break
          $ * 2
        }
      `;
      // break terminates at 3, returning results collected before break
      expect(await run(script)).toEqual([2, 4]);
    });

    describe('with accumulator', () => {
      it('accumulator via block form with $@', async () => {
        // Running sum (scan pattern)
        const script = '[1, 2, 3] -> each(0) { $@ + $ }';
        expect(await run(script)).toEqual([1, 3, 6]);
      });

      it('accumulator via inline closure', async () => {
        // Running sum with inline closure
        const script = '[1, 2, 3] -> each |x, acc = 0| ($acc + $x)';
        expect(await run(script)).toEqual([1, 3, 6]);
      });

      it('string accumulation', async () => {
        const script = '["a", "b", "c"] -> each("") { "{$@}{$}" }';
        expect(await run(script)).toEqual(['a', 'ab', 'abc']);
      });
    });
  });

  describe('map - Parallel Iteration', () => {
    it('iterates with inline closure', async () => {
      const result = await run('[1, 2, 3] -> map |x| ($x * 2)');
      expect(result).toEqual([2, 4, 6]);
    });

    it('iterates with block body', async () => {
      const result = await run('[1, 2, 3] -> map { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });

    it('iterates with grouped expression', async () => {
      const result = await run('[1, 2, 3] -> map ($ + 10)');
      expect(result).toEqual([11, 12, 13]);
    });

    it('identity with bare $', async () => {
      const result = await run('[1, 2, 3] -> map $');
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty list for empty collection', async () => {
      const result = await run('[] -> map { $ * 2 }');
      expect(result).toEqual([]);
    });

    it('iterates over string characters', async () => {
      const result = await run('"abc" -> map { "{$}!" }');
      expect(result).toEqual(['a!', 'b!', 'c!']);
    });

    it('iterates over dict entries', async () => {
      const result = await run('[a: 1, b: 2] -> map { $.value * 2 }');
      expect(result).toEqual([2, 4]);
    });

    it('preserves order despite parallel execution', async () => {
      // Even with parallel execution, order should be preserved
      const script = '[1, 2, 3, 4, 5] -> map { $ }';
      expect(await run(script)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('fold - Sequential Reduction', () => {
    it('reduces with inline closure', async () => {
      // Sum via fold
      const script = '[1, 2, 3] -> fold |x, acc = 0| ($acc + $x)';
      expect(await run(script)).toBe(6);
    });

    it('reduces with block body and $@', async () => {
      // Sum via block form
      const script = '[1, 2, 3] -> fold(0) { $@ + $ }';
      expect(await run(script)).toBe(6);
    });

    it('string concatenation', async () => {
      const script = '["a", "b", "c"] -> fold("") { "{$@}{$}" }';
      expect(await run(script)).toBe('abc');
    });

    it('returns initial value for empty collection', async () => {
      const script = '[] -> fold(42) { $@ + $ }';
      expect(await run(script)).toBe(42);
    });

    it('product reduction', async () => {
      const script = '[1, 2, 3, 4] -> fold(1) { $@ * $ }';
      expect(await run(script)).toBe(24);
    });

    it('max reduction', async () => {
      const script = `
        [3, 1, 4, 1, 5, 9] -> fold(0) {
          ($@ > $) ? $@ ! $
        }
      `;
      expect(await run(script)).toBe(9);
    });

    it('count elements', async () => {
      const script = '[1, 2, 3, 4, 5] -> fold(0) { $@ + 1 }';
      expect(await run(script)).toBe(5);
    });

    it('reduce with variable closure', async () => {
      const script = `
        |x, acc = 0| ($acc + $x) -> $sum
        [1, 2, 3] -> fold $sum
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Comparison: each vs map vs fold', () => {
    it('each returns all intermediate results', async () => {
      const script = '[1, 2, 3] -> each(0) { $@ + $ }';
      // Running sum: [1, 3, 6]
      expect(await run(script)).toEqual([1, 3, 6]);
    });

    it('fold returns only final result', async () => {
      const script = '[1, 2, 3] -> fold(0) { $@ + $ }';
      // Final sum: 6
      expect(await run(script)).toBe(6);
    });

    it('map has no accumulator', async () => {
      const script = '[1, 2, 3] -> map { $ * 2 }';
      // Each element doubled independently
      expect(await run(script)).toEqual([2, 4, 6]);
    });
  });

  describe('Chaining', () => {
    it('chains multiple operations', async () => {
      // Double each, then sum
      const script = '[1, 2, 3] -> map { $ * 2 } -> fold(0) { $@ + $ }';
      expect(await run(script)).toBe(12);
    });

    it('filter-like with filter operator', async () => {
      // Use filter for filtering (cleaner than each + conditional)
      const script = `
        [1, 2, 3, 4, 5] -> filter { ($ % 2) == 0 }
      `;
      expect(await run(script)).toEqual([2, 4]);
    });
  });

  describe('Edge Cases', () => {
    it('single element collection', async () => {
      expect(await run('[42] -> each { $ * 2 }')).toEqual([84]);
      expect(await run('[42] -> map { $ * 2 }')).toEqual([84]);
      expect(await run('[42] -> fold(0) { $@ + $ }')).toBe(42);
    });

    it('nested collections', async () => {
      const script = '[[1, 2], [3, 4]] -> map { $ -> map { $ * 2 } }';
      expect(await run(script)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('works with function calls in body', async () => {
      const script = '[1, 2, 3] -> map { $ -> double }';
      expect(await run(script, { functions: { double } })).toEqual([2, 4, 6]);
    });
  });
});
