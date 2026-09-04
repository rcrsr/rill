/**
 * Dict equality guards its right operand (#281).
 *
 * eqDict previously called Object.keys(b) without checking b was a dict. For
 * any primitive or array, Object.keys returns [], so an empty dict compared
 * equal to non-dicts (dict[] == 5, dict[] == "", dict[] == list[]) and the
 * relation was asymmetric (5 == dict[] was already false). The guard returns
 * false unless b is a dict, without touching the typed-key comparison.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Dict eq vs non-dict guard (#281)', () => {
  it('empty dict is not equal to a number', async () => {
    expect(await run('(dict[] == 5)')).toBe(false);
  });

  it('empty dict is not equal to a string', async () => {
    expect(await run('(dict[] == "")')).toBe(false);
  });

  it('empty dict is not equal to a bool', async () => {
    expect(await run('(dict[] == true)')).toBe(false);
  });

  it('empty dict is not equal to an empty list', async () => {
    expect(await run('(dict[] == list[])')).toBe(false);
  });

  it('non-dict on the left is not equal to an empty dict (was already false)', async () => {
    expect(await run('(5 == dict[])')).toBe(false);
  });

  it('empty dict is unequal (!=) to a number', async () => {
    expect(await run('(dict[] != 5)')).toBe(true);
  });

  it('a non-empty dict is not equal to a non-dict', async () => {
    expect(await run('(dict[a: 1] == 5)')).toBe(false);
  });

  describe('regression: dict-to-dict equality unchanged', () => {
    it('equal string-keyed dicts are still equal', async () => {
      expect(await run('(dict[a: 1] == dict[a: 1])')).toBe(true);
    });

    it('equal typed number-keyed dicts are still equal', async () => {
      expect(await run('(dict[1: "a"] == dict[1: "a"])')).toBe(true);
    });

    it('number key and string key stay distinct', async () => {
      expect(await run('(dict[1: "a"] == dict["1": "a"])')).toBe(false);
    });
  });
});
