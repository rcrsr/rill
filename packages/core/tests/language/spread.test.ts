/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Spread and Collection Operators
 * Tests for sequential spread (@), map, and filter operators
 */

import { describe, expect, it } from 'vitest';

import { parse, ParseError } from '@rcrsr/rill';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run, runFull } from '../helpers/runtime.js';

describe('Rill Runtime: Collection Operators', () => {
  describe('map - Parallel Iteration', () => {
    it('applies closure to each element in parallel', async () => {
      const result = await run(`
        fn(x) { ($x * 2) } => $double
        list[1, 2, 3] -> fan($double)
      `);
      expect(result).toEqual([2, 4, 6]);
    });

    it('applies closure with string transformation', async () => {
      const result = await run(`
        fn(s) { "item: {$s}" } => $format
        list["a", "b", "c"] -> fan($format)
      `);
      expect(result).toEqual(['item: a', 'item: b', 'item: c']);
    });

    it('applies inline closure', async () => {
      const result = await run('list[1, 2, 3] -> fan(fn(x) { $x * 2 })');
      expect(result).toEqual([2, 4, 6]);
    });

    it('applies block body', async () => {
      const result = await run('list[1, 2, 3] -> fan({ $ * 2 })');
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe('filter - Parallel Filtering', () => {
    describe('Block form: filter { condition }', () => {
      it('filters elements greater than threshold', async () => {
        const result = await run('list[1, 2, 3, 4, 5] -> filter({ .gt(2) })');
        expect(result).toEqual([3, 4, 5]);
      });

      it('filters non-empty strings', async () => {
        const result = await run(
          'list["hello", "", "world", ""] -> filter({ !.empty })'
        );
        expect(result).toEqual(['hello', 'world']);
      });

      it('filters with equality check', async () => {
        const result = await run('list[1, 2, 2, 3, 2] -> filter({ .eq(2) })');
        expect(result).toEqual([2, 2, 2]);
      });

      it('filters strings containing substring', async () => {
        const result = await run(
          'list["error: bad", "info: ok", "error: fail", "debug: x"] -> filter({ .contains("error") })'
        );
        expect(result).toEqual(['error: bad', 'error: fail']);
      });

      it('returns empty array when nothing matches', async () => {
        const result = await run('list[1, 2, 3] -> filter({ .gt(10) })');
        expect(result).toEqual([]);
      });

      it('returns all elements when everything matches', async () => {
        const result = await run('list[1, 2, 3] -> filter({ .gt(0) })');
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('Closure form: filter $predicate', () => {
      it('uses closure as predicate', async () => {
        const result = await run(`
          fn(x) { $x -> .gt(2) } => $gtTwo
          list[1, 2, 3, 4, 5] -> filter($gtTwo)
        `);
        expect(result).toEqual([3, 4, 5]);
      });

      it('uses complex predicate closure', async () => {
        const result = await run(`
          fn(x) { ($x % 2) -> .eq(0) } => $even
          list[1, 2, 3, 4, 5, 6] -> filter($even)
        `);
        expect(result).toEqual([2, 4, 6]);
      });

      it('uses predicate with string operations', async () => {
        const result = await run(`
          fn(s) { $s -> .len -> .gt(3) } => $longEnough
          list["a", "ab", "abc", "abcd", "abcde"] -> filter($longEnough)
        `);
        expect(result).toEqual(['abcd', 'abcde']);
      });
    });

    describe('Inline fn form: filter(fn(x) { $x > 2 })', () => {
      it('uses inline closure as predicate', async () => {
        const result = await run(
          'list[1, 2, 3, 4, 5] -> filter(fn(x) { $x > 2 })'
        );
        expect(result).toEqual([3, 4, 5]);
      });
    });

    describe('Grouped expression form: filter (expr)', () => {
      it('uses grouped expression as predicate', async () => {
        const result = await run('list[1, 2, 3, 4, 5] -> filter({ $ > 2 })');
        expect(result).toEqual([3, 4, 5]);
      });
    });

    describe('Chaining with map', () => {
      it('filter then map', async () => {
        const result = await run(`
          fn(x) { ($x * 2) } => $double
          list[1, 2, 3, 4, 5] -> filter({ .gt(2) }) -> fan($double)
        `);
        expect(result).toEqual([6, 8, 10]);
      });

      it('map then filter', async () => {
        const result = await run(`
          fn(x) { ($x * 2) } => $double
          list[1, 2, 3, 4, 5] -> fan($double) -> filter({ .gt(5) })
        `);
        expect(result).toEqual([6, 8, 10]);
      });
    });

    describe('Error cases', () => {
      it('throws on undefined predicate variable', async () => {
        await expect(
          run('list[1, 2, 3] -> filter($undefined)')
        ).rejects.toThrow(/Undefined variable/);
      });
    });
  });

  describe('Sequential Spread @', () => {
    describe('Chain closures', () => {
      it('chains closures sequentially', async () => {
        const result = await run(`
          fn(x) { ($x + 1) } => $inc
          fn(x) { ($x * 2) } => $double
          fn(x) { ($x + 10) } => $add10
          5 -> chain(list[$inc, $double, $add10])
        `);
        // (5 + 1) = 6, (6 * 2) = 12, (12 + 10) = 22
        expect(result).toBe(22);
      });

      it('chains single closure', async () => {
        const result = await run(`
          fn(x) { ($x * 2) } => $double
          5 -> chain($double)
        `);
        expect(result).toBe(10);
      });

      it('passes result from each step to next', async () => {
        const result = await run(`
          fn(s) { "{$s}-a" } => $addA
          fn(s) { "{$s}-b" } => $addB
          fn(s) { "{$s}-c" } => $addC
          "start" -> chain(list[$addA, $addB, $addC])
        `);
        expect(result).toBe('start-a-b-c');
      });
    });

    describe('With list of inline blocks', () => {
      it('uses $ as accumulated value in blocks', async () => {
        // Note: This tests inline blocks in sequential spread
        // In the current implementation, blocks receive pipe value as $
        const result = await run(`
          fn(x) { ($x + 1) } => $inc
          fn(x) { ($x * 2) } => $double
          3 -> chain(list[$inc, $double])
        `);
        // (3 + 1) = 4, (4 * 2) = 8
        expect(result).toBe(8);
      });
    });
  });

  describe('Combining map and Sequential Spread', () => {
    it('map then sequential', async () => {
      const result = await run(`
        fn(x) { ($x * 2) } => $double

        # Parallel: double both values
        list[5, 10] -> fan($double) => $doubled

        # For-each over results
        $doubled -> seq({ $ })
      `);
      // [5*2, 10*2] = [10, 20]
      expect(result).toEqual([10, 20]);
    });
  });
});

describe('Rill Runtime: Dict Methods', () => {
  describe('.keys', () => {
    it('returns all keys as list', async () => {
      const result = await run('dict[a: 1, b: 2, c: 3] -> .keys');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('dict[] -> .keys')).toEqual([]);
    });

    it('halts RILL-R003 for non-dict', async () => {
      await expect(run('"hello" -> .keys')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
    });
  });

  describe('.values', () => {
    it('returns all values as list', async () => {
      const result = await run('dict[a: 1, b: 2, c: 3] -> .values');
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('dict[] -> .values')).toEqual([]);
    });

    it('halts RILL-R003 for non-dict', async () => {
      await expect(run('"hello" -> .values')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
    });
  });

  describe('.entries', () => {
    it('returns list of key and value tuples', async () => {
      const result = await run(
        'dict[a: 1, b: 2] -> .entries => $e\n$e == list[tuple["a", 1], tuple["b", 2]]'
      );
      expect(result).toBe(true);
    });

    it('returns empty list for empty dict', async () => {
      expect(await run('dict[] -> .entries')).toEqual([]);
    });
  });

  describe('json() global function', () => {
    rule('json.text', 'json.dict').it(
      'converts dict to JSON string',
      async () => {
        const result = await run('dict[a: 1, b: 2] -> json');
        expect(JSON.parse(result as string)).toEqual({ a: 1, b: 2 });
      }
    );

    rule('json.text', 'json.list').it(
      'converts list to JSON string',
      async () => {
        const result = await run('list[1, 2, 3] -> json');
        expect(result).toBe('[1,2,3]');
      }
    );

    rule('json.string').it('converts string to JSON string', async () => {
      const result = await run('"hello" -> json');
      expect(result).toBe('"hello"');
    });

    rule('json.number').it('converts number to JSON string', async () => {
      const result = await run('42 -> json');
      expect(result).toBe('42');
    });

    rule('json.bool').it('converts bool to JSON string', async () => {
      expect(await run('true -> json')).toBe('true');
      expect(await run('false -> json')).toBe('false');
    });
  });
});

describe('Rill Runtime: Type Guards', () => {
  describe('isDict', () => {
    it('works with .keys on dict', async () => {
      const result = await runFull('dict[name: "test", count: 42] -> .keys');
      expect(result.result).toEqual(['count', 'name']);
    });

    it('works with .values on nested dict', async () => {
      const result = await run('dict[outer: dict[inner: "value"]] -> .values');
      expect(result).toEqual([{ inner: 'value' }]);
    });
  });
});

describe('Rill Runtime: Dict Closures (no self-binding)', () => {
  describe('Function literals in dicts', () => {
    it('rejects a zero-arg fn that reads $ with RILL-P029', () => {
      try {
        parse(`
        dict[
          name: "tools",
          greet: fn() { "I am {$.name}" }
        ] => $obj
      `);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P029');
      }
    });

    it('parameterized closure in dict is invoked with explicit args', async () => {
      const result = await run(`
        dict[
          name: "tools",
          process: fn(x) { "{$x} from tools" }
        ] => $obj
        $obj.process => $fn
        $fn("hello")
      `);
      expect(result).toBe('hello from tools');
    });

    it('rejects a parameterized closure that reads the dict as $', async () => {
      await expect(
        run(`
        dict[
          name: "tools",
          process: fn(x) { "{$.name}: {$x}" }
        ] => $obj
        $obj.process => $fn
        $fn("hello")
      `)
      ).rejects.toHaveProperty('errorId', 'RILL-P029');
    });
  });

  describe('Blocks vs closures', () => {
    it('grouped expression ( ) evaluates immediately in dict', async () => {
      // Note: After closure-semantics change, { expr } creates closure, ( expr ) is eager
      const result = await run(`
        "computed" => $val
        dict[
          name: "test",
          immediate: ( $val )
        ] => $obj
        $obj.immediate
      `);
      expect(result).toBe('computed');
    });
  });
});

describe('Rill Runtime: Reserved Method Protection', () => {
  it('allows "json" as dict key (no longer reserved)', async () => {
    const result = await run('dict[json: "data"]');
    expect(result).toEqual({ json: 'data' });
  });

  it('allows non-reserved keys', async () => {
    const result = await run('dict[name: "test", key: "value", str: "custom"]');
    expect(result).toEqual({ name: 'test', key: 'value', str: 'custom' });
  });
});

describe('Spread reference rules', () => {
  const sub = 'fn(a, b) { $a - $b } => $sub\n';

  rule('spread.operand').it(
    'rejects a bare ... in a collection literal with RILL-P004',
    async () => {
      await expect(run('list[1, ...]')).rejects.toMatchObject({
        errorId: 'RILL-P004',
      });
    }
  );

  rule('spread.one-argument').it(
    'rejects a second spread in one argument list with RILL-P007',
    async () => {
      await expect(
        run(sub + '$sub(...tuple[1], ...tuple[2])')
      ).rejects.toMatchObject({ errorId: 'RILL-P007' });
    }
  );

  rule('spread.list-source').it(
    'inserts list and tuple elements in order and rejects other kinds',
    async () => {
      expect(
        await run('list[2, 3] => $m\ntuple[4, 5] => $t\nlist[1, ...$m, ...$t]')
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        await run('tuple[1, ...list[2, 3]] -> { $ == tuple[1, 2, 3] }')
      ).toBe(true);
      await expectHalt(() => run('list[...range(0, 2)]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got iterator',
      });
      await expectHalt(() => run('list[...dict[a: 1]]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got dict',
      });
    }
  );

  rule('spread.dict').it(
    'inserts dict and ordered fields in order and rejects other kinds',
    async () => {
      expect(
        await run(
          'dict[a: 1, b: 2] => $d\nordered[...$d, c: 3] -> { $ == ordered[a: 1, b: 2, c: 3] }'
        )
      ).toBe(true);
      expect(await run('ordered[b: 1, a: 2] => $o\ndict[...$o]')).toEqual({
        a: 2,
        b: 1,
      });
      await expectHalt(() => run('dict[...list[1]]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
      });
    }
  );

  rule('spread.dict-later').it(
    'lets the entry written later win on a shared key',
    async () => {
      expect(await run('dict[a: 1] => $d\ndict[a: 0, ...$d]')).toEqual({
        a: 1,
      });
      expect(await run('dict[a: 1] => $d\ndict[...$d, a: 0]')).toEqual({
        a: 0,
      });
    }
  );

  rule('spread.arg-dict').it(
    'passes dict fields by name, halting on an unknown name or a missing parameter',
    async () => {
      expect(await run(sub + '$sub(...dict[b: 1, a: 5])')).toBe(4);
      await expectHalt(() => run(sub + '$sub(...dict[a: 5, c: 1])'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
      await expect(run(sub + '$sub(...dict[a: 5])')).rejects.toMatchObject({
        errorId: 'RILL-R044',
      });
    }
  );

  rule('spread.arg-tuple').it(
    'passes tuple elements as positional arguments',
    async () => {
      expect(await run(sub + '$sub(...tuple[5, 1])')).toBe(4);
    }
  );

  rule('spread.arg-ordered').it(
    'passes ordered fields in order, halting when a name is out of position',
    async () => {
      expect(await run(sub + '$sub(...ordered[a: 5, b: 1])')).toBe(4);
      await expectHalt(() => run(sub + '$sub(...ordered[b: 1, a: 5])'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
    }
  );

  rule('spread.arg-other').it(
    'halts RILL-R001 spreading a list or a string into arguments',
    async () => {
      await expectHalt(() => run(sub + '$sub(...list[5, 1])'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
      await expectHalt(() => run(sub + '$sub(..."x")'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
    }
  );

  rule('spread.piped').it(
    'spreads the piped value for a bare ...',
    async () => {
      expect(await run(sub + 'tuple[5, 1] -> $sub(...)')).toBe(4);
      expect(await run(sub + 'dict[b: 1, a: 5] -> $sub(...)')).toBe(4);
      await expectHalt(() => run(sub + 'list[5, 1] -> $sub(...)'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
    }
  );
});
