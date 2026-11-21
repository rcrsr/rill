/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: sort over a map
 *
 * `sort` over a map yields a map ordered by entry key, or by the key `key_fn`
 * returns.
 */

import { describe, expect } from 'vitest';

import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('map sort', () => {
  const { it: sortIt } = rule('sort.map');

  sortIt('sorts a map by key and returns a map', async () => {
    expect(
      await run('map["b": 2, "a": 1] -> sort -> :?map(string, number)')
    ).toBe(true);
    expect(
      await run('(map["b": 2, "a": 1] -> sort) == map["a": 1, "b": 2]')
    ).toBe(true);
    expect(await run('map["b": 2, "a": 1] -> sort -> .keys -> .head')).toBe(
      'a'
    );
  });

  sortIt('sorts a map by the key function result', async () => {
    expect(
      await run('map["a": 3, "b": 1] -> sort({ $.value }) -> .keys -> .head')
    ).toBe('b');
  });

  sortIt('sorts a map with numeric keys', async () => {
    expect(await run('map[3: "c", 1: "a"] -> sort -> .keys -> .head')).toBe(1);
  });
});
