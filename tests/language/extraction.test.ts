/**
 * Rill Runtime Tests: Extraction Operators
 * Tests for *< (destructure), /< (slice), and enumerate() function
 */

import { describe, expect, it } from 'vitest';

import { run, runFull } from '../helpers/runtime.js';

describe('Rill Runtime: Extraction Operators', () => {
  describe('Destructure *<>', () => {
    describe('Tuple destructuring', () => {
      it('extracts elements into variables', async () => {
        const { variables } = await runFull(`
          [1, 2, 3] -> *<$a, $b, $c>
        `);
        expect(variables.a).toBe(1);
        expect(variables.b).toBe(2);
        expect(variables.c).toBe(3);
      });

      it('returns original input unchanged', async () => {
        const result = await run(`
          [1, 2, 3] -> *<$a, $b, $c>
        `);
        expect(result).toEqual([1, 2, 3]);
      });

      it('allows typed captures', async () => {
        const { variables } = await runFull(`
          [1, "hello", true] -> *<$a:number, $b:string, $c:bool>
        `);
        expect(variables.a).toBe(1);
        expect(variables.b).toBe('hello');
        expect(variables.c).toBe(true);
      });

      it('throws on type mismatch', async () => {
        await expect(run(`[1, 2, 3] -> *<$a:string, $b, $c>`)).rejects.toThrow(
          /type/i
        );
      });

      it('throws on length mismatch', async () => {
        await expect(run(`[1, 2] -> *<$a, $b, $c>`)).rejects.toThrow(
          /3 elements.*2/
        );
      });
    });

    describe('Skip placeholder _', () => {
      it('skips elements with _', async () => {
        const { variables } = await runFull(`
          [1, 2, 3] -> *<$a, _, $c>
        `);
        expect(variables.a).toBe(1);
        expect(variables.c).toBe(3);
        expect('_' in variables).toBe(false);
      });

      it('skips multiple elements', async () => {
        const { variables } = await runFull(`
          [1, 2, 3, 4] -> *<_, $b, _, $d>
        `);
        expect(variables.b).toBe(2);
        expect(variables.d).toBe(4);
      });
    });

    describe('Nested destructuring', () => {
      it('destructures nested lists', async () => {
        const { variables } = await runFull(`
          [[1, 2], 3] -> *<*<$a, $b>, $c>
        `);
        expect(variables.a).toBe(1);
        expect(variables.b).toBe(2);
        expect(variables.c).toBe(3);
      });

      it('handles deeply nested structures', async () => {
        const { variables } = await runFull(`
          [[[1]], 2] -> *<*<*<$inner>>, $outer>
        `);
        expect(variables.inner).toBe(1);
        expect(variables.outer).toBe(2);
      });
    });

    describe('Dict destructuring', () => {
      it('extracts by key', async () => {
        const { variables } = await runFull(`
          [name: "Alice", age: 30] -> *<name: $n, age: $a>
        `);
        expect(variables.n).toBe('Alice');
        expect(variables.a).toBe(30);
      });

      it('throws on missing key', async () => {
        await expect(
          run(`[name: "Alice"] -> *<name: $n, missing: $m>`)
        ).rejects.toThrow(/missing/i);
      });

      it('allows typed captures for dict', async () => {
        const { variables } = await runFull(`
          [count: 42] -> *<count: $c:number>
        `);
        expect(variables.c).toBe(42);
      });
    });

    describe('Type errors', () => {
      it('throws when destructuring non-list as positional', async () => {
        await expect(run(`"hello" -> *<$a, $b>`)).rejects.toThrow(/list/i);
      });

      it('throws when destructuring non-dict as key pattern', async () => {
        await expect(run(`[1, 2] -> *<key: $v>`)).rejects.toThrow(/dict/i);
      });
    });
  });

  describe('Slice /<>', () => {
    describe('List slicing', () => {
      it('slices with start:stop', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<1:4>`);
        expect(result).toEqual([2, 3, 4]);
      });

      it('slices from beginning with :stop', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<:3>`);
        expect(result).toEqual([1, 2, 3]);
      });

      it('slices to end with start:', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<2:>`);
        expect(result).toEqual([3, 4, 5]);
      });

      it('supports step', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<::2>`);
        expect(result).toEqual([1, 3, 5]);
      });

      it('reverses with negative step', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<::-1>`);
        expect(result).toEqual([5, 4, 3, 2, 1]);
      });

      it('supports negative indices', async () => {
        const result = await run(`[1, 2, 3, 4, 5] -> /<-3:-1>`);
        expect(result).toEqual([3, 4]);
      });
    });

    describe('String slicing', () => {
      it('slices strings', async () => {
        const result = await run(`"hello" -> /<1:4>`);
        expect(result).toBe('ell');
      });

      it('reverses strings', async () => {
        const result = await run(`"hello" -> /<::-1>`);
        expect(result).toBe('olleh');
      });
    });

    describe('Variable bounds', () => {
      it('uses variable as bound', async () => {
        const result = await run(`
          2 :> $start
          4 :> $end
          [1, 2, 3, 4, 5] -> /<$start:$end>
        `);
        expect(result).toEqual([3, 4]);
      });
    });

    describe('Grouped expression bounds', () => {
      it('uses grouped expression as start bound', async () => {
        const result = await run(`
          1 :> $offset
          [1, 2, 3, 4, 5] -> /<($offset + 1):4>
        `);
        expect(result).toEqual([3, 4]);
      });

      it('uses grouped expression as stop bound', async () => {
        const result = await run(`
          2 :> $len
          [1, 2, 3, 4, 5] -> /<1:($len + 2)>
        `);
        expect(result).toEqual([2, 3, 4]);
      });
    });

    describe('Edge cases', () => {
      it('returns empty for out-of-range', async () => {
        const result = await run(`[1, 2, 3] -> /<10:20>`);
        expect(result).toEqual([]);
      });

      it('throws on zero step', async () => {
        await expect(run(`[1, 2, 3] -> /<::0>`)).rejects.toThrow(/zero/i);
      });

      it('throws on non-sliceable type', async () => {
        await expect(run(`42 -> /<0:2>`)).rejects.toThrow(/list.*string/i);
      });
    });
  });

  describe('enumerate() function', () => {
    describe('List enumeration', () => {
      it('adds index to each element', async () => {
        const result = await run(`enumerate([10, 20, 30])`);
        expect(result).toEqual([
          { index: 0, value: 10 },
          { index: 1, value: 20 },
          { index: 2, value: 30 },
        ]);
      });

      it('handles empty list', async () => {
        const result = await run(`enumerate([])`);
        expect(result).toEqual([]);
      });

      it('preserves complex values', async () => {
        const result = await run(`enumerate([[1, 2], [3, 4]])`);
        expect(result).toEqual([
          { index: 0, value: [1, 2] },
          { index: 1, value: [3, 4] },
        ]);
      });
    });

    describe('Dict enumeration', () => {
      it('adds index and key to each entry', async () => {
        const result = await run(`enumerate([b: 2, a: 1])`);
        // Keys sorted alphabetically
        expect(result).toEqual([
          { index: 0, key: 'a', value: 1 },
          { index: 1, key: 'b', value: 2 },
        ]);
      });

      it('handles empty dict', async () => {
        const result = await run(`enumerate([:])`);
        expect(result).toEqual([]);
      });
    });

    describe('Non-enumerable types', () => {
      it('returns empty array for non-enumerable type', async () => {
        const result = await run(`enumerate("hello")`);
        expect(result).toEqual([]);
      });
    });
  });

  describe('Content Equality', () => {
    describe('List equality', () => {
      it('compares lists by content', async () => {
        const result = await run(`[1, 2, 3] -> .eq([1, 2, 3]) ? true ! false`);
        expect(result).toBe(true);
      });

      it('detects unequal lists', async () => {
        const result = await run(`[1, 2, 3] -> .eq([1, 2, 4]) ? true ! false`);
        expect(result).toBe(false);
      });

      it('compares nested lists', async () => {
        const result = await run(
          `[[1, 2], [3, 4]] -> .eq([[1, 2], [3, 4]]) ? true ! false`
        );
        expect(result).toBe(true);
      });
    });

    describe('Dict equality', () => {
      it('compares dicts by content (order-independent)', async () => {
        const result = await run(
          `[a: 1, b: 2] -> .eq([b: 2, a: 1]) ? true ! false`
        );
        expect(result).toBe(true);
      });

      it('detects unequal dicts', async () => {
        const result = await run(`[a: 1] -> .eq([a: 2]) ? true ! false`);
        expect(result).toBe(false);
      });
    });

    describe('Comparison operators', () => {
      it('== uses deep equality', async () => {
        const result = await run(`([1, 2] == [1, 2]) ? true ! false`);
        expect(result).toBe(true);
      });

      it('!= uses deep inequality', async () => {
        const result = await run(`([1, 2] != [1, 3]) ? true ! false`);
        expect(result).toBe(true);
      });
    });
  });
});
