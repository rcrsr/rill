import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parse,
  ParseError,
  TOKEN_TYPES,
  tokenize,
} from '@rcrsr/rill';
import type { ResolverResult, SchemeResolver } from '@rcrsr/rill';

import { run as runWithOptions } from '../helpers/runtime.js';

async function run(code: string) {
  const ctx = createRuntimeContext({});
  const result = await execute(parse(code), ctx);
  return result.result;
}

/** All 12 KEYWORDS-table keyword names (packages/core/src/lexer/operators.ts). */
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

  describe('trailing dot with no field name', () => {
    it('"$x." halts with RILL-P006 located at the dot', () => {
      try {
        parse('$x.');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P006');
        expect(parseErr.location).toEqual({ line: 1, column: 3, offset: 2 });
      }
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

    describe('compound-keyword-prefix names as dotted member access', () => {
      // retry, do, pass, and guard are also compound-keyword prefixes
      // (retry<, do<, pass<, guard{) in COMPOUND_KEYWORD_MAP. readIdentifier()
      // must suppress that compound check when the identifier immediately
      // follows DOT/DOT_QUESTION, so these retype to METHOD_NAME just like
      // the other keyword names.
      const COMPOUND_PREFIX_CASES = [
        { keyword: 'retry', opener: '<' },
        { keyword: 'do', opener: '<' },
        { keyword: 'pass', opener: '<' },
        { keyword: 'guard', opener: '{' },
      ];

      describe('tokenizer retypes the keyword to METHOD_NAME', () => {
        it.each(COMPOUND_PREFIX_CASES)(
          'retypes "$keyword$opener" after a dot to METHOD_NAME',
          ({ keyword, opener }) => {
            const tokens = tokenize(`$d.${keyword}${opener}`);
            const dot = tokens.find((t) => t.type === TOKEN_TYPES.DOT);
            expect(dot).toBeDefined();
            const dotIndex = tokens.indexOf(dot!);
            const next = tokens[dotIndex + 1];
            expect(next?.type).toBe(TOKEN_TYPES.METHOD_NAME);
            expect(next?.value).toBe(keyword);
          }
        );

        it.each(COMPOUND_PREFIX_CASES)(
          'retypes "$keyword$opener" after .? to METHOD_NAME',
          ({ keyword, opener }) => {
            const tokens = tokenize(`$d.?${keyword}${opener}`);
            const dotQuestion = tokens.find(
              (t) => t.type === TOKEN_TYPES.DOT_QUESTION
            );
            expect(dotQuestion).toBeDefined();
            const dotIndex = tokens.indexOf(dotQuestion!);
            const next = tokens[dotIndex + 1];
            expect(next?.type).toBe(TOKEN_TYPES.METHOD_NAME);
            expect(next?.value).toBe(keyword);
          }
        );

        it.each(COMPOUND_PREFIX_CASES)(
          'retypes "$keyword$opener" after a dot and whitespace to METHOD_NAME',
          ({ keyword, opener }) => {
            // The suppression keys off the preceding DOT *token*, not the
            // preceding character, so whitespace after the dot does not
            // resurrect the compound token. This matches the post-tokenize
            // METHOD_NAME rewrite, which is likewise token-based.
            const tokens = tokenize(`$d. ${keyword}${opener}`);
            const dot = tokens.find((t) => t.type === TOKEN_TYPES.DOT);
            expect(dot).toBeDefined();
            const next = tokens[tokens.indexOf(dot!) + 1];
            expect(next?.type).toBe(TOKEN_TYPES.METHOD_NAME);
            expect(next?.value).toBe(keyword);
          }
        );
      });

      describe('the accumulator "$@" does not suppress the compound check', () => {
        // `readVariable` emits DOLLAR for both the `$` that prefixes a name
        // and the self-contained `$@`, so suppressing on token type alone
        // would also suppress after `$@`, where no name follows. That made
        // `$@list[0]` fail with "keyword and bracket must be adjacent;
        // found whitespace" on source containing no whitespace at all.
        it.each(['$@list[0]', '$@dict[a: 1]', '$@ordered[a: 1]'])(
          'parses "%s"',
          (src) => {
            expect(() => parse(src)).not.toThrow();
          }
        );

        it('still suppresses after a plain "$"', () => {
          const tokens = tokenize('$list[0]');
          expect(tokens[1]?.type).toBe(TOKEN_TYPES.IDENTIFIER);
          expect(tokens[1]?.value).toBe('list');
          expect(tokens[2]?.type).toBe(TOKEN_TYPES.LBRACKET);
        });
      });

      describe('spread is unaffected: "..." is an ELLIPSIS token, not a dot', () => {
        // The `...` spread operator ends in `.`, so a character-level
        // "preceded by a dot" test would misread its trailing dot as member
        // access and break spread of a compound-keyword collection. Keyed off
        // the ELLIPSIS token instead, these keep emitting compound tokens.
        it.each([
          { src: 'list[...ordered[a: 1]]', type: TOKEN_TYPES.ORDERED_LBRACKET },
          { src: 'list[...guard{1}]', type: TOKEN_TYPES.GUARD_LBRACE },
        ])('keeps the compound token in "$src"', ({ src, type }) => {
          const tokens = tokenize(src);
          const ellipsis = tokens.find((t) => t.type === TOKEN_TYPES.ELLIPSIS);
          expect(ellipsis).toBeDefined();
          expect(tokens[tokens.indexOf(ellipsis!) + 1]?.type).toBe(type);
        });
      });

      describe('end-to-end evaluation with zero whitespace before the compound opener', () => {
        // These exercise the actual collision: the member name is immediately
        // followed by the same character that opens its compound-keyword form
        // elsewhere in the grammar (retry<, do<, pass<), with no whitespace
        // between them.
        it('parses "$d.retry<10" as a comparison against the "retry" field', async () => {
          const result = await run('dict["retry": 5] => $d\n$d.retry<10');
          expect(result).toBe(true);
        });

        it('parses "$d.do<10" as a comparison against the "do" field', async () => {
          const result = await run('dict["do": 20] => $d\n$d.do<10');
          expect(result).toBe(false);
        });

        it('parses "$d.pass<10" as a comparison against the "pass" field', async () => {
          const result = await run('dict["pass": 5] => $d\n$d.pass<10');
          expect(result).toBe(true);
        });
      });

      describe('"guard" has no zero-whitespace e2e case: "{" starts a new statement', () => {
        // `guard{` cannot be exercised as a single-expression e2e case the way
        // `retry<`, `do<`, and `pass<` are above. `<` continues the current
        // expression (a comparison), but `{` starts a new statement without
        // requiring a newline, so `$d.guard{ 1 }` always parses as two
        // statements: a bare `$d.guard` member access, then a wholly separate
        // (and discarded) `{ 1 }` block-literal statement. There is no
        // zero-whitespace source that both collides with the `guard{`
        // compound-keyword token and evaluates the member access inline the
        // way `$d.retry<10` does. This test asserts that real parse shape
        // directly, then confirms the member access half reads the field.
        it('parses "$d.guard{ 1 }" as a "guard" field access statement followed by a discarded block statement', () => {
          const ast = parse('dict["guard": 5] => $d\n$d.guard{ 1 }');
          expect(ast.statements).toHaveLength(3);

          const memberStatement = ast.statements[1];
          expect(memberStatement?.type).toBe('Statement');
          if (memberStatement?.type === 'Statement') {
            const expr = memberStatement.expression;
            if (expr?.type === 'PipeChain') {
              const head = expr.head;
              if (head?.type === 'PostfixExpr') {
                const variableNode = head.primary;
                expect(variableNode?.type).toBe('Variable');
                if (variableNode?.type === 'Variable') {
                  expect(variableNode.accessChain).toHaveLength(1);
                  expect(variableNode.accessChain[0]).toMatchObject({
                    kind: 'literal',
                    field: 'guard',
                  });
                }
              }
            }
          }

          const blockStatement = ast.statements[2];
          expect(blockStatement?.type).toBe('Statement');
          if (blockStatement?.type === 'Statement') {
            const expr = blockStatement.expression;
            if (expr?.type === 'PipeChain') {
              const head = expr.head;
              if (head?.type === 'PostfixExpr') {
                expect(head.primary?.type).toBe('Block');
              }
            }
          }
        });

        it('reads the "guard" field via "$d.guard" alone, confirming the member-access half of the split', async () => {
          const result = await run('dict["guard": 5] => $d\n$d.guard');
          expect(result).toBe(5);
        });
      });
    });
  });
});
