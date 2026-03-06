/**
 * Rill Runtime Tests: Extraction Operators
 * Tests for destruct<> (destructure), slice<> (slice), and enumerate() function
 */

import { describe, expect, it } from 'vitest';

import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Runtime: Extraction Operators', () => {
  describe('Destructure destruct<>', () => {
    describe('Tuple destructuring', () => {
      it('extracts elements into variables', async () => {
        const { context } = await runWithContext(`
          list[1, 2, 3] -> destruct<$a, $b, $c>
        `);
        expect(context.variables.get('a')).toBe(1);
        expect(context.variables.get('b')).toBe(2);
        expect(context.variables.get('c')).toBe(3);
      });

      it('returns original input unchanged', async () => {
        const result = await run(`
          list[1, 2, 3] -> destruct<$a, $b, $c>
        `);
        expect(result).toEqual([1, 2, 3]);
      });

      it('allows typed captures', async () => {
        // Mixed-type list [1, "hello", true] fails at construction (Phase 2 RILL-R002).
        // Verify typed captures using same-type lists per type separately.
        const { context: ca } = await runWithContext(
          `list[1, 2] -> destruct<$a:number, $b:number>`
        );
        expect(ca.variables.get('a')).toBe(1);
        expect(ca.variables.get('b')).toBe(2);
        const { context: cb } = await runWithContext(
          `list["x", "y"] -> destruct<$a:string, $b:string>`
        );
        expect(cb.variables.get('a')).toBe('x');
        expect(cb.variables.get('b')).toBe('y');
      });

      it('throws on type mismatch', async () => {
        await expect(
          run(`list[1, 2, 3] -> destruct<$a:string, $b, $c>`)
        ).rejects.toThrow(/type/i);
      });

      it('throws on length mismatch', async () => {
        await expect(run(`list[1, 2] -> destruct<$a, $b, $c>`)).rejects.toThrow(
          /3 elements.*2/
        );
      });
    });

    describe('Skip placeholder _', () => {
      it('skips elements with _', async () => {
        const { context } = await runWithContext(`
          list[1, 2, 3] -> destruct<$a, _, $c>
        `);
        expect(context.variables.get('a')).toBe(1);
        expect(context.variables.get('c')).toBe(3);
        expect(context.variables.has('_')).toBe(false);
      });

      it('skips multiple elements', async () => {
        const { context } = await runWithContext(`
          list[1, 2, 3, 4] -> destruct<_, $b, _, $d>
        `);
        expect(context.variables.get('b')).toBe(2);
        expect(context.variables.get('d')).toBe(4);
      });
    });

    describe('Dict destructuring', () => {
      it('extracts by key', async () => {
        const { context } = await runWithContext(`
          dict[name: "Alice", age: 30] -> destruct<name: $n, age: $a>
        `);
        expect(context.variables.get('n')).toBe('Alice');
        expect(context.variables.get('a')).toBe(30);
      });

      it('throws on missing key', async () => {
        await expect(
          run(`dict[name: "Alice"] -> destruct<name: $n, missing: $m>`)
        ).rejects.toThrow(/missing/i);
      });

      it('allows typed captures for dict', async () => {
        const { context } = await runWithContext(`
          dict[count: 42] -> destruct<count: $c:number>
        `);
        expect(context.variables.get('c')).toBe(42);
      });
    });

    describe('Type errors', () => {
      it('throws when destructuring non-list as positional', async () => {
        await expect(run(`"hello" -> destruct<$a, $b>`)).rejects.toThrow(
          /list/i
        );
      });

      it('throws when destructuring non-dict as key pattern', async () => {
        await expect(run(`list[1, 2] -> destruct<key: $v>`)).rejects.toThrow(
          /dict/i
        );
      });
    });
  });

  describe('Slice slice<>', () => {
    describe('List slicing', () => {
      it('slices with start:stop', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<1:4>`);
        expect(result).toEqual([2, 3, 4]);
      });

      it('slices from beginning with :stop', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<:3>`);
        expect(result).toEqual([1, 2, 3]);
      });

      it('slices to end with start:', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<2:>`);
        expect(result).toEqual([3, 4, 5]);
      });

      it('supports step', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<::2>`);
        expect(result).toEqual([1, 3, 5]);
      });

      it('reverses with negative step', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<::-1>`);
        expect(result).toEqual([5, 4, 3, 2, 1]);
      });

      it('supports negative indices', async () => {
        const result = await run(`list[1, 2, 3, 4, 5] -> slice<-3:-1>`);
        expect(result).toEqual([3, 4]);
      });
    });

    describe('String slicing', () => {
      it('slices strings', async () => {
        const result = await run(`"hello" -> slice<1:4>`);
        expect(result).toBe('ell');
      });

      it('reverses strings', async () => {
        const result = await run(`"hello" -> slice<::-1>`);
        expect(result).toBe('olleh');
      });
    });

    describe('Variable bounds', () => {
      it('uses variable as bound', async () => {
        const result = await run(`
          2 => $start
          4 => $end
          list[1, 2, 3, 4, 5] -> slice<$start:$end>
        `);
        expect(result).toEqual([3, 4]);
      });
    });

    describe('Grouped expression bounds', () => {
      it('uses grouped expression as start bound', async () => {
        const result = await run(`
          1 => $offset
          list[1, 2, 3, 4, 5] -> slice<($offset + 1):4>
        `);
        expect(result).toEqual([3, 4]);
      });

      it('uses grouped expression as stop bound', async () => {
        const result = await run(`
          2 => $len
          list[1, 2, 3, 4, 5] -> slice<1:($len + 2)>
        `);
        expect(result).toEqual([2, 3, 4]);
      });
    });

    describe('Edge cases', () => {
      it('returns empty for out-of-range', async () => {
        const result = await run(`list[1, 2, 3] -> slice<10:20>`);
        expect(result).toEqual([]);
      });

      it('throws on zero step', async () => {
        await expect(run(`list[1, 2, 3] -> slice<::0>`)).rejects.toThrow(
          /zero/i
        );
      });

      it('throws on non-sliceable type', async () => {
        await expect(run(`42 -> slice<0:2>`)).rejects.toThrow(/list.*string/i);
      });
    });
  });

  describe('enumerate() function', () => {
    describe('List enumeration', () => {
      it('adds index to each element', async () => {
        const result = await run(`enumerate(list[10, 20, 30])`);
        expect(result).toEqual([
          { index: 0, value: 10 },
          { index: 1, value: 20 },
          { index: 2, value: 30 },
        ]);
      });

      it('handles empty list', async () => {
        const result = await run(`enumerate(list[])`);
        expect(result).toEqual([]);
      });

      it('preserves complex values', async () => {
        const result = await run(`enumerate(list[list[1, 2], list[3, 4]])`);
        expect(result).toEqual([
          { index: 0, value: [1, 2] },
          { index: 1, value: [3, 4] },
        ]);
      });
    });

    describe('Dict enumeration', () => {
      it('adds index and key to each entry', async () => {
        const result = await run(`enumerate(dict[b: 2, a: 1])`);
        // Keys sorted alphabetically
        expect(result).toEqual([
          { index: 0, key: 'a', value: 1 },
          { index: 1, key: 'b', value: 2 },
        ]);
      });

      it('handles empty dict', async () => {
        const result = await run(`enumerate(dict[])`);
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
        const result = await run(
          `list[1, 2, 3] -> .eq(list[1, 2, 3]) ? true ! false`
        );
        expect(result).toBe(true);
      });

      it('detects unequal lists', async () => {
        const result = await run(
          `list[1, 2, 3] -> .eq(list[1, 2, 4]) ? true ! false`
        );
        expect(result).toBe(false);
      });

      it('compares nested lists', async () => {
        const result = await run(
          `list[list[1, 2], list[3, 4]] -> .eq(list[list[1, 2], list[3, 4]]) ? true ! false`
        );
        expect(result).toBe(true);
      });
    });

    describe('Dict equality', () => {
      it('compares dicts by content (order-independent)', async () => {
        const result = await run(
          `dict[a: 1, b: 2] -> .eq(dict[b: 2, a: 1]) ? true ! false`
        );
        expect(result).toBe(true);
      });

      it('detects unequal dicts', async () => {
        const result = await run(
          `dict[a: 1] -> .eq(dict[a: 2]) ? true ! false`
        );
        expect(result).toBe(false);
      });
    });

    describe('Comparison operators', () => {
      it('== uses deep equality', async () => {
        const result = await run(`(list[1, 2] == list[1, 2]) ? true ! false`);
        expect(result).toBe(true);
      });

      it('!= uses deep inequality', async () => {
        const result = await run(`(list[1, 2] != list[1, 3]) ? true ! false`);
        expect(result).toBe(true);
      });
    });
  });
});
