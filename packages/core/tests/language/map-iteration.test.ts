/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: map iteration, order views, and spread
 *
 * A map yields one `dict[key: K, value: V]` per entry in insertion order, and
 * `.keys`, `.values`, and `.entries` follow that order. A map never spreads.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('map iteration', () => {
  const { it: iterationIt } = rule('map.iteration');
  const { it: orderIt } = rule('map.order-views');
  const { it: keysIt } = rule('map.keys');
  const { it: valuesIt } = rule('map.values');
  const { it: entriesIt } = rule('map.entries');
  const { it: lenIt } = rule('map.len');
  const { it: emptyIt } = rule('map.empty');
  const { it: spreadIt } = rule('map.no-spread');
  const { it: filterIt } = rule('filter.map');
  const { it: sourceIt } = rule('iteration.source-kinds');

  iterationIt(
    'yields a key and value dict per entry in insertion order',
    async () => {
      expect(await run('map[#b: 1, #a: 2] -> seq({ $.value })')).toEqual([
        1, 2,
      ]);
      expect(
        await run('(map[#b: 1, #a: 2] -> seq({ $.key })) == list[#b, #a]')
      ).toBe(true);
    }
  );

  iterationIt('yields no element for an empty map', async () => {
    expect(await run('map[] -> seq({ $ })')).toEqual([]);
  });

  iterationIt('halts when an entry holds a code block', async () => {
    await expectHalt(() => run('map[1: { $ + 1 }] -> seq({ $ })'), {
      code: 'TYPE_MISMATCH',
    });
  });

  sourceIt('accepts a map as a collection source', async () => {
    expect(await run('map["x": 1] -> seq({ $.value })')).toEqual([1]);
  });

  orderIt('lists keys in insertion order, not sorted order', async () => {
    expect(await run('map[#b: 1, #a: 2].keys == list[#b, #a]')).toBe(true);
  });

  orderIt('lists values in insertion order', async () => {
    expect(await run('map["b": 1, "a": 2].values')).toEqual([1, 2]);
  });

  keysIt('returns the keys as a list', async () => {
    expect(await run('map[3: "x", 1: "y"].keys')).toEqual([3, 1]);
  });

  valuesIt('halts when an entry holds a code block', async () => {
    await expectHalt(() => run('map[1: { $ + 1 }].values'), {
      code: 'TYPE_MISMATCH',
    });
  });

  entriesIt('returns key and value tuples in insertion order', async () => {
    expect(
      await run(
        'map["b": 1, "a": 2].entries == list[tuple["b", 1], tuple["a", 2]]'
      )
    ).toBe(true);
  });

  lenIt('counts the entries', async () => {
    expect(await run('map[#a: 1].len')).toBe(1);
    expect(await run('map[1: "x", 2: "y"].len')).toBe(2);
  });

  emptyIt('is true for map[] and false otherwise', async () => {
    expect(await run('map[].empty')).toBe(true);
    expect(await run('map[1: 1].empty')).toBe(false);
  });

  emptyIt('counts zero entries for map[]', async () => {
    expect(await run('map[].len')).toBe(0);
  });

  spreadIt('halts RILL-R002 when spread into a dict literal', async () => {
    await expectHalt(() => run('dict[...map["a": 1]]'), {
      code: 'RILL_R002',
      hostErrorId: 'RILL-R002',
    });
  });

  spreadIt('halts RILL-R002 when spread into a list literal', async () => {
    await expectHalt(() => run('list[...map["a": 1]]'), {
      code: 'RILL_R002',
      hostErrorId: 'RILL-R002',
    });
  });

  spreadIt('halts RILL-R001 when spread into an argument list', async () => {
    await expectHalt(
      () => run('fn(a: string) { $a } => $f\n$f(...map["a": 1])'),
      { code: 'RILL_R001', hostErrorId: 'RILL-R001' }
    );
  });

  filterIt('keeps the entry dicts the predicate accepts', async () => {
    expect(
      await run(
        'map["a": 1, "b": 2, "c": 3] -> filter({ $.value > 1 }) -> seq({ $.key })'
      )
    ).toEqual(['b', 'c']);
  });
});
