/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Unspecified type arguments
 *
 * A bare type name and its empty-parentheses form are one type.
 */

import { describe, expect } from 'vitest';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Unspecified type arguments', () => {
  rule('list.unspecified').it(
    'treats list, list(), and list(any) as one type',
    async () => {
      expect(await run('list == list()')).toBe(true);
      expect(await run('list() == list(any)')).toBe(true);
      expect(await run('list == list(any)')).toBe(true);
    }
  );

  rule('dict.empty-parens').it(
    'treats dict and dict() as one type',
    async () => {
      expect(await run('dict == dict()')).toBe(true);
    }
  );

  rule('dict.empty-parens').it(
    'infers the unspecified type for empty dict, tuple, and ordered literals',
    async () => {
      expect(await run('dict[].^type == dict()')).toBe(true);
      expect(await run('tuple[].^type == tuple()')).toBe(true);
      expect(await run('ordered[].^type == ordered()')).toBe(true);
      expect(await run('dict[].^type == list[].^type')).toBe(false);
    }
  );

  rule('ordered.empty-parens').it(
    'treats ordered and ordered() as one type',
    async () => {
      expect(await run('ordered == ordered()')).toBe(true);
    }
  );

  rule('tuple.unspecified').it(
    'treats tuple and tuple() as one type',
    async () => {
      expect(await run('tuple == tuple()')).toBe(true);
    }
  );

  rule('stream.unspecified').it(
    'treats stream, stream(), stream(any), and stream(any):any as one type',
    async () => {
      expect(await run('stream == stream()')).toBe(true);
      expect(await run('stream() == stream(any)')).toBe(true);
      expect(await run('stream(any) == stream(any, any)')).toBe(true);
      expect(await run('stream == stream(any, any)')).toBe(true);
    }
  );

  rule('introspection.bare').it(
    'reads a bare type name as its unspecified form',
    async () => {
      expect(await run('list.signature == list().signature')).toBe(true);
      expect(await run('list.inner == list().inner')).toBe(true);
    }
  );

  rule('introspection.print-bare').it(
    'prints every unspecified container type as its bare name',
    async () => {
      const forms: Array<[string, string]> = [
        ['list', 'list'],
        ['list()', 'list'],
        ['list(any)', 'list'],
        ['list[].^type', 'list'],
        ['dict()', 'dict'],
        ['dict[].^type', 'dict'],
        ['tuple()', 'tuple'],
        ['tuple[].^type', 'tuple'],
        ['ordered()', 'ordered'],
        ['ordered[].^type', 'ordered'],
        ['stream()', 'stream'],
        ['stream(any)', 'stream'],
        ['stream(any):any', 'stream'],
        ['stream:any', 'stream'],
        ['stream(number):any', 'stream(number)'],
        ['list[list[]].^type', 'list(list)'],
        ['tuple[list[], dict[]].^type', 'tuple(list, dict)'],
      ];
      for (const [source, printed] of forms) {
        expect(await run(`(${source}).signature`), source).toBe(printed);
      }
    }
  );

  rule('introspection.print-bare').it(
    'equals the type its printed form names',
    async () => {
      const pairs: Array<[string, string]> = [
        ['list[].^type', 'list'],
        ['dict[].^type', 'dict'],
        ['tuple[].^type', 'tuple'],
        ['ordered[].^type', 'ordered'],
        ['stream(any):any', 'stream'],
        ['list[list[]].^type', 'list(list)'],
        ['tuple[list[], dict[]].^type', 'tuple(list, dict)'],
      ];
      for (const [source, printed] of pairs) {
        expect(await run(`(${source}) == ${printed}`), source).toBe(true);
      }
    }
  );
});
