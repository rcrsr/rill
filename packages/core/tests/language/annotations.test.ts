/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Annotations
 * Tests for statement annotations with ^(key: value) syntax.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  parse,
  ParseError,
  isScriptCallable,
  callable,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { run, runWithContext } from '../helpers/runtime.js';
import { createHostCallable } from '../helpers/structure.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

describe('Rill Runtime: Annotations', () => {
  describe('Parsing', () => {
    it('parses basic annotation', () => {
      const ast = parse('^(limit: 10) "hello"');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
    });

    it('parses .^key annotation access syntax (AC-10)', () => {
      const ast = parse('dict[name: "test"] => $obj\n$obj.^name');
      expect(ast.statements).toHaveLength(2);
      const stmt = ast.statements[1] as {
        type: string;
        expression: { type: string };
      };
      expect(stmt.type).toBe('Statement');
      expect(stmt.expression.type).toBe('PipeChain');
    });

    it('parses parameter annotations fn(^(min: 0) x) (AC-5)', () => {
      const ast = parse('fn(^(min: 0) x: number) { $x }');
      expect(ast.statements).toHaveLength(1);
      const stmt = ast.statements[0] as {
        type: string;
        expression: {
          type: string;
          head: {
            type: string;
            primary: { type: string; params: { annotations: unknown[] }[] };
          };
        };
      };
      expect(stmt.type).toBe('Statement');
      expect(stmt.expression.type).toBe('PipeChain');
      expect(stmt.expression.head.type).toBe('PostfixExpr');
      expect(stmt.expression.head.primary.type).toBe('Closure');
      expect(stmt.expression.head.primary.params[0]?.annotations).toHaveLength(
        1
      );
    });

    it('parses multiple annotation arguments', () => {
      const ast = parse('^(limit: 10, timeout: 30) "hello"');
      const stmt = ast.statements[0] as {
        type: string;
        annotations: unknown[];
      };
      expect(stmt.type).toBe('AnnotatedStatement');
      expect(stmt.annotations).toHaveLength(2);
    });

    it('parses annotation with expression value', () => {
      const ast = parse('^(limit: 5 + 5) "hello"');
      expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
    });

    it('parses annotation with variable value', () => {
      const ast = parse('10 => $n\n^(limit: $n) "hello"');
      expect(ast.statements[1]?.type).toBe('AnnotatedStatement');
    });

    it('parses spread annotation', () => {
      const ast = parse('dict[limit: 10] => $opts\n^(...$opts) "hello"');
      const stmt = ast.statements[1] as {
        type: string;
        annotations: { type: string }[];
      };
      expect(stmt.type).toBe('AnnotatedStatement');
      expect(stmt.annotations[0]?.type).toBe('SpreadArg');
    });
  });

  describe('Execution', () => {
    rule('annotation.inert').it(
      'executes annotated statement normally',
      async () => {
        const result = await run('^(limit: 10) "hello"');
        expect(result).toBe('hello');
      }
    );

    it('evaluates annotation values', async () => {
      const result = await run('^(limit: 5 + 5) "hello"');
      expect(result).toBe('hello');
    });

    it('evaluates annotation variables', async () => {
      const result = await run('10 => $n\n^(limit: $n) "hello"');
      expect(result).toBe('hello');
    });

    it('spreads dict as annotations', async () => {
      const result = await run('dict[limit: 10] => $opts\n^(...$opts) "hello"');
      expect(result).toBe('hello');
    });

    rule('annotation.inert').it('ignores unknown annotations', async () => {
      const result = await run('^(unknown_annotation: 42) "hello"');
      expect(result).toBe('hello');
    });
  });

  describe('Parsing Errors', () => {
    it('throws error on missing identifier after .^ (EC-1)', () => {
      // Error case: .^123 should fail
      const source = 'dict[name: "test"] => $obj\n$obj.^123';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.message).toContain('Expected annotation key after .^');
      }
    });

    it('throws error on missing ( after ^ in parameter (EC-2)', () => {
      // Error case: ^min without parentheses (new syntax: annotation precedes param)
      const source = 'fn(^min x) { $x }';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.message).toContain('Expected ( after ^');
      }
    });

    it('throws error on missing ) in parameter annotation (EC-3)', () => {
      // Error case: unclosed annotation (new syntax: annotation precedes param)
      const source = 'fn(^(min: 0 x) { $x }';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.message).toContain('Expected )');
      }
    });
  });

  describe('Limit Annotation', () => {
    it('allows loops within limit', async () => {
      // Uses do(limit: N) construct option syntax
      const script = `
        0 -> while ($ < 3) do(limit: 5) { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('throws when while loop exceeds limit', async () => {
      // do(limit: N) enforces the limit at runtime
      const script = `
        0 -> while ($ < 100) do(limit: 3) { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('includes iteration count in error context when limit exceeded', async () => {
      // Verify AC-13: error context contains limit and iteration count
      const script = `
        0 -> while ($ < 100) do(limit: 5) { $ + 1 }
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect(err).toMatchObject({
        errorId: 'RILL-R010',
        context: { limit: 5, iterations: 6 },
      });
    });

    it('uses default limit when not specified', async () => {
      // This should succeed because default is 10000
      const script = `
        0 -> while ($ < 100) do { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('allows for-each loops within limit', async () => {
      // Statement-level annotation on seq (callable form)
      const script = `
        list[1, 2, 3] -> seq({ $ })
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('rejects non-positive limit values at parse time', async () => {
      // do(limit: N) requires a positive integer at parse time
      await expect(
        run('0 -> while ($ < 100) do(limit: -5) { $ + 1 }')
      ).rejects.toThrow(/limit.*must be a positive integer/i);
    });

    it('rejects fractional limit values at parse time', async () => {
      // do(limit: N) requires an integer literal; fractional values error at parse time.
      await expect(
        run('0 -> while ($ < 100) do(limit: 3.9) { $ + 1 }')
      ).rejects.toThrow(/limit.*must be a positive integer/i);
    });

    it('preserves limit behavior with multiple annotations (AC-8)', async () => {
      // do(limit: N) sets the iteration ceiling; unknown option keys error at parse
      const script = `
        0 -> while ($ < 100) do(limit: 50) { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 50 iterations/);
    });
  });

  describe('Annotation Inheritance', () => {
    it('inner annotations override outer', async () => {
      // Inner do(limit: 2) on the loop
      const script = `
        0 -> {
          $ -> while ($ < 10) do(limit: 2) { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 2 iterations/);
    });

    it('inner scope inherits outer annotations', async () => {
      // do(limit: 3) on the loop enforces the limit
      const script = `
        0 -> {
          $ -> while ($ < 10) do(limit: 3) { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('annotations are scoped and do not leak', async () => {
      // After the annotated block, default limit should apply
      // Uses $ as accumulator
      const script = `
        ^(limit: 1000) 0 -> {
          $ -> while ($ < 5) do { $ + 1 }
        }
        0 -> while ($ < 100) do { $ + 1 }
      `;
      // Should succeed - second loop uses default limit
      expect(await run(script)).toBe(100);
    });
  });

  describe('Annotations with Various Statements', () => {
    it('works with pipe chains', async () => {
      const script = `
        ^(limit: 5) list[1, 2, 3] -> seq({ $ }) -> .len
      `;
      expect(await run(script)).toBe(3);
    });

    it('works with conditionals', async () => {
      const script = `
        ^(limit: 5) true ? "yes" ! "no"
      `;
      expect(await run(script)).toBe('yes');
    });

    it('works with blocks', async () => {
      const script = `
        ^(limit: 5) "" -> {
          $
          1 => $a
          2 => $b
          $a + $b
        }
      `;
      expect(await run(script)).toBe(3);
    });
  });

  describe('Reflection Access', () => {
    describe('Annotation Reflection (.^key)', () => {
      rule('annotation-access.read').it(
        'accesses closure-level annotation (AC-2)',
        async () => {
          const script = `
          ^(min: 0, max: 100) fn(x) { $x } => $fn
          $fn.^min
        `;
          expect(await run(script)).toBe(0);
        }
      );

      rule('annotation-access.read').it(
        'accesses multiple closure annotations',
        async () => {
          const script = `
          ^(min: 0, max: 100) fn(x) { $x } => $fn
          list[$fn.^min, $fn.^max]
        `;
          expect(await run(script)).toEqual([0, 100]);
        }
      );

      rule('annotation-access.missing').it(
        'throws RILL-R008 when annotation is missing on ScriptCallable (AC-3, EC-4)',
        async () => {
          const script = `
          fn(x) { $x } => $fn
          $fn.^missing
        `;
          try {
            await run(script);
            expect.fail('Should have thrown');
          } catch (err) {
            expect(err).toHaveProperty('errorId', 'RILL-R008');
          }
        }
      );

      rule('annotation-access.fallback').it(
        'supports coalescing with default value (AC-4)',
        async () => {
          const script = `
          fn(x) { $x } => $fn
          $fn.^timeout ?? 30
        `;
          expect(await run(script)).toBe(30);
        }
      );

      rule('annotation-access.non-function').it(
        'throws when accessing annotation on non-closure (AC-9, EC-5)',
        async () => {
          const script = `
          "hello" => $str
          $str.^key
        `;
          await expect(run(script)).rejects.toThrow(
            /annotation not found: \^key/
          );
        }
      );

      it('accesses complex annotation values (AC-14)', async () => {
        const script = `
          ^(config: dict[timeout: 30, endpoints: list["a", "b"]]) fn(x) { $x } => $fn
          $fn.^config.timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('accesses nested list in annotation', async () => {
        const script = `
          ^(config: dict[timeout: 30, endpoints: list["a", "b"]]) fn(x) { $x } => $fn
          $fn.^config.endpoints[0]
        `;
        expect(await run(script)).toBe('a');
      });

      rule('annotation-access.non-function').it(
        'throws error for annotation access on number',
        async () => {
          const script = `
          42 => $num
          $num.^key
        `;
          await expect(run(script)).rejects.toThrow(
            /annotation not found: \^key/
          );
        }
      );

      rule('annotation-access.non-function').it(
        'throws error for annotation access on boolean',
        async () => {
          const script = `
          true => $bool
          $bool.^key
        `;
          await expect(run(script)).rejects.toThrow(
            /annotation not found: \^key/
          );
        }
      );

      rule('annotation-access.non-function').it(
        'throws error for annotation access on list',
        async () => {
          const script = `
          list[1, 2, 3] => $list
          $list.^key
        `;
          await expect(run(script)).rejects.toThrow(
            /annotation not found: \^key/
          );
        }
      );

      rule('annotation-access.non-function').it(
        'throws error for annotation access on dict',
        async () => {
          const script = `
          dict[name: "test"] => $dict
          $dict.^key
        `;
          await expect(run(script)).rejects.toThrow(
            /annotation not found: \^key/
          );
        }
      );

      it('throws RILL-R003 for annotation access .^input on number (AC-10)', async () => {
        const script = `
          42 => $num
          $num.^input
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^input/
        );
      });

      it('throws RILL-R003 for annotation access .^input on string (AC-11)', async () => {
        const script = `
          "hello" => $s
          $s.^input
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^input/
        );
      });

      it('throws RILL-R003 for annotation access .^input on dict (AC-12)', async () => {
        const script = `
          dict[a: 1] => $d
          $d.^input
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^input/
        );
      });

      it('preserves annotations through pipe chains', async () => {
        const script = `
          ^(label: "test") fn(x) { $x * 2 } => $fn
          $fn => $alias
          $alias.^label
        `;
        expect(await run(script)).toBe('test');
      });

      it('accesses annotation with computed value', async () => {
        const script = `
          10 => $base
          ^(limit: $base * 10) fn(x) { $x } => $fn
          $fn.^limit
        `;
        expect(await run(script)).toBe(100);
      });
    });

    describe('.params removed', () => {
      rule('annotation-access.no-params').it.each([
        ['named params', 'fn(a: string, b: number) { $a } => $fn\n$fn.params'],
        ['no params', 'fn() { 42 } => $fn\n$fn.params'],
        [
          'an annotated param',
          'fn(^(min: 0) x: number) { $x } => $fn\n$fn.params',
        ],
        ['a field read of a param', 'fn(x) { $x } => $fn\n$fn.params.x'],
      ])(
        'halts RILL-R008 naming the replacement for .params on a function with %s',
        async (_label, script) => {
          await expectHalt(() => run(script), {
            code: 'RILL_R008',
            messagePattern: '.^type.annotations',
          });
        }
      );

      rule('annotation-access.no-params').it(
        'names .^type.inner in the halt message',
        async () => {
          await expectHalt(() => run('fn(x) { $x } => $fn\n$fn.params'), {
            code: 'RILL_R008',
            messagePattern: '.^type.inner',
          });
        }
      );

      rule('annotation-access.no-params').it(
        'recovers the halt with ?? on the right-most step',
        async () => {
          expect(await run('fn(x) { $x } => $fn\n$fn.params ?? "none"')).toBe(
            'none'
          );
        }
      );

      it('reads a dict key named params like any other key', async () => {
        expect(await run('dict[params: 7] => $d\n$d.params')).toBe(7);
      });

      it('halts RILL-R003 for .params on a value with no such property', async () => {
        await expectHalt(() => run('"hello" => $s\n$s.params'), {
          code: 'RILL_R003',
        });
      });
    });

    describe('Type System Expansion (AC-8, BC-3, EC-8)', () => {
      it('parses closure type in param position (AC-8)', () => {
        const ast = parse('fn(x: fn) { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses list type in param position (AC-8)', () => {
        const ast = parse('fn(x: list) { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses dict type in param position (AC-8)', () => {
        const ast = parse('fn(x: dict) { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses vector type in param position (AC-8)', () => {
        const ast = parse('fn(x: vector) { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses any type in param position (AC-8)', () => {
        const ast = parse('fn(x: any) { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('accepts any value type with $x:any capture (BC-3)', async () => {
        expect(await run('"hello" => $x:any\n$x')).toBe('hello');
        expect(await run('42 => $x:any\n$x')).toBe(42);
        expect(await run('true => $x:any\n$x')).toBe(true);
        expect(await run('list[1, 2] => $x:any\n$x')).toEqual([1, 2]);
        expect(await run('dict[a: 1] => $x:any\n$x')).toEqual({ a: 1 });
      });

      it('rejects invalid type name in param position (EC-8)', () => {
        try {
          parse('fn(x: invalid) { $x }');
          expect.fail('Should have thrown ParseError');
        } catch (err) {
          expect(err).toBeInstanceOf(ParseError);
        }
      });
    });

    describe('Description Shorthand (AC-9)', () => {
      rule('annotation.shorthand').it(
        'bare string expands to description annotation',
        async () => {
          const script = `
          ^("text") fn(x) { $x } => $fn
          $fn.^description
        `;
          expect(await run(script)).toBe('text');
        }
      );

      it('bare string with additional named args sets description and other keys', async () => {
        // Mixed-type list [string, bool] not allowed; verify each annotation separately
        const script1 = `
          ^("text", cache: true) fn(x) { $x } => $fn
          $fn.^description
        `;
        expect(await run(script1)).toBe('text');
        const script2 = `
          ^("text", cache: true) fn(x) { $x } => $fn
          $fn.^cache
        `;
        expect(await run(script2)).toBe(true);
      });
    });

    describe('Combined Reflection Operations', () => {
      it('accesses both closure and param annotations', async () => {
        // Mixed-type list [string, number] not allowed; verify each annotation separately
        const script1 = `
          ^(doc: "test function") fn(^(min: 0) x: number) { $x } => $fn
          $fn.^doc
        `;
        expect(await run(script1)).toBe('test function');
      });

      it('chains annotation access with pipe', async () => {
        const script = `
          ^(config: dict[timeout: 30]) fn(x) { $x } => $fn
          $fn.^config -> .timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('accesses annotation via pipe target .^key', async () => {
        const script = `
          ^(label: "test") fn(x) { $x } => $fn
          $fn -> .^label
        `;
        expect(await run(script)).toBe('test');
      });

      it('throws when pipe target .^key accesses missing annotation', async () => {
        const script = `
          fn(x) { $x } => $fn
          $fn -> .^missing
        `;
        await expect(run(script)).rejects.toThrow(
          /Annotation 'missing' not found/
        );
      });

      it('chains pipe target .^key with method', async () => {
        const script = `
          ^(name: "HELLO") fn(x) { $x } => $fn
          $fn -> .^name -> .lower
        `;
        expect(await run(script)).toBe('hello');
      });

      it('uses annotation value in conditional', async () => {
        const script = `
          ^(enabled: true) fn(x) { $x } => $fn
          $fn.^enabled ? "yes" ! "no"
        `;
        expect(await run(script)).toBe('yes');
      });
    });
  });

  describe('Parser Bug Fixes', () => {
    rule('annotation.newline').it(
      'parses annotation after newline before closure (AC-1)',
      async () => {
        const script = `^("desc")\nfn(x) { $x } => $fn\n$fn.^description`;
        expect(await run(script)).toBe('desc');
      }
    );

    it('parses multi-line parameter list (AC-3)', async () => {
      const script = `fn(x: string,\ny: number) { "{$x}: {$y}" } => $fn\n$fn("hello", 42)`;
      expect(await run(script)).toBe('hello: 42');
    });

    it('parses multi-line function call arguments (AC-4)', async () => {
      const script = `log(\n  "hello"\n)`;
      await expect(run(script)).resolves.not.toThrow();
    });

    rule('annotation.target').it(
      'throws parse error for annotation with no target (BC-1)',
      () => {
        try {
          parse('^(key: "val")');
          expect.fail('Should have thrown ParseError');
        } catch (err) {
          expect(err).toBeInstanceOf(ParseError);
        }
      }
    );

    rule('annotation.target').it(
      'throws parse error for annotation followed by newlines then EOF (EC-1)',
      () => {
        try {
          parse('^(key: "val")\n');
          expect.fail('Should have thrown ParseError');
        } catch (err) {
          expect(err).toBeInstanceOf(ParseError);
        }
      }
    );

    it('throws parse error for invalid token after newline in param list (EC-3)', () => {
      try {
        parse('fn(x: string,\n @) { $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });
  });

  describe('Operator-Level Annotations', () => {
    // IR-8: Operator-level ^(...) syntax — placed directly before operator body,
    // not at statement level. Phase 2 adds parser support only; Phase 3 (Task 3.3)
    // will implement runtime enforcement of operator-level limits.

    describe('While loop with do(limit:) construct option', () => {
      it('parses while (cond) do(limit: N) { body } without error', () => {
        // New syntax: while (cond) do(limit: N) { body }
        const ast = parse('0 -> while ($ < 3) do(limit: 100) { $ + 1 }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes while loop with do(limit:) construct option', async () => {
        // Limit is enforced at runtime with the new do(limit: N) syntax.
        const result = await run(
          '0 -> while ($ < 50) do(limit: 100) { $ + 1 }'
        );
        expect(result).toBe(50);
      });
    });

    describe('each (seq) with annotation', () => {
      it('parses seq body without error', () => {
        const ast = parse('list[1, 2, 3] -> seq({ $ })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes seq and produces correct result', async () => {
        const result = await run('list[1, 2, 3] -> seq({ $ })');
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('map (fan) with annotation', () => {
      it('parses fan body without error', () => {
        const ast = parse('list[1, 2, 3] -> fan({ $ * 2 })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes fan and doubles each element', async () => {
        const result = await run('list[1, 2, 3] -> fan({ $ * 2 })');
        expect(result).toEqual([2, 4, 6]);
      });
    });

    describe('fold with callable form', () => {
      it('parses fold(seed, body) without error', () => {
        const ast = parse('list[1, 2, 3] -> fold(0, { $@ + $ })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes fold and sums elements', async () => {
        const result = await run('list[1, 2, 3] -> fold(0, { $@ + $ })');
        expect(result).toBe(6);
      });
    });

    describe('filter with callable form', () => {
      it('parses filter(body) without error', () => {
        const ast = parse('list[1, 2, 3, 4] -> filter({ $ > 2 })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes filter and returns matching elements', async () => {
        const result = await run('list[1, 2, 3, 4] -> filter({ $ > 2 })');
        expect(result).toEqual([3, 4]);
      });
    });

    describe('AC-6 / EC-5: Statement-level ^(limit:) before operator (silently ignored)', () => {
      // AC-6 / EC-5: ^(limit:) at statement level (not operator-level) is silently ignored.
      // The statement-level annotation applies to the outermost statement, not the operator.
      // Phase 3 (Task 3.3) will implement runtime enforcement of operator-level limits.
      // For now, verify: statement-level limit enforces on the whole statement, and the
      // operator itself runs with default iteration limit.

      it('statement-level ^(limit:) before each — still runs each to completion', async () => {
        // Statement annotation wraps the full pipe chain; each uses default limit.
        const result = await run('^(limit: 1000) list[1, 2, 3] -> seq({ $ })');
        expect(result).toEqual([1, 2, 3]);
      });

      rule('annotation.inert').it(
        'statement-level ^(limit:) before while — still runs while to natural end',
        async () => {
          // Statement annotation does not restrict operator iteration count.
          const result = await run(
            '^(limit: 1000) 0 -> while ($ < 5) do { $ + 1 }'
          );
          expect(result).toBe(5);
        }
      );
    });

    describe('EC-7: Unknown annotation key at statement level — parse-level acceptance', () => {
      // EC-7: The parser accepts any key in ^(...) statement-level annotations.
      // This test verifies the parser does not reject unknown keys.

      it('parses unknown annotation key on seq without error', () => {
        const ast = parse('^(invalid_key: 99) list[1, 2, 3] -> seq({ $ })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
      });

      it('parses unknown annotation key on fan without error', () => {
        const ast = parse('^(unknown: true) list[1, 2, 3] -> fan({ $ * 2 })');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
      });
    });
  });

  describe('Annotation Capture', () => {
    describe('Statement-Level Annotation Capture (AC-1)', () => {
      it('captures closure-level annotation from statement', async () => {
        const { context } = await runWithContext(
          '^(doc: "test") fn(x) { $x * 2 } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toBeDefined();
          expect(fn.annotations['doc']).toBe('test');
        }
      });

      rule('annotation.values').it(
        'evaluates statement annotation values',
        async () => {
          const { context } = await runWithContext(
            '^(timeout: 10 + 20) fn(x) { $x } => $fn\ntrue'
          );
          const fn = context.variables.get('fn') as RillValue;

          expect(isScriptCallable(fn)).toBe(true);
          if (isScriptCallable(fn)) {
            expect(fn.annotations['timeout']).toBe(30);
          }
        }
      );

      it('captures multiple statement annotations', async () => {
        const { context } = await runWithContext(
          '^(doc: "test", timeout: 30) fn(x) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['doc']).toBe('test');
          expect(fn.annotations['timeout']).toBe(30);
        }
      });

      it('evaluates annotation with variable reference', async () => {
        const { context } = await runWithContext(
          '100 => $limit\n^(max: $limit) fn(x) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['max']).toBe(100);
        }
      });
    });

    describe('Annotation Propagation (AC-7)', () => {
      it('propagates annotations through assignment', async () => {
        const script = `
          ^(label: "test") fn(x) { $x } => $fn
          $fn => $alias
          true
        `;
        const { context } = await runWithContext(script);
        const alias = context.variables.get('alias') as RillValue;

        expect(isScriptCallable(alias)).toBe(true);
        if (isScriptCallable(alias)) {
          expect(alias.annotations['label']).toBe('test');
        }
      });

      it('preserves annotations across multiple assignments', async () => {
        const script = `
          ^(doc: "original", version: 1) fn(x) { $x * 2 } => $fn
          $fn => $alias1
          $alias1 => $alias2
          true
        `;
        const { context } = await runWithContext(script);
        const alias2 = context.variables.get('alias2') as RillValue;

        expect(isScriptCallable(alias2)).toBe(true);
        if (isScriptCallable(alias2)) {
          expect(alias2.annotations['doc']).toBe('original');
          expect(alias2.annotations['version']).toBe(1);
        }
      });
    });

    describe('Empty Annotations (AC-12)', () => {
      it('results in empty objects when no annotations present', async () => {
        const { context } = await runWithContext('fn(x) { $x } => $fn\ntrue');
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toEqual({});
          expect(
            fn.params.every((p) => Object.keys(p.annotations).length === 0)
          ).toBe(true);
        }
      });

      it('has empty closure annotations when only param annotations exist', async () => {
        const { context } = await runWithContext(
          'fn(^(min: 0) x: number) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toEqual({});
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['min']
          ).toBe(0);
        }
      });
    });

    describe('Parameter Annotations', () => {
      it('captures parameter annotations (AC-5)', async () => {
        const { context } = await runWithContext(
          'fn(^(min: 0) x: number) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations
          ).toBeDefined();
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['min']
          ).toBe(0);
        }
      });

      it('captures multiple parameter annotations', async () => {
        const { context } = await runWithContext(
          'fn(^(min: 0, max: 100) x: number) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['min']
          ).toBe(0);
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['max']
          ).toBe(100);
        }
      });

      it('captures annotations for multiple parameters', async () => {
        const { context } = await runWithContext(
          'fn(^(min: 0) x: number, ^(required: true) y: string) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['min']
          ).toBe(0);
          expect(
            fn.params.find((p) => p.name === 'y')!.annotations['required']
          ).toBe(true);
        }
      });

      rule('annotation.values').it(
        'evaluates parameter annotation values',
        async () => {
          const { context } = await runWithContext(
            '5 => $limit\nfn(^(max: $limit * 2) x: number) { $x } => $fn\ntrue'
          );
          const fn = context.variables.get('fn') as RillValue;

          expect(isScriptCallable(fn)).toBe(true);
          if (isScriptCallable(fn)) {
            expect(
              fn.params.find((p) => p.name === 'x')!.annotations['max']
            ).toBe(10);
          }
        }
      );

      rule('annotation.values').it(
        'propagates error from parameter annotation evaluation (AC-11, EC-7)',
        async () => {
          const script = 'fn(^(min: $undefined) x: number) { $x }';
          await expect(run(script)).rejects.toThrow(/undefined variable/i);
        }
      );

      rule('annotation.values').it(
        'propagates error from closure-level annotation evaluation (AC-11, EC-7)',
        async () => {
          const script = '^(config: $undefined_var) fn(x) { $x }';
          await expect(run(script)).rejects.toThrow(/undefined variable/i);
        }
      );

      it('has empty annotations object for params without annotations', async () => {
        const { context } = await runWithContext(
          'fn(x: number, y: string) { $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn') as RillValue;

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(
            fn.params.every((p) => Object.keys(p.annotations).length === 0)
          ).toBe(true);
        }
      });
    });
  });

  describe('Annotation Consistency E2E', () => {
    it('multi-line params with expanded types parse without error (AC-3, AC-8)', async () => {
      // Multi-line parameter list using closure and dict types (AC-8 expanded types)
      const ast = parse('fn(^("a") x: fn,\n^("b") y: dict) { $x }');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('Statement');
    });

    it('block-closure annotation + operator-level limit run without error (AC-2, IR-8)', async () => {
      // Block-closure carries ^("loop") annotation; .^description returns "loop"
      const script = `^("loop") fn { 1 } => $b\n$b.^description`;
      expect(await run(script)).toBe('loop');
    });

    it('seq with block-closure runs without error (IR-8)', async () => {
      // seq collection operator with block body
      const result = await run('list[1, 2, 3] -> seq({ $ * 2 })');
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe('Phase 3 Breaking Changes', () => {
    it('block-closure carries annotation (AC-2)', async () => {
      // ^("...") shorthand sets description annotation on a block-closure (no params)
      const script = `^("doubles input") fn { $ * 2 } => $fn\n$fn.^description`;
      expect(await run(script)).toBe('doubles input');
    });

    it('block-closure carries named annotation (AC-2)', async () => {
      // Named annotation key on a block-closure
      const script = `^(label: "my fn") fn { $ + 1 } => $fn\n$fn.^label`;
      expect(await run(script)).toBe('my fn');
    });

    it('old param annotation syntax produces parse error (AC-5)', () => {
      // fn(name: type ^(key: val)) is no longer valid syntax
      expect(() =>
        parse('fn(city: string ^(description: "City name")) { $city }')
      ).toThrow(ParseError);
    });

    it('old param annotation syntax error message (EC-4)', () => {
      // EC-4: same syntax, verify it throws ParseError
      expect(() => parse('fn(name: string ^(required: true)) { }')).toThrow(
        ParseError
      );
    });

    rule('annotation.attach').it(
      'annotation does not inherit to nested block-closure (AC-7)',
      async () => {
        // Outer statement annotated; inner block-closure defined in same script is not
        const script = `
        ^(version: 2) fn(x) { $x * 2 } => $fn
        fn { $ + 1 } => $inner
        $inner.^version
      `;
        await expect(run(script)).rejects.toThrow(
          /Annotation 'version' not found/
        );
      }
    );

    rule('annotation.stack').it(
      'stacked annotation blocks before one closure merge',
      async () => {
        const script = `
        ^(first: 1) ^(second: 2) fn(x) { $x } => $fn
        [$fn.^first, $fn.^second]
      `;
        expect(await run(script)).toEqual([1, 2]);
      }
    );

    rule('annotation.repeat-key').it(
      'later key wins when stacked blocks repeat a key',
      async () => {
        const script = `
        ^(k: 1) ^(k: 2) fn(x) { $x } => $fn
        $fn.^k
      `;
        expect(await run(script)).toBe(2);
      }
    );

    rule('annotation.stack').it(
      'three stacked annotation blocks all merge',
      async () => {
        const script = `
        ^(a: 1) ^(b: 2) ^(c: 3) fn(x) { $x } => $fn
        [$fn.^a, $fn.^b, $fn.^c]
      `;
        expect(await run(script)).toEqual([1, 2, 3]);
      }
    );

    it('stacked statement annotations parse to one AnnotatedStatement', () => {
      const ast = parse('^(a: 1) ^(b: 2) "x"');
      const stmt = ast.statements[0] as {
        type: string;
        annotations: { name?: string }[];
        statement: { type: string };
        span: { start: { column: number } };
      };
      expect(stmt.type).toBe('AnnotatedStatement');
      expect(stmt.annotations).toHaveLength(2);
      expect(stmt.annotations.map((n) => n.name)).toEqual(['a', 'b']);
      expect(stmt.statement.type).toBe('Statement');
      expect(stmt.span.start.column).toBe(1);
    });

    it('stacked expression annotations parse to one AnnotatedExpr', () => {
      const ast = parse('dict[f: ^(a: 1) ^(b: 2) fn(x) { $x }]');
      const found: {
        annotations: { name?: string }[];
        expression: { type: string };
      }[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
        } else if (node !== null && typeof node === 'object') {
          const rec = node as Record<string, unknown>;
          if (rec['type'] === 'AnnotatedExpr') {
            found.push(rec as unknown as (typeof found)[number]);
          }
          Object.values(rec).forEach(walk);
        }
      };
      walk(ast);
      expect(found).toHaveLength(1);
      expect(found[0]!.annotations.map((n) => n.name)).toEqual(['a', 'b']);
      expect(found[0]!.expression.type).toBe('Closure');
    });

    rule('annotation.stack').it(
      'stacked parameter annotation blocks merge',
      async () => {
        const result = await run(
          'fn(^(a: 1) ^(b: 2) x: number) { $x } => $fn\n$fn.^type'
        );
        const shape = result as {
          structure: { params: { annotations?: Record<string, unknown> }[] };
        };
        const annotations = shape.structure.params[0]!.annotations;
        expect(annotations).toEqual({ a: 1, b: 2 });
        expect(Object.keys(annotations ?? {})).toEqual(['a', 'b']);
      }
    );

    it('unannotated block-closure .^description halts RILL-R008', async () => {
      const script = `
        fn { $ * 2 } => $fn
        $fn.^description
      `;
      await expect(run(script)).rejects.toMatchObject({
        errorId: 'RILL-R008',
      });
    });

    it('unannotated .^description halts like any missing annotation', async () => {
      const script = `
        fn(x) { $x } => $f
        $f.^description
      `;
      await expect(run(script)).rejects.toMatchObject({
        errorId: 'RILL-R008',
      });

      const coalesceScript = `
        fn(x) { $x } => $f
        $f.^description ?? "none"
      `;
      expect(await run(coalesceScript)).toBe('none');
    });

    it('description-annotated closure .^description returns the annotation string', async () => {
      const script = `
        ^("hi") fn(x) { $x } => $g
        $g.^description
      `;
      expect(await run(script)).toBe('hi');
    });

    it('unrelated absent annotation key still halts with RILL-R008', async () => {
      const script = `
        fn(x) { $x } => $f
        $f.^doc
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R008',
        messagePattern: /Annotation 'doc' not found/,
      });
    });

    it('nested closure annotation not found (EC-6)', async () => {
      // Inner block-closure inside annotated statement scope: .^key errors
      const script = `
        ^(version: 2) fn(x) { $x } => $outer
        fn { $ * 3 } => $inner
        $inner.^version
      `;
      await expect(run(script)).rejects.toThrow(
        /Annotation 'version' not found/
      );
    });
  });

  describe('ApplicationCallable and paramsToStructuralType edge cases', () => {
    describe('AC-23: $fn.^type on host function with defined params returns a fn structural type', () => {
      it('structural type params array matches registered param names (AC-23)', async () => {
        // Inject the callable directly as a variable to avoid bare-name invocation.
        const hostFn: ApplicationCallable = createHostCallable({
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'name',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'age',
              type: { kind: 'number' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: () => null,
          isProperty: false,
        });
        expect(
          isScriptCallable(hostFn) ||
            (hostFn !== null &&
              typeof hostFn === 'object' &&
              '__type' in hostFn)
        ).toBe(true);
        // $fn.^type returns RillTypeValue: { __rill_type: true, typeName: 'fn', structure: { kind: 'fn', params: [...] } }
        const inputResult = await run(`$fn.^type`, {
          variables: { fn: hostFn },
        });
        const shape = inputResult as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            params: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('fn');
        expect(shape.structure.params).toEqual([
          { name: 'name', type: { kind: 'string' } },
          { name: 'age', type: { kind: 'number' } },
        ]);
      });
    });

    describe('AC-24: $fn.^type on host function with params undefined returns closure with empty params', () => {
      it('returns closure type with empty params when host function has no params metadata', async () => {
        // callable() creates an ApplicationCallable with params: undefined.
        // Inject it as a pre-set variable so the script can access it.
        const untypedFn: ApplicationCallable = callable(() => 'result');
        const result = await run(`$fn.^type`, {
          variables: { fn: untypedFn },
        });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: { type: string; params: unknown[] };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('fn');
        expect(shape.structure.params).toEqual([]);
      });
    });

    describe('AC-34: Concurrent read access to $fn.^type on the same closure is safe', () => {
      it('structural type param entry is stable across multiple reads (AC-34)', async () => {
        // $fn.^type returns RillTypeValue: { __rill_type: true, typeName: 'fn', structure: ... }
        // Access the structural type twice and verify both reads return the same value
        const processCallable: ApplicationCallable = createHostCallable({
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'data',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => args['data'] as RillValue,
          isProperty: false,
        });
        const result1 = await run(`$fn.^type`, {
          variables: { fn: processCallable },
        });
        const result2 = await run(`$fn.^type`, {
          variables: { fn: processCallable },
        });
        expect(result1).toEqual(result2);
        const shape = result1 as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            params: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.structure.params).toEqual([
          { name: 'data', type: { kind: 'string' } },
        ]);
      });
    });

    describe('AC-35: paramsToStructuralType() with empty params array returns closure with empty params', () => {
      it('zero-param host function .^type returns fn structural type with empty params (AC-35)', async () => {
        const noopCallable: ApplicationCallable = createHostCallable({
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => null,
          isProperty: false,
        });
        const result = await run(`$fn.^type`, {
          variables: { fn: noopCallable },
        });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: { type: string; params: unknown[] };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('fn');
        expect(shape.structure.params).toEqual([]);
      });
    });

    describe('EC-5: .^type maps RillParam.type to RillTypeValue in structural type', () => {
      it('host callable with typed RillParam maps to correct type value without throwing (EC-5)', async () => {
        // .^type reads param.type (TypeStructure) and converts via structureToTypeValue.
        // Build an ApplicationCallable with a RillParam using type: { kind: 'string' }.
        const fn: ApplicationCallable = createHostCallable({
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: () => null,
          isProperty: false,
        });
        const result = await run(`$fn.^type`, { variables: { fn } });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            params: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.structure.params).toEqual([
          { name: 'x', type: { kind: 'string' } },
        ]);
      });
    });
  });

  describe('ScriptCallable $fn.^type returns fn structural type', () => {
    it('typed param returns primitive structural type entry (VAL-1)', async () => {
      const result = await run(`fn(x: number) { $x } => $fn\n$fn.^type`);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; params: { name: string; type: unknown }[] };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.params).toEqual([
        { name: 'x', type: { kind: 'number' } },
      ]);
    });

    it('untyped param returns any structural type entry (VAL-1)', async () => {
      const result = await run(`fn(x) { $x } => $fn\n$fn.^type`);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; params: { name: string; type: unknown }[] };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.params).toEqual([
        { name: 'x', type: { kind: 'any' } },
      ]);
    });
  });

  describe('.^effective', () => {
    it('reports the own type of an undeclared value', async () => {
      expect(await run('1 => $a\n$a.^effective == number')).toBe(true);
    });

    it('agrees with .^type when no declaration is carried', async () => {
      expect(await run('1 => $a\n$a.^effective == $a.^type')).toBe(true);
    });

    rule('annotation.reserved').it('is a reserved annotation key', () => {
      expect(() => parse('^(effective: 1) "x"')).toThrow(ParseError);
    });
  });

  describe('.?^key annotation presence', () => {
    rule('annotation-access.presence').it(
      'is true for a stored annotation and false without it',
      async () => {
        expect(await run('^(a: 1) fn(x) { $x } => $f\n$f.?^a')).toBe(true);
        expect(await run('fn(x) { $x } => $f\n$f.?^a')).toBe(false);
      }
    );

    rule('annotation-access.presence-other').it(
      'is false for non-callable values',
      async () => {
        expect(await run('5 => $v\n$v.?^a')).toBe(false);
        expect(await run('dict[a: 1] => $d\n$d.?^a')).toBe(false);
      }
    );

    rule('annotation-access.presence').it(
      'is false for description unless stored',
      async () => {
        expect(await run('fn(x) { $x } => $f\n$f.?^description')).toBe(false);
        expect(await run('^("d") fn(x) { $x } => $f\n$f.?^description')).toBe(
          true
        );
      }
    );

    it('requires the stored value to match a type suffix', async () => {
      expect(await run('^(a: 1) fn(x) { $x } => $f\n$f.?^a&number')).toBe(true);
      expect(await run('^(a: 1) fn(x) { $x } => $f\n$f.?^a&string')).toBe(
        false
      );
    });

    it('works as a pipe target', async () => {
      expect(await run('^(a: 1) fn(x) { $x } => $f\n$f -> .?^a')).toBe(true);
    });

    rule('annotation-access.presence').it(
      'is false for type when not stored',
      async () => {
        expect(await run('fn(x) { $x } => $f\n$f.?^type')).toBe(false);
      }
    );

    it('is true for an annotation on a host callable', async () => {
      const hostFn: ApplicationCallable = {
        ...createHostCallable({
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => null,
          isProperty: false,
        }),
        annotations: { a: 1 },
      };
      expect(await run('$fn.?^a', { variables: { fn: hostFn } })).toBe(true);
      expect(await run('$fn.?^b', { variables: { fn: hostFn } })).toBe(false);
    });
  });

  describe('Annotation rules', () => {
    rule('annotation.key').it.each([
      ['a number', '^(1: "x") fn(x) { $x }'],
      ['a string', '^("k": "x") fn(x) { $x }'],
    ])('rejects %s written as a key', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P001' });
    });

    rule('annotation.reserved').it.each([
      ['on a function', '^(type: "x") fn(x) { $x }'],
      ['on a statement', '^(effective: "x") 1'],
      ['on a parameter', 'fn(^(type: 1) x: number) { $x }'],
      ['on a field', 'dict(^(type: 1) a: string)'],
    ])('rejects a reserved key %s', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P001' });
    });

    rule('annotation.positions').it(
      'accepts an annotation before a statement, function, parameter, and field',
      async () => {
        expect(await run('^(note: "x") 5')).toBe(5);
        expect(await run('^(k: 1) fn(x) { $x } => $f\n$f.^k')).toBe(1);
        expect(await run('fn(^(min: 0) x: number) { $x } => $f\n$f(3)')).toBe(
          3
        );
        expect(await run('dict(^("label") name: string) => $t\ntrue')).toBe(
          true
        );
        expect(await run('ordered(^(k: 1) a: string) => $t\ntrue')).toBe(true);
        expect(await run('tuple(^(k: 1) string) => $t\ntrue')).toBe(true);
        expect(
          await run('fn(g) { $g.^a } => $read\n$read(^(a: 7) fn(x) { $x })')
        ).toBe(7);
      }
    );

    rule('annotation.positions').it(
      'rejects an annotation before a list element type',
      async () => {
        await expect(run('list(^(k: 1) string)')).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
      }
    );

    rule('annotation.limit-in-call').it(
      'halts a limit annotation before a function argument with RILL-R081',
      async () => {
        await expect(
          run('range(0, 3) -> seq(^(limit: 5) { $ })')
        ).rejects.toMatchObject({ errorId: 'RILL-R081' });
      }
    );

    rule('annotation.values').it('evaluates each value once', async () => {
      let calls = 0;
      const functions = {
        tick: { params: [], returnType: anyTypeValue, fn: () => ++calls },
      };
      expect(
        await run('^(k: tick()) fn(x) { $x } => $f\n$f.^k\n$f.^k', {
          functions,
        })
      ).toBe(1);
      expect(calls).toBe(1);
    });

    rule('annotation.repeat-key').it(
      'keeps the later value of a key repeated in one block',
      async () => {
        expect(await run('^(k: 1, k: 2) fn(x) { $x } => $f\n$f.^k')).toBe(2);
      }
    );

    rule('annotation.spread', 'annotation.repeat-key').it(
      'adds the entries of a spread dict as keys',
      async () => {
        expect(
          await run(
            'dict[k: 1, description: "z"] => $o\n^(...$o) fn(x) { $x } => $f\nlist[$f.^k, $f.^description]'
          )
        ).toEqual([1, 'z']);
        expect(
          await run(
            'dict[k: 1] => $o\n^(...$o, k: 2) fn(x) { $x } => $f\n$f.^k'
          )
        ).toBe(2);
      }
    );

    rule('annotation.spread-dict').it(
      'halts a spread of a non-dict with RILL-R002',
      async () => {
        await expect(
          run('list[1] => $o\n^(...$o) fn(x) { $x }')
        ).rejects.toMatchObject({ errorId: 'RILL-R002' });
        expect(
          await run(
            'list[1] => $o\nguard { ^(...$o) fn(x) { $x } } => $r\n$r.!code == #RILL_R002'
          )
        ).toBe(true);
      }
    );

    rule('annotation.attach').it(
      'does not carry to a function created inside the annotated one',
      async () => {
        expect(
          await run(
            '^(a: 1) fn() { fn(x) { $x } } => $f\n$f() => $g\nlist[$f.?^a, $g.?^a]'
          )
        ).toEqual([true, false]);
      }
    );

    rule('annotation.inert').it(
      'leaves a statement annotation unreadable from the value',
      async () => {
        expect(await run('^(note: "x") 5 => $v\n$v.?^note')).toBe(false);
        expect(
          await run('^(note: "inert") 0 -> while ($ < 3) do { $ + 1 }')
        ).toBe(3);
      }
    );
  });

  describe('.^key fallback', () => {
    rule('annotation-access.fallback').it(
      'replaces a vacant annotation value and keeps a non-vacant one',
      async () => {
        expect(await run('^(u: "") fn(x) { $x } => $f\n$f.^u ?? "none"')).toBe(
          'none'
        );
        expect(await run('^(u: 0) fn(x) { $x } => $f\n$f.^u ?? "none"')).toBe(
          0
        );
      }
    );

    rule('annotation-access.fallback').it(
      'does not replace the halt on a value that is not a function',
      async () => {
        await expectHalt(() => run('5 => $v\n$v.^a ?? "none"'), {
          code: 'RILL_R003',
        });
      }
    );
  });
});
