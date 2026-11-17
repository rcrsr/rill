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
import { expectHalt } from '../helpers/halt.js';

describe('Dict eq vs non-dict guard (#281)', () => {
  it('empty dict is not equal to a number', async () => {
    await expectHalt(() => run('(dict[] == 5)'), { code: 'TYPE_MISMATCH' });
  });

  it('empty dict is not equal to a string', async () => {
    await expectHalt(() => run('(dict[] == "")'), { code: 'TYPE_MISMATCH' });
  });

  it('empty dict is not equal to a bool', async () => {
    await expectHalt(() => run('(dict[] == true)'), { code: 'TYPE_MISMATCH' });
  });

  it('empty dict is not equal to an empty list', async () => {
    await expectHalt(() => run('(dict[] == list[])'), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('non-dict on the left is not equal to an empty dict (was already false)', async () => {
    await expectHalt(() => run('(5 == dict[])'), { code: 'TYPE_MISMATCH' });
  });

  it('empty dict is unequal (!=) to a number', async () => {
    await expectHalt(() => run('(dict[] != 5)'), { code: 'TYPE_MISMATCH' });
  });

  it('a non-empty dict is not equal to a non-dict', async () => {
    await expectHalt(() => run('(dict[a: 1] == 5)'), { code: 'TYPE_MISMATCH' });
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
