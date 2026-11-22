/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: the map literal
 *
 * `map[key: value, ...]` builds a map. A key is a value, not a name: a scalar
 * literal, `$name`, a parenthesized expression, or a list of keys that share
 * one value.
 */

import { describe, expect } from 'vitest';
import {
  createRuntimeContext,
  execute,
  isAtom,
  isMap,
  parse,
  ParseError,
  parseWithRecovery,
} from '@rcrsr/rill';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

/** The keys of the map `source` evaluates to; an atom key reads as `#name`. */
async function mapKeys(source: string): Promise<unknown[]> {
  const value = await run(source);
  if (!isMap(value)) throw new Error(`expected a map from: ${source}`);
  return value.entries.map(([key]) =>
    isAtom(key) ? `#${key.atom.name}` : key
  );
}

/** The values of the map `source` evaluates to, in entry order. */
async function mapValues(source: string): Promise<unknown[]> {
  const value = await run(source);
  if (!isMap(value)) throw new Error(`expected a map from: ${source}`);
  return value.entries.map(([, entryValue]) => entryValue);
}

/** Runs a script through parseWithRecovery + execute and returns its value. */
async function runRecovered(source: string): Promise<unknown> {
  const { result } = await execute(
    parseWithRecovery(source).ast,
    createRuntimeContext({})
  );
  return result;
}

/** Parses `source` and returns the ParseError it raises, failing when it parses. */
function parseError(source: string): ParseError {
  try {
    parse(source);
  } catch (err) {
    if (err instanceof ParseError) return err;
    throw err;
  }
  throw new Error(`expected a ParseError for: ${source}`);
}

