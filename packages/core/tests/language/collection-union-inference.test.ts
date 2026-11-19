/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Collection union inference
 *
 * A collection whose elements differ in type infers a union element type
 * instead of halting. Types compare with `==`, because a union's printed
 * member order is canonical rather than first-seen.
 */

import { describe, expect } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

describe('Rill Language: collection union inference', () => {
  const { it } = rule(
    'inference.describes',
    'inference.literal-union',
    'inference.nested-union',
    'inference.dict-iteration',
    'inference.recursive',
    'inference.shape-union',
    'inference.shape-union-ordered'
  );

  describe('list literals', () => {
    rule('carried-type.own-element').it(
      'gives each iterated element of an undeclared mixed list its own type',
      async () => {
        const result = await run(
          'list[1, "a"] -> seq({ $.^type -> .signature })'
        );
        expect(result).toEqual(['number', 'string']);
      }
    );

    it('list[1, "a"] runs without halting', async () => {
      expect(await run('list[1, "a"]')).toEqual([1, 'a']);
    });

    it('list[1, "a"] infers list(union(number, string))', async () => {
      expect(
        await run('list[1, "a"].^type == list(union(number, string))')
      ).toBe(true);
    });

    it('member order does not change the inferred type', async () => {
      expect(await run('list["a", 1].^type == list[1, "a"].^type')).toBe(true);
    });

    it('a number and a list infer a union of both', async () => {
      expect(
        await run('list[1, list[1]].^type == list(union(number, list(number)))')
      ).toBe(true);
    });

    it('uniform elements still infer one element type', async () => {
      expect(await run('list[1, 2].^type == list(number)')).toBe(true);
    });

    it('an empty list infers list(any)', async () => {
      expect(await run('list[].^type == list(any)')).toBe(true);
    });

    it('a mixed list passes an unparameterised list assertion', async () => {
      expect(await run('list[1, "a"] -> :list')).toEqual([1, 'a']);
    });

    it('a mixed list halts a narrower list assertion', async () => {
      await expectHalt(() => run('list[1, "a"] -> :list(number)'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('nested elements', () => {
    it('inner lists of different types keep their detail', async () => {
      expect(
        await run(
          'list[list[1], list["a"]].^type == list(union(list(number), list(string)))'
        )
      ).toBe(true);
    });

    it('a union-typed inner list absorbs a narrower sibling', async () => {
      expect(
        await run(
          'list[list["a", 1], list["a"]].^type == list(list(union(string, number)))'
        )
      ).toBe(true);
    });

    it('the union rule recurses through deeper nesting', async () => {
      expect(
        await run(
          'list[list[list[1]], list[list["a"]]].^type == list(union(list(list(number)), list(list(string))))'
        )
      ).toBe(true);
    });

    it('an empty inner list yields to its populated sibling', async () => {
      expect(
        await run('list[list[], list[1]].^type == list(list(number))')
      ).toBe(true);
    });

    it('a nested mixed list still has the bare list type', async () => {
      expect(await run('list[list[1], list["a"]] -> :?list(list)')).toBe(true);
    });

    it('dicts that differ only in keys infer a union of their shapes', async () => {
      expect(
        await run(
          'list[dict[a: 1], dict[b: 2]].^type == list(union(dict(a: number), dict(b: number)))'
        )
      ).toBe(true);
    });

    it('ordereds that differ only in keys infer a union of their shapes', async () => {
      expect(
        await run(
          'list[ordered[a: 1], ordered[b: 2]].^type == list(union(ordered(a: number), ordered(b: number)))'
        )
      ).toBe(true);
    });

    it('dicts that differ in value type infer a union of their shapes', async () => {
      expect(
        await run(
          'list[dict[a: 1], dict[a: "x"]].^type == list(union(dict(a: number), dict(a: string)))'
        )
      ).toBe(true);
    });
  });

  describe('collection operator results', () => {
    it('seq infers the union of its callback results', async () => {
      expect(
        await run(
          '(list[1, 2] -> seq({ ($ == 1) ? "a" ! 2 }) -> .^type) == list(union(string, number))'
        )
      ).toBe(true);
    });

    it('fan infers the union of its callback results', async () => {
      expect(
        await run(
          '(list[1, 2] -> fan({ ($ == 1) ? "a" ! 2 }) -> .^type) == list(union(string, number))'
        )
      ).toBe(true);
    });

    it('filter keeps the source union element type', async () => {
      expect(
        await run(
          '(list[1, "a"] -> :list(union(number, string)) -> filter({ $ == "a" }) -> .^type) == list(string)'
        )
      ).toBe(true);
    });

    it('acc infers the union of its running values', async () => {
      expect(
        await run(
          '(list[1, 2] -> acc(0, fn(e, a) { ($e == 1) ? "a" ! 2 }) -> .^type) == list(union(string, number))'
        )
      ).toBe(true);
    });

    it('a uniform seq result keeps one element type', async () => {
      expect(
        await run('(list[1, 2] -> seq({ $ * 2 }) -> .^type) == list(number)')
      ).toBe(true);
    });

    it('a mixed seq result halts a narrower capture type', async () => {
      await expectHalt(
        () =>
          run('list[1, 2] -> seq({ ($ == 1) ? "a" ! 2 }) => $out:list(number)'),
        { code: 'TYPE_MISMATCH' }
      );
    });
  });

  describe('dict iteration', () => {
    it('.values of a mixed dict infers list(union(number, string))', async () => {
      expect(
        await run(
          '(dict[a: 1, b: "x"] -> .values -> .^type) == list(union(number, string))'
        )
      ).toBe(true);
    });

    it('seq over the values of a mixed dict infers the union of the values', async () => {
      expect(
        await run(
          '(dict[a: 1, b: "x"] -> seq({ $.value }) -> .^type) == list(union(number, string))'
        )
      ).toBe(true);
    });

    it('seq over a mixed dict infers the union of its entry types', async () => {
      expect(
        await run(
          '(dict[a: 1, b: "x"] -> seq({ $ }) -> .^type) == list(union(dict(key: string, value: number), dict(key: string, value: string)))'
        )
      ).toBe(true);
    });
  });
});
