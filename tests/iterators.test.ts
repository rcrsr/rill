import { describe, it, expect } from 'vitest';
import { run } from './helpers/runtime.js';

describe('Rill Runtime: Iterators', () => {
  describe('range()', () => {
    it('generates basic range', async () => {
      expect(await run('range(0, 3) -> each { $ }')).toEqual([0, 1, 2]);
    });

    it('generates range with custom start', async () => {
      expect(await run('range(5, 8) -> each { $ }')).toEqual([5, 6, 7]);
    });

    it('generates range with step', async () => {
      expect(await run('range(0, 10, 2) -> each { $ }')).toEqual([
        0, 2, 4, 6, 8,
      ]);
    });

    it('generates descending range with negative step', async () => {
      expect(await run('range(5, 0, -1) -> each { $ }')).toEqual([
        5, 4, 3, 2, 1,
      ]);
    });

    it('returns empty iterator for invalid range', async () => {
      expect(await run('range(5, 3) -> each { $ }')).toEqual([]);
    });

    it('returns empty iterator for invalid descending range', async () => {
      expect(await run('range(0, 5, -1) -> each { $ }')).toEqual([]);
    });

    it('errors on zero step', async () => {
      await expect(run('range(0, 5, 0)')).rejects.toThrow(
        'step cannot be zero'
      );
    });

    it('works with map', async () => {
      expect(await run('range(1, 4) -> map { $ * 2 }')).toEqual([2, 4, 6]);
    });

    it('works with filter', async () => {
      expect(await run('range(0, 10) -> filter { ($ % 2) == 0 }')).toEqual([
        0, 2, 4, 6, 8,
      ]);
    });

    it('works with fold', async () => {
      expect(await run('range(1, 6) -> fold(0) { $@ + $ }')).toBe(15);
    });

    it('handles negative numbers', async () => {
      expect(await run('range(-3, 2) -> each { $ }')).toEqual([
        -3, -2, -1, 0, 1,
      ]);
    });

    it('handles negative to negative range', async () => {
      expect(await run('range(-5, -2) -> each { $ }')).toEqual([-5, -4, -3]);
    });

    it('returns empty for same start and end', async () => {
      expect(await run('range(5, 5) -> each { $ }')).toEqual([]);
    });

    it('generates single element range', async () => {
      expect(await run('range(0, 1) -> each { $ }')).toEqual([0]);
    });

    it('handles large step exceeding range', async () => {
      expect(await run('range(0, 5, 10) -> each { $ }')).toEqual([0]);
    });

    it('handles fractional step', async () => {
      expect(await run('range(0, 2, 0.5) -> each { $ }')).toEqual([
        0, 0.5, 1, 1.5,
      ]);
    });
  });

  describe('repeat()', () => {
    it('generates repeated value', async () => {
      expect(await run('repeat("x", 3) -> each { $ }')).toEqual([
        'x',
        'x',
        'x',
      ]);
    });

    it('generates repeated number', async () => {
      expect(await run('repeat(0, 4) -> each { $ }')).toEqual([0, 0, 0, 0]);
    });

    it('returns empty iterator for zero count', async () => {
      expect(await run('repeat("x", 0) -> each { $ }')).toEqual([]);
    });

    it('errors on negative count', async () => {
      await expect(run('repeat("x", -1)')).rejects.toThrow(
        'count cannot be negative'
      );
    });

    it('works with map', async () => {
      expect(await run('repeat(1, 3) -> map { $ + 10 }')).toEqual([11, 11, 11]);
    });

    it('works with fold', async () => {
      expect(await run('repeat(5, 4) -> fold(0) { $@ + $ }')).toBe(20);
    });

    it('repeats complex value (dict)', async () => {
      expect(await run('repeat([x: 1], 2) -> each { $.x }')).toEqual([1, 1]);
    });

    it('repeats complex value (list)', async () => {
      expect(await run('repeat([1, 2], 2) -> each { $ -> .len }')).toEqual([
        2, 2,
      ]);
    });

    it('single repeat', async () => {
      expect(await run('repeat("x", 1) -> each { $ }')).toEqual(['x']);
    });

    it('works with filter', async () => {
      expect(await run('repeat(5, 3) -> filter { $ > 3 }')).toEqual([5, 5, 5]);
    });
  });

  describe('.first() method', () => {
    it('returns iterator for list', async () => {
      const result = await run('[1, 2, 3] -> .first()');
      expect(result).toHaveProperty('value', 1);
      expect(result).toHaveProperty('done', false);
      expect(result).toHaveProperty('next');
    });

    it('returns iterator for string', async () => {
      const result = await run('"abc" -> .first()');
      expect(result).toHaveProperty('value', 'a');
      expect(result).toHaveProperty('done', false);
    });

    it('returns iterator for dict', async () => {
      const result = await run('[a: 1, b: 2] -> .first()');
      expect(result).toHaveProperty('done', false);
      expect((result as Record<string, unknown>).value).toEqual({
        key: 'a',
        value: 1,
      });
    });

    it('returns done iterator for empty list', async () => {
      const result = await run('[] -> .first()');
      expect(result).toHaveProperty('done', true);
    });

    it('returns done iterator for empty string', async () => {
      const result = await run('"" -> .first()');
      expect(result).toHaveProperty('done', true);
    });

    it('returns done iterator for empty dict', async () => {
      const result = await run('[:] -> .first()');
      expect(result).toHaveProperty('done', true);
    });

    it('iterator can be used with each', async () => {
      expect(await run('[1, 2, 3] -> .first() -> each { $ * 2 }')).toEqual([
        2, 4, 6,
      ]);
    });

    it('returns itself when called on iterator', async () => {
      expect(await run('range(0, 3) -> .first() -> each { $ }')).toEqual([
        0, 1, 2,
      ]);
    });

    it('single element list', async () => {
      const result = await run('[42] -> .first()');
      expect(result).toHaveProperty('value', 42);
      expect(result).toHaveProperty('done', false);
    });

    it('single char string', async () => {
      const result = await run('"x" -> .first()');
      expect(result).toHaveProperty('value', 'x');
      expect(result).toHaveProperty('done', false);
    });

    it('errors on number', async () => {
      await expect(run('42 -> .first()')).rejects.toThrow(
        'first requires list, string, dict, or iterator'
      );
    });

    it('errors on bool', async () => {
      await expect(run('true -> .first()')).rejects.toThrow(
        'first requires list, string, dict, or iterator'
      );
    });

    it('chaining .first() on iterator is identity', async () => {
      expect(
        await run('[1, 2, 3] -> .first() -> .first() -> each { $ }')
      ).toEqual([1, 2, 3]);
    });
  });

  describe('.head and .tail edge cases', () => {
    it('single element list head', async () => {
      expect(await run('[42] -> .head')).toBe(42);
    });

    it('single element list tail', async () => {
      expect(await run('[42] -> .tail')).toBe(42);
    });

    it('single char string head', async () => {
      expect(await run('"x" -> .head')).toBe('x');
    });

    it('single char string tail', async () => {
      expect(await run('"x" -> .tail')).toBe('x');
    });

    it('errors on dict for head', async () => {
      await expect(run('[a: 1] -> .head')).rejects.toThrow(
        'head requires list or string'
      );
    });

    it('errors on dict for tail', async () => {
      await expect(run('[a: 1] -> .tail')).rejects.toThrow(
        'tail requires list or string'
      );
    });

    it('errors on number for head', async () => {
      await expect(run('42 -> .head')).rejects.toThrow(
        'head requires list or string'
      );
    });

    it('errors on number for tail', async () => {
      await expect(run('42 -> .tail')).rejects.toThrow(
        'tail requires list or string'
      );
    });
  });

  describe('custom iterators', () => {
    it('recognizes iterator protocol in each', async () => {
      const script = `
        |start| [
          value: $start,
          done: ($start > 2),
          next: || { $countdown($.value + 1) }
        ] :> $countdown
        $countdown(0) -> each { $ }
      `;
      expect(await run(script)).toEqual([0, 1, 2]);
    });

    it('recognizes iterator protocol in map', async () => {
      const script = `
        |start| [
          value: $start,
          done: ($start > 2),
          next: || { $counter($.value + 1) }
        ] :> $counter
        $counter(0) -> map { $ * 10 }
      `;
      expect(await run(script)).toEqual([0, 10, 20]);
    });

    it('recognizes iterator protocol in fold', async () => {
      const script = `
        |start| [
          value: $start,
          done: ($start > 3),
          next: || { $counter($.value + 1) }
        ] :> $counter
        $counter(1) -> fold(0) { $@ + $ }
      `;
      expect(await run(script)).toBe(6); // 1 + 2 + 3 = 6
    });
  });

  describe('iterator manual traversal', () => {
    it('can manually traverse iterator', async () => {
      const script = `
        [1, 2, 3] -> .first() :> $it
        $it.value :> $v1
        $it.next() :> $it
        $it.value :> $v2
        $it.next() :> $it
        $it.value :> $v3
        [$v1, $v2, $v3]
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('can check done state', async () => {
      const script = `
        [1] -> .first() :> $it
        $it.done :> $d1
        $it.next() :> $it
        $it.done :> $d2
        [$d1, $d2]
      `;
      expect(await run(script)).toEqual([false, true]);
    });

    it('traversing past done returns done iterator', async () => {
      const script = `
        [1] -> .first() :> $it
        $it.next() :> $it
        $it.done :> $d1
        $it.next() :> $it
        $it.done :> $d2
        [$d1, $d2]
      `;
      expect(await run(script)).toEqual([true, true]);
    });
  });

  describe('custom iterators with filter', () => {
    it('filter works on custom iterator', async () => {
      const script = `
        |start| [
          value: $start,
          done: ($start > 5),
          next: || { $counter($.value + 1) }
        ] :> $counter
        $counter(0) -> filter { ($ % 2) == 0 }
      `;
      expect(await run(script)).toEqual([0, 2, 4]);
    });
  });

  describe('iterator edge cases', () => {
    it('dict without done is not iterator', async () => {
      expect(await run('[value: 1, next: ||{ 0 }] -> each { $ }')).toEqual([
        { key: 'next', value: expect.any(Object) },
        { key: 'value', value: 1 },
      ]);
    });

    it('dict without next is not iterator', async () => {
      expect(await run('[value: 1, done: false] -> each { $ }')).toEqual([
        { key: 'done', value: false },
        { key: 'value', value: 1 },
      ]);
    });

    it('dict with non-bool done is not iterator', async () => {
      expect(
        await run('[value: 1, done: "false", next: ||{ 0 }] -> each { $ }')
      ).toEqual([
        { key: 'done', value: 'false' },
        { key: 'next', value: expect.any(Object) },
        { key: 'value', value: 1 },
      ]);
    });

    it('empty done iterator works with each', async () => {
      const script = `
        |n| [done: true, next: ||{ $emptyIter(0) }] :> $emptyIter
        $emptyIter(0) -> each { $ }
      `;
      expect(await run(script)).toEqual([]);
    });

    it('empty done iterator works with fold', async () => {
      const script = `
        |n| [done: true, next: ||{ $emptyIter(0) }] :> $emptyIter
        $emptyIter(0) -> fold(42) { $@ + $ }
      `;
      expect(await run(script)).toBe(42);
    });
  });
});
