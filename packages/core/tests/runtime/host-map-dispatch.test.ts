/**
 * A host function that returns a JS Map hands the script a rill map.
 * Covers the dispatch path end to end, not only normalizeHostResult.
 */
import { anyTypeValue } from '@rcrsr/rill';
import type { RillFunctionDefinition, RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { expectHaltMessage } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

/** Host functions written in plain JS can return a Map; the type omits it. */
const asHost = (value: unknown): RillValue => value as RillValue;

const FUNCTIONS: Record<string, RillFunctionDefinition> = {
  host_map: {
    params: [],
    returnType: anyTypeValue,
    fn: () =>
      asHost(
        new Map<unknown, unknown>([
          [1, 'one'],
          [2, 'two'],
        ])
      ),
  },
  nested_map: {
    params: [],
    returnType: anyTypeValue,
    fn: () => asHost({ lookup: new Map<unknown, unknown>([['a', 10]]) }),
  },
  mixed_map: {
    params: [],
    returnType: anyTypeValue,
    fn: () =>
      asHost(
        new Map<unknown, unknown>([
          [1, 'one'],
          ['b', 'two'],
        ])
      ),
  },
};

describe('host JS Map at dispatch', () => {
  it('selects by number key from a returned Map', async () => {
    expect(await run('host_map()[2]', { functions: FUNCTIONS })).toBe('two');
  });

  it('reports the map type of a returned Map', async () => {
    expect(
      await run('host_map().^type.signature', { functions: FUNCTIONS })
    ).toBe('map(number, string)');
  });

  it('converts a Map nested in a dict', async () => {
    expect(
      await run('nested_map().lookup["a"]', { functions: FUNCTIONS })
    ).toBe(10);
  });

  it('halts on a Map with mixed key kinds', async () => {
    await expectHaltMessage(
      () => run('mixed_map()', { functions: FUNCTIONS }),
      /key/i
    );
  });
});
