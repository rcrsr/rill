/**
 * Tests for CollectionsMixin
 *
 * Tests collection operators: each, map, fold, filter
 * Verifies error handling for non-iterable inputs and iteration limits.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('CollectionsMixin', () => {
  describe('evaluateEach', () => {
    it('executes sequential iteration with all results', async () => {
      const result = await run('[1, 2, 3] -> each { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });

    it('handles empty collections', async () => {
      const result = await run('[] -> each { $ * 2 }');
      expect(result).toEqual([]);
    });

    it('supports accumulator with scan pattern', async () => {
      const result = await run('[1, 2, 3] -> each(0) { $@ + $ }');
      expect(result).toEqual([1, 3, 6]);
    });

    it('supports break for early termination', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] -> each { ($ == 3) ? break ! $ }'
      );
      expect(result).toEqual([1, 2]);
    });

    it('iterates over strings as characters', async () => {
      const result = await run('"abc" -> each { $ }');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('iterates over dicts as key-value pairs', async () => {
      const result = await run('[a: 1, b: 2] -> each { $.key }');
      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('evaluateMap', () => {
    it('executes parallel iteration with all results', async () => {
      const result = await run('[1, 2, 3] -> map { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });

    it('handles empty collections', async () => {
      const result = await run('[] -> map { $ * 2 }');
      expect(result).toEqual([]);
    });

    it('processes all elements concurrently', async () => {
      const result = await run('[1, 2, 3] -> map { $ + 1 }');
      expect(result).toEqual([2, 3, 4]);
    });
  });

  describe('evaluateFold', () => {
    it('executes sequential reduction to final value', async () => {
      const result = await run('[1, 2, 3] -> fold(0) { $@ + $ }');
      expect(result).toBe(6);
    });

    it('returns initial accumulator for empty collections', async () => {
      const result = await run('[] -> fold(10) { $@ + $ }');
      expect(result).toBe(10);
    });

    it('supports closure with accumulator parameter', async () => {
      const result = await run('[1, 2, 3] -> fold |x, acc = 0| ($acc + $x)');
      expect(result).toBe(6);
    });

    it('throws error when accumulator is missing', async () => {
      await expect(run('[1, 2, 3] -> fold { $@ + $ }')).rejects.toThrow(
        'Fold requires accumulator'
      );
    });
  });

  describe('evaluateFilter', () => {
    it('filters elements where predicate is true', async () => {
      const result = await run('[1, 2, 3, 4, 5] -> filter { $ > 2 }');
      expect(result).toEqual([3, 4, 5]);
    });

    it('handles empty collections', async () => {
      const result = await run('[] -> filter { $ > 2 }');
      expect(result).toEqual([]);
    });

    it('preserves original element order', async () => {
      const result = await run('[5, 1, 3, 2, 4] -> filter { $ > 2 }');
      expect(result).toEqual([5, 3, 4]);
    });

    it('throws error when predicate is not boolean', async () => {
      await expect(run('[1, 2, 3] -> filter { $ * 2 }')).rejects.toThrow(
        'Filter predicate must return boolean'
      );
    });
  });

  describe('error handling', () => {
    it('throws error for non-iterable input to each', async () => {
      await expect(run('42 -> each { $ }')).rejects.toThrow(
        'Collection operators require'
      );
    });

    it('throws error for non-iterable input to map', async () => {
      await expect(run('true -> map { $ }')).rejects.toThrow(
        'Collection operators require'
      );
    });

    it('throws error for non-iterable input to fold', async () => {
      await expect(run('42 -> fold(0) { $@ + $ }')).rejects.toThrow(
        'Collection operators require'
      );
    });

    it('throws error for non-iterable input to filter', async () => {
      await expect(run('42 -> filter { $ > 0 }')).rejects.toThrow(
        'Collection operators require'
      );
    });

    it('propagates errors from iterator body evaluation', async () => {
      await expect(run('[1, 2, 3] -> each { $undefined }')).rejects.toThrow(
        'Undefined variable'
      );
    });
  });

  describe('iteration limits', () => {
    it('throws error when iterator expansion exceeds limit', async () => {
      // Create an iterator that exceeds the default 10,000 limit
      const script = 'range(1, 20000) -> each { $ }';

      await expect(run(script)).rejects.toThrow(
        expect.objectContaining({
          errorId: 'RILL-R010',
          message: expect.stringMatching(
            /Iterator expansion exceeded 10000 iterations/
          ),
        })
      );
    });

    it('respects concurrency limit annotation in map', async () => {
      // The annotation should limit parallel processing
      const result = await run('^(limit: 2) [1, 2, 3, 4] -> map { $ * 2 }');
      expect(result).toEqual([2, 4, 6, 8]);
    });
  });

  describe('iterator body forms', () => {
    it('supports inline closure body', async () => {
      const result = await run('[1, 2, 3] -> each |x| ($x * 2)');
      expect(result).toEqual([2, 4, 6]);
    });

    it('supports block body', async () => {
      const result = await run('[1, 2, 3] -> each { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });

    it('supports variable closure body', async () => {
      const result = await run(
        '|x|($x * 2) :> $double\n[1, 2, 3] -> each $double'
      );
      expect(result).toEqual([2, 4, 6]);
    });

    it('supports bare $ as identity', async () => {
      const result = await run('[1, 2, 3] -> each { $ }');
      expect(result).toEqual([1, 2, 3]);
    });

    it('supports property access on element', async () => {
      const result = await run('[[name: "a"], [name: "b"]] -> each { $.name }');
      expect(result).toEqual(['a', 'b']);
    });
  });
});