describe('map literal', () => {
  const { it: valueIt } = rule('map.key-value');
  const { it: multiIt } = rule('map.key-multi');
  const { it: pipeIt } = rule('map.key-pipe');
  const { it: bareIt } = rule('map.key-bare');
  const { it: dupParseIt } = rule('map.duplicate-parse');
  const { it: dupRunIt } = rule('map.duplicate-run');
  const { it: mixedIt } = rule('map.key-mixed');
  const { it: scalarIt } = rule('map.key-scalar');
  const { it: reservedIt } = rule('map.no-reserved');
  const { it: inferValuesIt } = rule('map.infer-values');
  const { it: inferKeysIt } = rule('map.infer-keys');
  const { it: orderIt } = rule('map.order');
  const { it: equalityIt } = rule('map.equality');
  const { it: invalidIt } = rule('invalid-value.map');

  valueIt('holds a number key as a number', async () => {
    expect(await mapKeys('map[1: "x", 2: "y"]')).toEqual([1, 2]);
  });

  valueIt('holds a negative number key', async () => {
    expect(await mapKeys('map[-1: "x"]')).toEqual([-1]);
  });

  valueIt.each([
    ['a string', '"a"', 'a'],
    ['a bool', 'true', true],
    ['an atom', '#a', '#a'],
  ])('holds %s key', async (_label, key, expected) => {
    expect(await mapKeys(`map[${key}: 1]`)).toEqual([expected]);
  });

  valueIt('reads a $name key as the value of the variable', async () => {
    expect(await mapKeys('"k" => $k\nmap[$k: 1]')).toEqual(['k']);
  });

  valueIt('creates an empty map from map[]', async () => {
    expect(await mapKeys('map[]')).toEqual([]);
  });

  multiIt('binds every key of a bracketed list to the value', async () => {
    expect(await mapKeys('map[[#a, #b]: 1]')).toEqual(['#a', '#b']);
    expect(await mapValues('map[[#a, #b]: 1]')).toEqual([1, 1]);
  });

  multiIt('binds every key of a list[...] key to the value', async () => {
    expect(await mapKeys('map[list["a", "b"]: 1]')).toEqual(['a', 'b']);
  });

  multiIt('halts RILL-R002 for an empty key list', async () => {
    await expectHalt(() => run('map[[]: 1]'), {
      code: 'RILL_R002',
    });
  });

  pipeIt('accepts a parenthesized pipe chain as a key', async () => {
    expect(await mapKeys('"a" => $x\nmap[($x -> .upper): 1]')).toEqual(['A']);
  });

  pipeIt.each([
    ['an unparenthesized pipe chain', 'map["a" -> .upper: 1]'],
    ['a member access', 'map[$a.b: 1]'],
    ['a call', 'map[f(1): 1]'],
  ])('rejects %s as a key', (_label, src) => {
    expect(() => parse(src)).toThrow(ParseError);
  });

  bareIt('rejects a bare identifier key with RILL-P001 and a hint', () => {
    const err = parseError('map[a: 1]');
    expect(err.errorId).toBe('RILL-P001');
    expect(err.message).toContain('#a');
  });

  dupParseIt('rejects equal atom keys with RILL-P027', () => {
    const err = parseError('map[#a: 1, #a: 2]');
    expect(err.errorId).toBe('RILL-P027');
    expect(err.message).toContain("Duplicate key '#a' in map");
  });

  dupParseIt.each([
    ['1 and 1.0', 'map[1: "x", 1.0: "y"]'],
    ['0 and -0', 'map[0: "x", -0: "y"]'],
    ['equal strings', 'map["a": 1, "a": 2]'],
    ['equal bools', 'map[true: 1, true: 2]'],
    ['a literal inside a key list', 'map[[#a, #b]: 1, #a: 2]'],
  ])('rejects %s as equal literal keys', (_label, src) => {
    expect(parseError(src).errorId).toBe('RILL-P027');
  });

  dupParseIt('treats an interpolated string key as not a literal', async () => {
    await expectHalt(() => run('"a" => $x\nmap["{$x}": 1, "{$x}": 2]'), {
      code: 'INVALID_INPUT',
    });
  });

  dupRunIt('halts #INVALID_INPUT for equal computed keys', async () => {
    await expectHalt(() => run('"a" => $k\nmap[$k: 1, $k: 2]'), {
      code: 'INVALID_INPUT',
    });
  });

  dupRunIt(
    'halts #INVALID_INPUT for a computed key equal to a literal',
    async () => {
      await expectHalt(() => run('1 => $k\nmap[$k: 1, 1: 2]'), {
        code: 'INVALID_INPUT',
      });
    }
  );

  mixedIt('halts #TYPE_MISMATCH for keys of two kinds', async () => {
    await expectHalt(() => run('map[#a: 1, "b": 2]'), {
      code: 'TYPE_MISMATCH',
    });
  });

  mixedIt('tells equal literals from a number and a string key', async () => {
    expect(parseError('map[1: "x", 1.0: "y"]').errorId).toBe('RILL-P027');
    await expectHalt(() => run('map[1: "x", "1": "y"]'), {
      code: 'TYPE_MISMATCH',
    });
  });

  scalarIt.each([
    ['a list', 'list[1] => $k\nmap[$k: 1]'],
    ['a dict', 'dict[a: 1] => $k\nmap[$k: 1]'],
    ['a tuple', 'tuple[1] => $k\nmap[$k: 1]'],
  ])('halts #TYPE_MISMATCH for %s key', async (_label, src) => {
    await expectHalt(() => run(src), { code: 'TYPE_MISMATCH' });
  });

  reservedIt('holds a key named like a method', async () => {
    expect(await mapKeys('map["values": 1]')).toEqual(['values']);
    expect(await mapKeys('map[#keys: 1]')).toEqual(['#keys']);
  });

  inferValuesIt('infers a union of the value types', async () => {
    expect(await run('map[#a: 1, #b: "x"].^type.signature')).toBe(
      'map(atom, union(number, string))'
    );
  });

  inferKeysIt('keeps the declared key type of a declaration', async () => {
    expect(
      await run(
        'map(union(#a, #b), number)[#a: 1, #b: 2] => $m\n$m.^type.signature'
      )
    ).toBe('map(union(#a, #b), number)');
  });

  orderIt('keeps insertion order', async () => {
    expect(await mapKeys('map[3: "c", 1: "a", 2: "b"]')).toEqual([3, 1, 2]);
  });

  equalityIt(
    'treats maps with equal entries as equal in any order',
    async () => {
      expect(await run('map[1: "a", 2: "b"] == map[2: "b", 1: "a"]')).toBe(
        true
      );
    }
  );

  equalityIt('treats maps with different values as unequal', async () => {
    expect(await run('map[1: "a"] == map[1: "b"]')).toBe(false);
  });

  invalidIt('raises the halt an invalid value entry holds', async () => {
    await expectHalt(
      () =>
        runRecovered(
          'guard(on: list[#NOT_A_CODE]) { 1 } => $bad\nmap[1: $bad]'
        ),
      { code: 'R001' }
    );
  });
});
