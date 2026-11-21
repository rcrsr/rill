/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: map membership and empty-map selection
 *
 * A map has `map(K, V)` when every key has `K` and every value has `V`; an
 * empty map has every `map(K, V)`. A declared empty map checks a selector
 * against its declared key type; an undeclared one treats any scalar as a miss.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('map membership', () => {
  const { it: memberIt } = rule('structural-typing.map');
  const { it: assertIt } = rule('assertion.deep');
  const { it: selectIt } = rule('selection.forms');
  const { it: probeIt } = rule('existence.map-type');

  memberIt('accepts a map whose keys and values match', async () => {
    expect(await run('map["a": 1] -> :map(string, number) -> .len')).toBe(1);
  });

  memberIt('gives an empty map every map type', async () => {
    expect(await run('map[] -> :?map(atom, bool)')).toBe(true);
  });

  assertIt.each([
    ['a wrong value type', 'map["a": 1] -> :map(string, string)'],
    ['a wrong key type', 'map["a": 1] -> :map(number, number)'],
  ])('halts #TYPE_MISMATCH on an assertion with %s', async (_n, source) => {
    await expectHalt(() => run(source), { code: 'TYPE_MISMATCH' });
  });

  assertIt('returns false from a check on a mismatch', async () => {
    expect(await run('map["a": 1] -> :?map(string, string)')).toBe(false);
    expect(await run('map["a": 1] -> :?map(number, number)')).toBe(false);
  });

  assertIt('halts #TYPE_MISMATCH on a typed capture mismatch', async () => {
    await expectHalt(() => run('map["a": 1] => $m:map(string, string)'), {
      code: 'TYPE_MISMATCH',
    });
  });

  assertIt('halts #TYPE_MISMATCH on a declared literal mismatch', async () => {
    await expectHalt(() => run('map(string, string)["a": 1] => $m'), {
      code: 'TYPE_MISMATCH',
    });
  });

  assertIt('halts #TYPE_MISMATCH on an fn return mismatch', async () => {
    await expectHalt(
      () => run('fn(): map(string, string) { map["a": 1] } => $f\n$f()'),
      { code: 'TYPE_MISMATCH' }
    );
  });

  selectIt(
    'treats any scalar as a miss on an undeclared empty map',
    async () => {
      expect(await run('map[] => $m\n$m[1] ?? "none"')).toBe('none');
      expect(await run('map[] => $m\n$m[#a] ?? "none"')).toBe('none');
    }
  );

  selectIt('checks a read against a declared empty map key type', async () => {
    await expectHalt(() => run('map(string, number)[] => $m\n$m[1] ?? 0'), {
      code: 'TYPE_MISMATCH',
    });
    expect(await run('map(string, number)[] => $m\n$m["a"] ?? 0')).toBe(0);
  });

  selectIt('checks a read against a declared union key type', async () => {
    const decl = 'map(union("a", "b"), number)[] => $m\n';
    await expectHalt(() => run(`${decl}$m[1] ?? 0`), {
      code: 'TYPE_MISMATCH',
    });
    expect(await run(`${decl}$m["a"] ?? 0`)).toBe(0);
  });

  probeIt('agrees with the read on a declared union key type', async () => {
    await expectHalt(
      () => run('map(union("a", "b"), number)[] => $m\n$m.?[1]'),
      { code: 'TYPE_MISMATCH' }
    );
  });

  probeIt('agrees with the read on a declared empty map', async () => {
    await expectHalt(() => run('map(string, number)[] => $m\n$m.?[1]'), {
      code: 'TYPE_MISMATCH',
    });
    expect(await run('map(string, number)[] => $m\n$m.?["a"]')).toBe(false);
    expect(await run('map[] => $m\n$m.?[1]')).toBe(false);
  });
});
