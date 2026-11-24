/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Removed uniform value types
 *
 * `dict(V)` and `ordered(V)` no longer exist: a dict or ordered type always
 * names its fields, and keyed data is written as `map(string, V)`. Inference
 * for a list of dicts with different keys produces a union of shapes.
 */

import { describe, expect, it } from 'vitest';
import { rule } from '../helpers/rule.js';
import { parse, ParseError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

function parseError(source: string): ParseError {
  try {
    parse(source);
  } catch (err) {
    if (err instanceof ParseError) return err;
    throw err;
  }
  throw new Error(`expected a ParseError for: ${source}`);
}

describe('Rill Language: Removed uniform value types', () => {
  describe('uniform forms raise RILL-P012', () => {
    rule(
      'dict.no-uniform',
      'dict.fields',
      'ordered.no-uniform',
      'ordered.fields'
    ).it.each([
      ['dict(number)', 'dict(number)'],
      ['ordered(fn)', 'ordered(fn)'],
      ['dict($t)', 'dict($t)'],
      ['dict(number = 1)', 'dict(number = 1)'],
      ['dict(fn, a: string)', 'dict(fn, a: string)'],
      ['ordered(fn, a: string)', 'ordered(fn, a: string)'],
      ['an assertion target', '[a: 1] -> :dict(number)'],
      ['a conversion target', '[a: 1] -> dict(number)'],
      ['a capture type', '[a: 1] => $x:dict(number)'],
      ['a nested element type', 'list(dict(number))'],
    ])('rejects %s naming map(string, V)', (_label, source) => {
      const err = parseError(source);
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('map(string,');
    });

    rule('dict.no-uniform', 'ordered.no-uniform').it(
      'names the written value type in the replacement',
      () => {
        expect(parseError('dict(number)').message).toContain(
          'map(string, number)'
        );
        expect(parseError('ordered(list(number))').message).toContain(
          'map(string, list(number))'
        );
      }
    );

    it.each([
      ['dict(string, number)', 'dict(string, number)'],
      ['ordered(string, number)', 'ordered(string, number)'],
    ])('rejects %s naming map(K, V)', (_label, source) => {
      const err = parseError(source);
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('map(K, V)');
    });
  });

  describe('forms that remain', () => {
    it('keeps a bare dict type matching any dict', async () => {
      const result = await run('[a: 1, b: "s"] -> dict');
      expect(result).toEqual({ a: 1, b: 's' });
    });

    it('keeps tuple(number) keeping only the first position', async () => {
      const result = await run('tuple[1, 2, 3] -> tuple(number)');
      expect(result).toEqual({
        __rill_tuple: true,
        entries: [1],
      });
    });

    it('keeps tuple["a", 1] failing tuple(number) on the first position', async () => {
      await expectHalt(() => run('tuple["a", 1] -> tuple(number)'), {
        code: 'RILL_R038',
      });
    });

    it('keeps a structural dict assertion', async () => {
      const result = await run(
        '[name: "a", age: 1] -> dict(name: string, age: number)'
      );
      expect(result).toEqual({ name: 'a', age: 1 });
    });

    it('keeps a multi-element structural tuple', async () => {
      const result = await run('tuple["a", 1] -> tuple(string, number)');
      expect(result).toEqual({
        __rill_tuple: true,
        entries: ['a', 1],
      });
    });

    it('infers a union of shapes for a list of dicts with different keys', async () => {
      const sig = await run('list[dict[a: 1], dict[b: 2]].^type.signature');
      expect(sig).toBe('list(union(dict(a: number), dict(b: number)))');
    });

    it('infers a union of the dict types when value types conflict', async () => {
      const result = await run(
        'list[dict[a: 1], dict[a: "s"]].^type == list(union(dict(a: number), dict(a: string)))'
      );
      expect(result).toBe(true);
    });

    it('accepts map(string, V) for keyed data', async () => {
      const result = await run('map["a": 1, "b": 2] -> map(string, number)');
      expect(result).toBeDefined();
    });
  });
});
