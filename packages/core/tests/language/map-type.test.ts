/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: the map type constructor
 *
 * `map(K, V)` names a key type and a value type. The key is one scalar kind,
 * a bare `map` is `map(any, any)`, and the inner of a map type is a tuple of
 * its two parameters.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

/** Assert that `source` evaluates to a value equal to `expected` (rill `==`). */
async function expectEqual(source: string, expected: string): Promise<void> {
  expect(await run(`(${source}) == (${expected})`)).toBe(true);
}

describe('map type constructor', () => {
  const { it: formIt } = rule('map.form');
  const { it: valueIt } = rule('map.value-type');
  const { it: kindIt } = rule('map.key-kind');
  const { it: unionIt } = rule('map.key-union');
  const { it: mixedIt } = rule('map.key-union-mixed');
  const { it: anyIt } = rule('map.key-any');
  const { it: unspecifiedIt } = rule('map.unspecified');
  const { it: outerIt } = rule('map.no-outer');
  const { it: equalityIt } = rule('map.type-equality');
  const { it: innerIt } = rule('map.inner');
  const { it: innerBareIt } = rule('map.inner-unspecified');

  formIt('names the signature of a two-argument map type', async () => {
    expect(await run('map(atom, number).signature')).toBe('map(atom, number)');
  });

  formIt.each([
    ['one argument', 'map(string)'],
    ['three arguments', 'map(string, number, bool)'],
    ['a named argument', 'map(k: string, number)'],
    ['a default on the key', 'map(string = "a", number)'],
    ['a default on the value', 'map(string, number = 1)'],
  ])('halts #INVALID_INPUT for %s', async (_label, src) => {
    await expectHalt(() => run(src), { code: 'INVALID_INPUT' });
  });

  valueIt.each(['number', 'list(string)', 'dict(a: number)', 'map', 'any'])(
    'accepts %s as the value type',
    async (value) => {
      expect(await run(`map(string, ${value}).?inner`)).toBe(true);
    }
  );

  kindIt.each(['string', 'number', 'bool', 'atom', 'datetime', 'duration'])(
    'accepts %s as the key type',
    async (key) => {
      expect(await run(`map(${key}, number).?inner`)).toBe(true);
    }
  );

  kindIt.each(['list', 'dict', 'tuple', 'ordered', 'type', 'vector'])(
    'halts #INVALID_INPUT for %s as the key type',
    async (key) => {
      await expectHalt(() => run(`map(${key}, number)`), {
        code: 'INVALID_INPUT',
      });
    }
  );

  unionIt('accepts a union of atom literals as the key type', async () => {
    expect(await run('map(union(#a, #b), number).signature')).toBe(
      'map(union(#a, #b), number)'
    );
  });

  unionIt('accepts error_code as an atom key type', async () => {
    expect(await run('map(error_code, number).?inner')).toBe(true);
  });

  mixedIt('halts #INVALID_INPUT for a union of two kinds', async () => {
    await expectHalt(() => run('map(union(atom, string), number)'), {
      code: 'INVALID_INPUT',
    });
  });

  mixedIt(
    'halts #INVALID_INPUT for a union of mixed literal kinds',
    async () => {
      await expectHalt(() => run('map(union(#a, "b"), number)'), {
        code: 'INVALID_INPUT',
      });
    }
  );

  anyIt('accepts any as the key type', async () => {
    expect(await run('map(any, number).signature')).toBe('map(any, number)');
  });

  unspecifiedIt('equates map, map(), and map(any, any)', async () => {
    expect(await run('map == map()')).toBe(true);
    expect(await run('map == map(any, any)')).toBe(true);
    expect(await run('map().signature')).toBe('map');
  });

  outerIt('rejects an outer on a bare map and on map(K, V)', async () => {
    await expect(run('map(atom, number):string')).rejects.toMatchObject({
      errorId: 'RILL-P006',
    });
    await expect(run('map:string')).rejects.toMatchObject({
      errorId: 'RILL-P006',
    });
  });

  equalityIt('equates map types with equal keys and values', async () => {
    expect(await run('map(atom, number) == map(atom, number)')).toBe(true);
  });

  equalityIt('distinguishes map types by key or value', async () => {
    expect(await run('map(atom, number) == map(string, number)')).toBe(false);
    expect(await run('map(atom, number) == map(atom, string)')).toBe(false);
  });

  innerIt('returns a tuple of the key and value types', async () => {
    await expectEqual('map(atom, number).inner', 'tuple[atom, number]');
  });

  innerBareIt('returns a tuple of any for a bare map', async () => {
    await expectEqual('map.inner', 'tuple[any, any]');
    await expectEqual('map().inner', 'tuple[any, any]');
  });
});
