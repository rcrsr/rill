/**
 * Rill Runtime Tests: Spread and Collection Operators
 * Tests for sequential spread (@), map, and filter operators
 */

import { describe, expect, it } from 'vitest';

import { run, runFull } from './helpers/runtime.js';

describe('Rill Runtime: Collection Operators', () => {
  describe('map - Parallel Iteration', () => {
    it('applies closure to each element in parallel', async () => {
      const result = await run(`
        |x| { ($x * 2) } -> $double
        [1, 2, 3] -> map $double
      `);
      expect(result).toEqual([2, 4, 6]);
    });

    it('applies closure with string transformation', async () => {
      const result = await run(`
        |s| { "item: {$s}" } -> $format
        ["a", "b", "c"] -> map $format
      `);
      expect(result).toEqual(['item: a', 'item: b', 'item: c']);
    });

    it('applies inline closure', async () => {
      const result = await run('[1, 2, 3] -> map |x| ($x * 2)');
      expect(result).toEqual([2, 4, 6]);
    });

    it('applies block body', async () => {
      const result = await run('[1, 2, 3] -> map { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe('filter - Parallel Filtering', () => {
    describe('Block form: filter { condition }', () => {
      it('filters elements greater than threshold', async () => {
        const result = await run('[1, 2, 3, 4, 5] -> filter { .gt(2) }');
        expect(result).toEqual([3, 4, 5]);
      });

      it('filters non-empty strings', async () => {
        const result = await run(
          '["hello", "", "world", ""] -> filter { !.empty }'
        );
        expect(result).toEqual(['hello', 'world']);
      });

      it('filters with equality check', async () => {
        const result = await run('[1, 2, 2, 3, 2] -> filter { .eq(2) }');
        expect(result).toEqual([2, 2, 2]);
      });

      it('filters strings containing substring', async () => {
        const result = await run(
          '["error: bad", "info: ok", "error: fail", "debug: x"] -> filter { .contains("error") }'
        );
        expect(result).toEqual(['error: bad', 'error: fail']);
      });

      it('returns empty array when nothing matches', async () => {
        const result = await run('[1, 2, 3] -> filter { .gt(10) }');
        expect(result).toEqual([]);
      });

      it('returns all elements when everything matches', async () => {
        const result = await run('[1, 2, 3] -> filter { .gt(0) }');
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('Closure form: filter $predicate', () => {
      it('uses closure as predicate', async () => {
        const result = await run(`
          |x| { $x -> .gt(2) } -> $gtTwo
          [1, 2, 3, 4, 5] -> filter $gtTwo
        `);
        expect(result).toEqual([3, 4, 5]);
      });

      it('uses complex predicate closure', async () => {
        const result = await run(`
          |x| { ($x % 2) -> .eq(0) } -> $even
          [1, 2, 3, 4, 5, 6] -> filter $even
        `);
        expect(result).toEqual([2, 4, 6]);
      });

      it('uses predicate with string operations', async () => {
        const result = await run(`
          |s| { $s -> .len -> .gt(3) } -> $longEnough
          ["a", "ab", "abc", "abcd", "abcde"] -> filter $longEnough
        `);
        expect(result).toEqual(['abcd', 'abcde']);
      });
    });

    describe('Inline closure form: filter |x| body', () => {
      it('uses inline closure as predicate', async () => {
        const result = await run('[1, 2, 3, 4, 5] -> filter |x| ($x > 2)');
        expect(result).toEqual([3, 4, 5]);
      });
    });

    describe('Grouped expression form: filter (expr)', () => {
      it('uses grouped expression as predicate', async () => {
        const result = await run('[1, 2, 3, 4, 5] -> filter ($ > 2)');
        expect(result).toEqual([3, 4, 5]);
      });
    });

    describe('Chaining with map', () => {
      it('filter then map', async () => {
        const result = await run(`
          |x| { ($x * 2) } -> $double
          [1, 2, 3, 4, 5] -> filter { .gt(2) } -> map $double
        `);
        expect(result).toEqual([6, 8, 10]);
      });

      it('map then filter', async () => {
        const result = await run(`
          |x| { ($x * 2) } -> $double
          [1, 2, 3, 4, 5] -> map $double -> filter { .gt(5) }
        `);
        expect(result).toEqual([6, 8, 10]);
      });
    });

    describe('Error cases', () => {
      it('throws on undefined predicate variable', async () => {
        await expect(run('[1, 2, 3] -> filter $undefined')).rejects.toThrow(
          /Undefined variable/
        );
      });
    });
  });

  describe('Sequential Spread @', () => {
    describe('Chain closures', () => {
      it('chains closures sequentially', async () => {
        const result = await run(`
          |x| { ($x + 1) } -> $inc
          |x| { ($x * 2) } -> $double
          |x| { ($x + 10) } -> $add10
          5 -> @[$inc, $double, $add10]
        `);
        // (5 + 1) = 6, (6 * 2) = 12, (12 + 10) = 22
        expect(result).toBe(22);
      });

      it('chains single closure', async () => {
        const result = await run(`
          |x| { ($x * 2) } -> $double
          5 -> @$double
        `);
        expect(result).toBe(10);
      });

      it('passes result from each step to next', async () => {
        const result = await run(`
          |s| { "{$s}-a" } -> $addA
          |s| { "{$s}-b" } -> $addB
          |s| { "{$s}-c" } -> $addC
          "start" -> @[$addA, $addB, $addC]
        `);
        expect(result).toBe('start-a-b-c');
      });
    });

    describe('With list of inline blocks', () => {
      it('uses $ as accumulated value in blocks', async () => {
        // Note: This tests inline blocks in sequential spread
        // In the current implementation, blocks receive pipe value as $
        const result = await run(`
          |x| { ($x + 1) } -> $inc
          |x| { ($x * 2) } -> $double
          3 -> @[$inc, $double]
        `);
        // (3 + 1) = 4, (4 * 2) = 8
        expect(result).toBe(8);
      });
    });
  });

  describe('Combining map and Sequential Spread', () => {
    it('map then sequential', async () => {
      const result = await run(`
        |x| { ($x * 2) } -> $double

        # Parallel: double both values
        [5, 10] -> map $double -> $doubled

        # For-each over results
        $doubled -> each { $ }
      `);
      // [5*2, 10*2] = [10, 20]
      expect(result).toEqual([10, 20]);
    });
  });
});

describe('Rill Runtime: Dict Methods', () => {
  describe('.keys', () => {
    it('returns all keys as list', async () => {
      const result = await run('[a: 1, b: 2, c: 3] -> .keys');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('[:] -> .keys')).toEqual([]);
    });

    it('returns empty list for non-dict', async () => {
      expect(await run('"hello" -> .keys')).toEqual([]);
    });
  });

  describe('.values', () => {
    it('returns all values as list', async () => {
      const result = await run('[a: 1, b: 2, c: 3] -> .values');
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('[:] -> .values')).toEqual([]);
    });

    it('returns empty list for non-dict', async () => {
      expect(await run('"hello" -> .values')).toEqual([]);
    });
  });

  describe('.entries', () => {
    it('returns list of [key, value] pairs', async () => {
      const result = await run('[a: 1, b: 2] -> .entries');
      expect(result).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('[:] -> .entries')).toEqual([]);
    });
  });

  describe('json() global function', () => {
    it('converts dict to JSON string', async () => {
      const result = await run('[a: 1, b: 2] -> json');
      expect(JSON.parse(result as string)).toEqual({ a: 1, b: 2 });
    });

    it('converts list to JSON string', async () => {
      const result = await run('[1, 2, 3] -> json');
      expect(result).toBe('[1,2,3]');
    });

    it('converts string to JSON string', async () => {
      const result = await run('"hello" -> json');
      expect(result).toBe('"hello"');
    });

    it('converts number to JSON string', async () => {
      const result = await run('42 -> json');
      expect(result).toBe('42');
    });

    it('converts bool to JSON string', async () => {
      expect(await run('true -> json')).toBe('true');
      expect(await run('false -> json')).toBe('false');
    });
  });
});

describe('Rill Runtime: Type Guards', () => {
  describe('isDict', () => {
    it('works with .keys on dict', async () => {
      const result = await runFull('[name: "test", count: 42] -> .keys');
      expect(result.value).toEqual(['name', 'count']);
    });

    it('works with .values on nested dict', async () => {
      const result = await run('[outer: [inner: "value"]] -> .values');
      expect(result).toEqual([{ inner: 'value' }]);
    });
  });
});

describe('Rill Runtime: Dict Closures ($ = this)', () => {
  describe('Function literals in dicts', () => {
    it('binds $ to dict for zero-arg closure', async () => {
      const result = await run(`
        [
          name: "tools",
          greet: || { "I am {$.name}" }
        ] -> $obj
        $obj.greet
      `);
      expect(result).toBe('I am tools');
    });

    it('binds $ to dict for closure accessing multiple fields', async () => {
      const result = await run(`
        [
          name: "toolkit",
          count: 3,
          str: || { "{$.name}: {$.count} items" }
        ] -> $obj
        $obj.str
      `);
      expect(result).toBe('toolkit: 3 items');
    });

    it('parameterized closure in dict is invoked with explicit args', async () => {
      const result = await run(`
        [
          name: "tools",
          process: |x| { "{$x} from tools" }
        ] -> $obj
        $obj.process -> $fn
        $fn("hello")
      `);
      expect(result).toBe('hello from tools');
    });

    it('parameterized closure can also access $ as dict', async () => {
      const result = await run(`
        [
          name: "tools",
          process: |x| { "{$.name}: {$x}" }
        ] -> $obj
        $obj.process -> $fn
        $fn("hello")
      `);
      expect(result).toBe('tools: hello');
    });
  });

  describe('Reusable closures', () => {
    it('closure can be reused across dicts', async () => {
      const result = await run(`
        || { "{$.name}: {$.count} items" } -> $describer

        [
          name: "tools",
          count: 3,
          str: $describer
        ] -> $obj1

        [
          name: "actions",
          count: 5,
          str: $describer
        ] -> $obj2

        [$obj1.str, $obj2.str]
      `);
      expect(result).toEqual(['tools: 3 items', 'actions: 5 items']);
    });
  });

  describe('Nested dicts', () => {
    it('closure binds to immediate parent dict', async () => {
      const result = await run(`
        [
          outer: "outer-value",
          inner: [
            name: "inner",
            str: || { $.name }
          ]
        ] -> $obj
        $obj.inner.str
      `);
      expect(result).toBe('inner');
    });
  });

  describe('Blocks vs closures', () => {
    it('naked block { } executes immediately in dict', async () => {
      const result = await run(`
        "computed" -> $val
        [
          name: "test",
          immediate: { $val }
        ] -> $obj
        $obj.immediate
      `);
      expect(result).toBe('computed');
    });

    it('closure || { } is stored and invoked on access', async () => {
      const result = await run(`
        [
          name: "test",
          method: || { $.name }
        ] -> $obj
        $obj.method
      `);
      expect(result).toBe('test');
    });
  });
});

describe('Rill Runtime: Reserved Method Protection', () => {
  it('rejects "keys" as dict key', async () => {
    await expect(run('[keys: "value"]')).rejects.toThrow(
      /Cannot use reserved method name 'keys'/
    );
  });

  it('rejects "values" as dict key', async () => {
    await expect(run('[values: 42]')).rejects.toThrow(
      /Cannot use reserved method name 'values'/
    );
  });

  it('rejects "entries" as dict key', async () => {
    await expect(run('[entries: [1, 2]]')).rejects.toThrow(
      /Cannot use reserved method name 'entries'/
    );
  });

  it('allows "json" as dict key (no longer reserved)', async () => {
    const result = await run('[json: "data"]');
    expect(result).toEqual({ json: 'data' });
  });

  it('allows non-reserved keys', async () => {
    const result = await run('[name: "test", key: "value", str: "custom"]');
    expect(result).toEqual({ name: 'test', key: 'value', str: 'custom' });
  });
});
