/**
 * Type-aware dict keys (#266).
 *
 * Rill dict keys carry type: number 1, boolean true, and string "1"/"true" are
 * distinct keys in the same dict. Number/boolean keys are held in a
 * collision-free sidecar; string-keyed dicts are unchanged.
 *
 * Covers behaviors 1-8 from the change:
 *   1. mixed number/string keys coexist (.len)
 *   2. type-aware dispatch (number vs string vs boolean)
 *   3. .keys/.values/.entries surface original typed keys; seq/enumerate too
 *   4. equality respects (type, value) key identity
 *   5. formatValue renders number keys unquoted, string keys quoted when needed
 *   6. copy/capture preserves typed keys
 *   7. string-keyed dicts behave exactly as before
 *   8. json serializes number keys to their string field form
 */

import { describe, it, expect } from 'vitest';
import { formatValue, deepEquals } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Type-aware dict keys (#266)', () => {
  describe('1. coexistence of number and string keys', () => {
    it('number 1 and string "1" are two distinct entries', async () => {
      expect(
        await run('dict[1: "number one", "1": "string one"] -> .len')
      ).toBe(2);
    });

    it('boolean true and string "true" are distinct entries', async () => {
      expect(await run('dict[true: "a", "true": "b"] -> .len')).toBe(2);
    });

    it('a plain string-keyed dict has the expected length', async () => {
      expect(await run('dict[a: 1, b: 2] -> .len')).toBe(2);
    });
  });

  describe('2. type-aware dispatch', () => {
    it('number input matches the number key', async () => {
      expect(
        await run('dict[1: "number one", "1": "string one"] => $d\n1 -> $d')
      ).toBe('number one');
    });

    it('string input matches the string key', async () => {
      expect(
        await run('dict[1: "number one", "1": "string one"] => $d\n"1" -> $d')
      ).toBe('string one');
    });

    it('boolean input matches the boolean key', async () => {
      expect(
        await run('dict[true: "bool", "true": "str"] => $d\ntrue -> $d')
      ).toBe('bool');
    });

    it('number dispatch does not match a string-only key', async () => {
      await expect(run('dict["1": "a"] => $d\n1 -> $d')).rejects.toThrow(
        /not found/
      );
    });

    it('bracket access is type-aware', async () => {
      expect(await run('dict[1: "a", "1": "b"] => $d\n$d[1]')).toBe('a');
      expect(await run('dict[1: "a", "1": "b"] => $d\n$d["1"]')).toBe('b');
    });

    it('existence check is type-aware', async () => {
      expect(await run('dict[1: "a"] => $d\n$d.?(1)')).toBe(true);
      expect(await run('dict[1: "a"] => $d\n$d.?("1")')).toBe(false);
      expect(await run('dict["1": "a"] => $d\n$d.?(1)')).toBe(false);
    });
  });

  describe('3. keys/values/entries and iteration surface typed keys', () => {
    it('.keys returns keys with their original types', async () => {
      expect(await run('dict[1: "a", "1": "b"] -> .keys')).toEqual(['1', 1]);
    });

    it('.values pairs with the typed keys', async () => {
      expect(await run('dict[1: "a", "1": "b"] -> .values')).toEqual([
        'b',
        'a',
      ]);
    });

    it('.entries lists [key, value] with typed keys', async () => {
      expect(await run('dict[1: "a", "1": "b"] -> .entries')).toEqual([
        ['1', 'b'],
        [1, 'a'],
      ]);
    });

    it('seq over a dict sees typed keys', async () => {
      expect(await run('dict[1: "a", 2: "b"] -> seq({ $.key })')).toEqual([
        1, 2,
      ]);
    });

    it('enumerate over a dict sees typed keys', async () => {
      expect(await run('dict[7: "a"] -> enumerate -> fan({ $.key })')).toEqual([
        7,
      ]);
    });

    it('sort over a dict orders by typed key', async () => {
      // sort of a dict yields an ordered[[key, value]]; the number keys drive a
      // numeric ordering (1 before 2) rather than a string ordering.
      expect(
        formatValue(await run('dict[2: "b", 1: "a"] -> sort({ $.key })'))
      ).toBe('ordered[1: "a", 2: "b"]');
    });
  });

  describe('4. equality respects (type, value) key identity', () => {
    it('equal number-keyed dicts compare equal', async () => {
      const a = await run('dict[1: "a"]');
      const b = await run('dict[1: "a"]');
      expect(deepEquals(a, b)).toBe(true);
    });

    it('number key differs from string key of same spelling', async () => {
      const a = await run('dict[1: "a"]');
      const b = await run('dict["1": "a"]');
      expect(deepEquals(a, b)).toBe(false);
    });

    it('boolean key differs from string key of same spelling', async () => {
      const a = await run('dict[true: "a"]');
      const b = await run('dict["true": "a"]');
      expect(deepEquals(a, b)).toBe(false);
    });

    it('equality is available in-language', async () => {
      expect(await run('(dict[1: "a"] == dict[1: "a"])')).toBe(true);
      expect(await run('(dict[1: "a"] == dict["1": "a"])')).toBe(false);
    });
  });

  describe('5. formatValue round-trips', () => {
    it('renders a number key unquoted', async () => {
      expect(formatValue(await run('dict[1: "a"]'))).toBe('dict[1: "a"]');
    });

    it('renders a boolean key unquoted', async () => {
      expect(formatValue(await run('dict[true: "a"]'))).toBe('dict[true: "a"]');
    });

    it('renders an identifier string key unquoted (unchanged)', async () => {
      expect(formatValue(await run('dict[a: 1]'))).toBe('dict[a: 1]');
    });

    it('quotes a numeric-looking string key so it re-parses distinctly', async () => {
      expect(formatValue(await run('dict["1": "a"]'))).toBe('dict["1": "a"]');
    });

    it('quotes a string key that would otherwise parse as a boolean', async () => {
      expect(formatValue(await run('dict["true": "a"]'))).toBe(
        'dict["true": "a"]'
      );
    });

    it('quotes a non-identifier string key', async () => {
      expect(formatValue(await run('dict["user-id": 1]'))).toBe(
        'dict["user-id": 1]'
      );
    });

    it('renders a mixed dict so it re-parses', async () => {
      expect(formatValue(await run('dict[1: "a", "1": "b"]'))).toBe(
        'dict["1": "b", 1: "a"]'
      );
    });
  });

  describe('6. copy/capture preserves typed keys', () => {
    it('capturing a dict preserves its number keys', async () => {
      expect(await run('dict[1: "a"] => $d\n$d => $e\n1 -> $e')).toBe('a');
    });

    it('captured typed keys count toward length', async () => {
      expect(
        await run('dict[1: "a", "1": "b"] => $d\n$d => $e\n$e -> .len')
      ).toBe(2);
    });
  });

  describe('7. string-keyed dicts are unchanged', () => {
    it('dot access is unchanged', async () => {
      expect(await run('dict[a: 1, b: 2] => $d\n$d.a')).toBe(1);
    });

    it('quoted string keys behave as before', async () => {
      expect(await run('dict["a": 1] => $d\n$d.a')).toBe(1);
    });

    it('a string-keyed dict equals its native object shape', async () => {
      expect(await run('dict[a: 1, b: 2]')).toEqual({ a: 1, b: 2 });
    });

    it('empty dict is empty', async () => {
      expect(await run('dict[a: 1] -> .empty')).toBe(false);
      expect(await run('dict["x": 1] => $d\n$d.x')).toBe(1);
    });
  });

  describe('8. json serialization of number keys', () => {
    it('a number key serializes to its string field form', async () => {
      expect(await run('dict[1: "a"] -> json')).toBe('{"1":"a"}');
    });

    it('a boolean key serializes to its string field form', async () => {
      expect(await run('dict[true: "a"] -> json')).toBe('{"true":"a"}');
    });

    it('a mixed dict serializes without crashing', async () => {
      // String and number keys of the same spelling collapse in JSON (field
      // names are strings); last write wins. This must not crash.
      const out = (await run('dict[1: "a", "1": "b"] -> json')) as string;
      expect(JSON.parse(out)).toEqual({ '1': expect.any(String) });
    });
  });

  describe('reflection over typed keys', () => {
    it('.^type includes number keys under their string form', async () => {
      expect(formatValue(await run('dict[1: "a"] => $d\n$d.^type'))).toBe(
        'dict(1: string)'
      );
    });
  });

  describe('empty dict with only typed keys', () => {
    it('is not empty and reports the right length', async () => {
      expect(await run('dict[1: "a"] -> .empty')).toBe(false);
      expect(await run('dict[1: "a"] -> .len')).toBe(1);
    });
  });
});
