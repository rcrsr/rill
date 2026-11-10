/**
 * Rill Language: Collection Slicing
 *
 * Specifies the slicing operators `start_when`, `cycle`, and `skip`:
 *
 * - `start_when(pred)` discards elements until the predicate first matches,
 *   then passes that element and every later one through without
 *   re-evaluating the predicate.
 * - `cycle` repeats its input as a lazy iterator; a bounded consumer such as
 *   `take(n)` or a `break` ends it, and an unbounded consumer halts at the
 *   iteration ceiling.
 * - `skip(n)` drops the first n elements; a fractional n halts with
 *   #INVALID_INPUT and a non-number n is a parameter type mismatch.
 *
 * Basic cases for each operator also live in collection-operators.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Collection Slicing', () => {
  describe('start_when', () => {
    it('returns an empty list when the predicate never matches', async () => {
      expect(await run('list[1, 2, 3] -> start_when({ $ > 100 })')).toEqual([]);
    });

    it('stays triggered after the first match without re-evaluating the predicate', async () => {
      expect(await run('list[1, 5, 2, 6, 1] -> start_when({ $ > 4 })')).toEqual(
        [5, 2, 6, 1]
      );
    });

    it('slices a string input into characters from the first match', async () => {
      expect(await run('"abcde" -> start_when({ $ == "c" })')).toEqual([
        'c',
        'd',
        'e',
      ]);
    });

    it('slices a dict input into entries from the first match', async () => {
      expect(
        await run(
          'dict[a: 1, b: 2, c: 3] -> start_when({ $.value == 2 }) -> seq({ $.key })'
        )
      ).toEqual(['b', 'c']);
    });

    it('slices an iterator input', async () => {
      expect(await run('range(1, 8) -> start_when({ $ > 4 })')).toEqual([
        5, 6, 7,
      ]);
    });

    it('accepts a named closure captured in a variable', async () => {
      expect(
        await run(
          '|x| ($x > 3) => $threshold\nrange(1, 8) -> start_when($threshold)'
        )
      ).toEqual([4, 5, 6, 7]);
    });

    it('chains with stop_when to extract a content-gated slice', async () => {
      expect(
        await run(
          'range(1, 11) -> start_when({ $ >= 3 }) -> stop_when({ $ >= 7 })'
        )
      ).toEqual([3, 4, 5, 6, 7]);
    });
  });

  describe('cycle', () => {
    it('repeats a single-element list', async () => {
      expect(await run('list["x"] -> cycle -> take(4)')).toEqual([
        'x',
        'x',
        'x',
        'x',
      ]);
    });

    it('chains cycle, take, and seq', async () => {
      expect(
        await run('list[1, 2] -> cycle -> take(5) -> seq({ $ * 10 })')
      ).toEqual([10, 20, 10, 20, 10]);
    });

    it('halts with the iteration ceiling when consumed without a bound', async () => {
      await expect(run('list[1, 2, 3] -> cycle -> seq({ $ })')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R010' })
      );
    });

    it('is bounded by a break in a seq body and returns the collected prefix', async () => {
      expect(
        await run('list[1, 2, 3] -> cycle -> seq({ ($ > 2) ? break ! $ })')
      ).toEqual([1, 2]);
    });

    it('halts on a non-iterable input', async () => {
      await expectHalt(() => run('5 -> cycle -> take(3)'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
      });
    });
  });

  describe('skip', () => {
    it('combines with take to extract a positional slice', async () => {
      expect(await run('range(1, 11) -> skip(3) -> take(3)')).toEqual([
        4, 5, 6,
      ]);
    });

    it('drops leading characters of a string', async () => {
      expect(await run('"abcde" -> skip(2)')).toEqual(['c', 'd', 'e']);
    });

    it('drops leading entries of a dict', async () => {
      expect(
        await run('dict[a: 1, b: 2, c: 3] -> skip(1) -> seq({ $.key })')
      ).toEqual(['b', 'c']);
    });

    it('halts with #INVALID_INPUT for a fractional n', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> skip(1.5)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('rejects a non-number n with a parameter type mismatch', async () => {
      await expect(run('list[1, 2, 3] -> skip("2")')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R001' })
      );
    });
  });
});
