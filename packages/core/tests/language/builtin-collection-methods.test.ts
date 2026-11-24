/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: list, dict, and ordered methods
 * Covers collection method edges not covered elsewhere: empty receivers,
 * key order, element printing in .join, and receiver immutability.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: list methods', () => {
  rule('list.len.count').it(
    'counts a nested list as one element and an empty list as 0',
    async () => {
      expect(await run('list[list[1, 2], 3].len')).toBe(2);
      expect(await run('list[].len')).toBe(0);
    }
  );

  rule('list.join.separator').it(
    'inserts each element as interpolation inserts it',
    async () => {
      expect(
        await run('list[list["a"], "b", #c, 1.5, true, number].join("|")')
      ).toBe('list["a"]|b|#c|1.5|true|number');
      expect(await run('"{list["a"]}|b|{#c}|{1.5}|{true}|{number}"')).toBe(
        'list["a"]|b|#c|1.5|true|number'
      );
    }
  );

  rule('list.join.no-form').it(
    'halts RILL-R036 on an iterator element, catchable by guard',
    async () => {
      await expectHalt(() => run('list[list[1].first].join'), {
        code: 'RILL_R036',
      });
      expect(
        await run(
          'guard { list[list[1].first].join } => $r\n$r.!code -> string'
        )
      ).toBe('RILL_R036');
    }
  );

  rule('list.reverse.order').it(
    'yields a new reversed list and leaves the receiver unchanged',
    async () => {
      expect(await run('list[1, 2, 3].reverse')).toEqual([3, 2, 1]);
      expect(await run('list[].reverse')).toEqual([]);
      expect(
        await run('list[1, 2] => $a\n$a.reverse => $b\nlist[$a, $b]')
      ).toEqual([
        [1, 2],
        [2, 1],
      ]);
    }
  );
});

describe('Rill Language: dict methods', () => {
  rule('dict.len.count').it('counts keys, 0 for an empty dict', async () => {
    expect(await run('dict[b: 1, a: 2].len')).toBe(2);
    expect(await run('dict[].len')).toBe(0);
  });

  rule('dict.keys.order').it(
    'orders keys by UTF-16 code unit and yields list[] for an empty dict',
    async () => {
      expect(await run('dict[b: 1, B: 2, a: 3].keys')).toEqual(['B', 'a', 'b']);
      expect(await run('dict[].keys')).toEqual([]);
    }
  );

  rule('dict.values.order').it(
    'lists values in key order and yields list[] for an empty dict',
    async () => {
      expect(await run('dict[b: 1, B: 2, a: 3].values')).toEqual([2, 3, 1]);
      expect(await run('dict[].values')).toEqual([]);
    }
  );

  rule('dict.entries.order').it('yields list[] for an empty dict', async () => {
    expect(await run('dict[].entries')).toEqual([]);
  });

  rule('dict.first.iterator').it(
    'yields an iterator over entry dicts in key order',
    async () => {
      expect(await run('dict[b: 1, a: 2] -> .first -> .value')).toEqual({
        key: 'a',
        value: 2,
      });
      expect(
        await run('dict[b: 1, a: 2] -> .first => $it\n$it.next() -> .value')
      ).toEqual({ key: 'b', value: 1 });
      expect(await run('dict[] -> .first -> .done')).toBe(true);
    }
  );
});

describe('Rill Language: ordered methods', () => {
  rule('ordered.len.count').it(
    'counts keys, 0 for an empty ordered',
    async () => {
      expect(await run('ordered[b: 1, a: 2].len')).toBe(2);
      expect(await run('ordered[].len')).toBe(0);
    }
  );

  rule('ordered.keys.order').it(
    'lists keys in the ordered own order',
    async () => {
      expect(await run('ordered[b: 1, a: 2].keys')).toEqual(['b', 'a']);
      expect(await run('ordered[].keys')).toEqual([]);
    }
  );

  rule('ordered.values.order').it(
    'lists values in the ordered own order',
    async () => {
      expect(await run('ordered[b: 1, a: 2].values')).toEqual([1, 2]);
      expect(await run('ordered[].values')).toEqual([]);
    }
  );

  rule('ordered.entries.order').it(
    'yields list[] for an empty ordered',
    async () => {
      expect(await run('ordered[].entries')).toEqual([]);
    }
  );
});
