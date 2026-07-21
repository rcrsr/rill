import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import type { ResolverResult, SchemeResolver } from '@rcrsr/rill';

import { run as runWithOptions } from '../helpers/runtime.js';

async function run(code: string) {
  const ctx = createRuntimeContext({});
  const result = await execute(parse(code), ctx);
  return result.result;
}

/** All 12 KEYWORDS-table token types (packages/core/src/lexer/operators.ts). */
const KEYWORD_MEMBER_NAMES = [
  'true',
  'false',
  'break',
  'return',
  'yield',
  'pass',
  'assert',
  'error',
  'guard',
  'retry',
  'while',
  'do',
];

describe('implicit $ property access bug', () => {
  describe('property access on pipe value', () => {
    it('explicit $.field works', async () => {
      const result = await run('dict[a: 1] -> $.a');
      expect(result).toBe(1);
    });

    it('implicit .field should work', async () => {
      // .field should be sugar for $.field
      const result = await run('dict[a: 1] -> .a');
      expect(result).toBe(1);
    });

    it('explicit $.type in condition works', async () => {
      const result = await run(
        'dict[type: "json"] -> ($.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('implicit .type in condition should work', async () => {
      // This currently fails with "Unknown method: type"
      const result = await run(
        'dict[type: "json"] -> (.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('chained implicit property access', async () => {
      const result = await run('dict[a: dict[b: 1]] -> .a.b');
      expect(result).toBe(1);
    });
  });

  describe('method vs property disambiguation', () => {
    it('.len is a method (returns length)', async () => {
      const result = await run('"hello" -> .len');
      expect(result).toBe(5);
    });

    it('.type is a property access (dict field)', async () => {
      const result = await run('dict[type: "test"] -> .type');
      expect(result).toBe('test');
    });
  });

  describe('dict key shadows built-in method name', () => {
    it('returns dict value when key matches built-in method name (non-callable)', async () => {
      // "model" is a vector built-in method. A dict key named "model" should
      // take priority over the built-in, returning the dict's own value.
      const result = await run('dict[model: "gpt-4"] => $msg\n$msg.model');
      expect(result).toBe('gpt-4');
    });

    it('invokes closure when dict key matching built-in name holds a closure', async () => {
      // When the dict value under the shadowing key is a callable, accessing
      // it as a method should invoke the closure, not the built-in.
      const result = await run('dict[model: ||{ "custom" }] => $d\n$d.model()');
      expect(result).toBe('custom');
    });

    it('returns dict value via implicit pipe access when key shadows built-in', async () => {
      // Same as above but using implicit $.field sugar via pipe.
      const result = await run('dict[model: "gpt-4"] -> .model');
      expect(result).toBe('gpt-4');
    });
  });

  describe('keyword names as dotted member access (issue #129)', () => {
    // A KEYWORDS-table token immediately following DOT or DOT_QUESTION is
    // retyped to METHOD_NAME by the lexer, so all 12 keyword names are valid
    // member names after a dot.

    describe('call form: $obj.<keyword>() invokes a dict-bound closure', () => {
      it.each(KEYWORD_MEMBER_NAMES)(
        'invokes the closure stored under key "%s"',
        async (keyword) => {
          const result = await run(
            `dict["${keyword}": ||{ "value-${keyword}" }] => $d\n$d.${keyword}()`
          );
          expect(result).toBe(`value-${keyword}`);
        }
      );
    });

    describe('bare property form: $obj.<keyword> reads a plain field', () => {
      it.each(KEYWORD_MEMBER_NAMES)(
        'reads the field stored under key "%s"',
        async (keyword) => {
          const result = await run(
            `dict["${keyword}": "field-${keyword}"] => $d\n$d.${keyword}`
          );
          expect(result).toBe(`field-${keyword}`);
        }
      );
    });

    describe('optional/existence form: $obj.?<keyword>', () => {
      it.each(KEYWORD_MEMBER_NAMES)(
        'reports existence for key "%s"',
        async (keyword) => {
          const present = await run(
            `dict["${keyword}": "x"] => $d\n$d.?${keyword}`
          );
          expect(present).toBe(true);

          const absent = await run(`dict["other": "x"] => $d\n$d.?${keyword}`);
          expect(absent).toBe(false);
        }
      );
    });

    describe('use<scheme:pkg.error> resource segment', () => {
      it('parses a keyword-named dot segment and resolves the joined resource', async () => {
        let capturedResource = '';
        const resolver: SchemeResolver = (resource: string): ResolverResult => {
          capturedResource = resource;
          return { kind: 'value', value: 'resolved' };
        };
        const result = await runWithOptions('use<host:pkg.error>', {
          resolvers: { host: resolver },
        });
        expect(result).toBe('resolved');
        expect(capturedResource).toBe('pkg.error');
      });
    });

    describe('non-interpolated literal snippets (corpus-parity visible)', () => {
      it('bare property form reads a keyword-named field', async () => {
        const result = await run('dict["while": "x"] => $d\n$d.while');
        expect(result).toBe('x');
      });

      it('call form invokes a closure stored under a keyword-named key', async () => {
        const result = await run('dict["error": ||{ "v" }] => $d\n$d.error()');
        expect(result).toBe('v');
      });

      it('use<host:pkg.error> resolves the joined resource via a declared source variable', async () => {
        const src = `use<host:pkg.error>`;
        let capturedResource = '';
        const resolver: SchemeResolver = (resource: string): ResolverResult => {
          capturedResource = resource;
          return { kind: 'value', value: 'resolved' };
        };
        const result = await runWithOptions(src, {
          resolvers: { host: resolver },
        });
        expect(result).toBe('resolved');
        expect(capturedResource).toBe('pkg.error');
      });
    });
  });
});
