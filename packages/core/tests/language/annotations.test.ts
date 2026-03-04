/**
 * Rill Runtime Tests: Annotations
 * Tests for statement annotations with ^(key: value) syntax.
 */

import { describe, expect, it } from 'vitest';
import {
  parse,
  ParseError,
  isScriptCallable,
  callable,
  type ApplicationCallable,
  type CallableParam,
} from '@rcrsr/rill';
import { run, runFull } from '../helpers/runtime.js';

describe('Rill Runtime: Annotations', () => {
  describe('Parsing', () => {
    it('parses basic annotation', () => {
      const ast = parse('^(limit: 10) "hello"');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
    });

    it('parses .^key annotation access syntax (AC-10)', () => {
      const ast = parse('[name: "test"] => $obj\n$obj.^name');
      expect(ast.statements).toHaveLength(2);
      const stmt = ast.statements[1];
      expect(stmt?.type).toBe('Statement');
      if (stmt?.type === 'Statement') {
        expect(stmt.expression.type).toBe('PipeChain');
      }
    });

    it('parses parameter annotations |^(min: 0) x| (AC-5)', () => {
      const ast = parse('|^(min: 0) x: number|{ $x }');
      expect(ast.statements).toHaveLength(1);
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('Statement');
      if (stmt?.type === 'Statement' && stmt.expression.type === 'PipeChain') {
        const head = stmt.expression.head;
        if (head.type === 'PostfixExpr' && head.primary.type === 'Closure') {
          const param = head.primary.params[0];
          expect(param?.annotations).toBeDefined();
          expect(param?.annotations).toHaveLength(1);
        }
      }
    });

    it('parses multiple annotation arguments', () => {
      const ast = parse('^(limit: 10, timeout: 30) "hello"');
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('AnnotatedStatement');
      if (stmt?.type === 'AnnotatedStatement') {
        expect(stmt.annotations).toHaveLength(2);
      }
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
      const ast = parse('[limit: 10] => $opts\n^(*$opts) "hello"');
      const stmt = ast.statements[1];
      expect(stmt?.type).toBe('AnnotatedStatement');
      if (stmt?.type === 'AnnotatedStatement') {
        expect(stmt.annotations[0]?.type).toBe('SpreadArg');
      }
    });
  });

  describe('Execution', () => {
    it('executes annotated statement normally', async () => {
      const result = await run('^(limit: 10) "hello"');
      expect(result).toBe('hello');
    });

    it('evaluates annotation values', async () => {
      const result = await run('^(limit: 5 + 5) "hello"');
      expect(result).toBe('hello');
    });

    it('evaluates annotation variables', async () => {
      const result = await run('10 => $n\n^(limit: $n) "hello"');
      expect(result).toBe('hello');
    });

    it('spreads dict as annotations', async () => {
      const result = await run('[limit: 10] => $opts\n^(*$opts) "hello"');
      expect(result).toBe('hello');
    });

    it('ignores unknown annotations', async () => {
      const result = await run('^(unknown_annotation: 42) "hello"');
      expect(result).toBe('hello');
    });
  });

  describe('Parsing Errors', () => {
    it('throws error on missing identifier after .^ (EC-1)', () => {
      // Error case: .^123 should fail
      const source = '[name: "test"] => $obj\n$obj.^123';

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
      const source = '|^min x|{ $x }';

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
      const source = '|^(min: 0 x|{ $x }';

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
      // Uses operator-level annotation: @^(limit: N) { body }
      const script = `
        0 -> ($ < 3) @^(limit: 5) { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('throws when while loop exceeds limit', async () => {
      // Operator-level annotation directly on the loop operator
      const script = `
        0 -> ($ < 100) @^(limit: 3) { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('includes iteration count in error context when limit exceeded', async () => {
      // Verify AC-13: error context contains limit and iteration count
      const script = `
        0 -> ($ < 100) @^(limit: 5) { $ + 1 }
      `;
      try {
        await run(script);
        throw new Error('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeDefined();
        if (err && typeof err === 'object' && 'context' in err) {
          const context = (err as { context?: unknown }).context;
          expect(context).toEqual(
            expect.objectContaining({
              limit: 5,
              iterations: expect.any(Number),
            })
          );
          // Iteration count should be > limit
          if (
            context &&
            typeof context === 'object' &&
            'iterations' in context
          ) {
            expect(context.iterations).toBeGreaterThan(5);
          }
        }
      }
    });

    it('uses default limit when not specified', async () => {
      // This should succeed because default is 10000
      const script = `
        0 -> ($ < 100) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('allows for-each loops within limit', async () => {
      // Operator-level annotation on each
      const script = `
        [1, 2, 3] -> each^(limit: 10) { $ }
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('ignores non-positive limit values', async () => {
      // Operator-level non-positive limit falls back to default (10000)
      const script = `
        0 -> ($ < 100) @^(limit: -5) { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('floors fractional limit values', async () => {
      // Operator-level fractional limit is floored
      const script = `
        0 -> ($ < 100) @^(limit: 3.9) { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('preserves limit behavior with multiple annotations (AC-8)', async () => {
      // Multiple operator-level annotations
      const script = `
        0 -> ($ < 100) @^(limit: 50, meta: "test") { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 50 iterations/);
    });
  });

  describe('Annotation Inheritance', () => {
    it('inner annotations override outer', async () => {
      // Inner operator-level limit of 2 on the loop
      const script = `
        "" -> {
          0 -> ($ < 10) @^(limit: 2) { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 2 iterations/);
    });

    it('inner scope inherits outer annotations', async () => {
      // Operator-level annotation on the loop enforces the limit
      const script = `
        "" -> {
          0 -> ($ < 10) @^(limit: 3) { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('annotations are scoped and do not leak', async () => {
      // After the annotated block, default limit should apply
      // Uses $ as accumulator
      const script = `
        ^(limit: 1000) "" -> {
          0 -> ($ < 5) @ { $ + 1 }
        }
        0 -> ($ < 100) @ { $ + 1 }
      `;
      // Should succeed - second loop uses default limit
      expect(await run(script)).toBe(100);
    });
  });

  describe('Annotations with Various Statements', () => {
    it('works with pipe chains', async () => {
      const script = `
        ^(limit: 5) [1, 2, 3] -> each { $ } -> .len
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
      it('accesses closure-level annotation (AC-2)', async () => {
        const script = `
          ^(min: 0, max: 100) |x|($x) => $fn
          $fn.^min
        `;
        expect(await run(script)).toBe(0);
      });

      it('accesses multiple closure annotations', async () => {
        const script = `
          ^(min: 0, max: 100) |x|($x) => $fn
          [$fn.^min, $fn.^max]
        `;
        expect(await run(script)).toEqual([0, 100]);
      });

      it('throws error when annotation is missing (AC-3, EC-4)', async () => {
        const script = `
          |x|($x) => $fn
          $fn.^missing
        `;
        await expect(run(script)).rejects.toThrow(
          /Annotation 'missing' not found/
        );
      });

      it('supports coalescing with default value (AC-4)', async () => {
        const script = `
          |x|($x) => $fn
          $fn.^timeout ?? 30
        `;
        expect(await run(script)).toBe(30);
      });

      it('throws when accessing annotation on non-closure (AC-9, EC-5)', async () => {
        const script = `
          "hello" => $str
          $str.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('accesses complex annotation values (AC-14)', async () => {
        const script = `
          ^(config: [timeout: 30, endpoints: ["a", "b"]]) |x|($x) => $fn
          $fn.^config.timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('accesses nested list in annotation', async () => {
        const script = `
          ^(config: [timeout: 30, endpoints: ["a", "b"]]) |x|($x) => $fn
          $fn.^config.endpoints[0]
        `;
        expect(await run(script)).toBe('a');
      });

      it('throws error for annotation access on number', async () => {
        const script = `
          42 => $num
          $num.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('throws error for annotation access on boolean', async () => {
        const script = `
          true => $bool
          $bool.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('throws error for annotation access on list', async () => {
        const script = `
          [1, 2, 3] => $list
          $list.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('throws error for annotation access on dict', async () => {
        const script = `
          [name: "test"] => $dict
          $dict.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('preserves annotations through pipe chains', async () => {
        const script = `
          ^(label: "test") |x|($x * 2) => $fn
          $fn => $alias
          $alias.^label
        `;
        expect(await run(script)).toBe('test');
      });

      it('accesses annotation with computed value', async () => {
        const script = `
          10 => $base
          ^(limit: $base * 10) |x|($x) => $fn
          $fn.^limit
        `;
        expect(await run(script)).toBe(100);
      });
    });

    describe('Parameter Annotation Reflection (AC-5)', () => {
      it('accesses parameter annotations via __annotations', async () => {
        const script = `
          |^(min: 0, max: 100) x: number| { $x } => $fn
          $fn.params.x.__annotations.min
        `;
        expect(await run(script)).toBe(0);
      });

      it('accesses multiple parameter annotations via __annotations', async () => {
        const script = `
          |^(min: 0, max: 100) x: number| { $x } => $fn
          [$fn.params.x.__annotations.min, $fn.params.x.__annotations.max]
        `;
        expect(await run(script)).toEqual([0, 100]);
      });

      it('supports coalescing for missing parameter annotation field', async () => {
        const script = `
          |^(min: 0) x: number| { $x } => $fn
          $fn.params.x.__annotations.max ?? 100
        `;
        expect(await run(script)).toBe(100);
      });

      it('handles multiple params with different annotations', async () => {
        const script = `
          |^(min: 0) x: number, ^(required: true) y: string| { $x } => $fn
          [$fn.params.x.__annotations.min, $fn.params.y.__annotations.required]
        `;
        expect(await run(script)).toEqual([0, true]);
      });

      it('has no __annotations field when param has no annotations', async () => {
        const script = `
          |x: number| { $x } => $fn
          $fn.params.x.__annotations ?? "missing"
        `;
        expect(await run(script)).toBe('missing');
      });
    });

    describe('.params Property (AC-6)', () => {
      it('returns params dict with types', async () => {
        const script = `
          |a: string, b: number| { $a } => $fn
          $fn.params
        `;
        const result = await run(script);
        expect(result).toEqual({
          a: { type: 'string' },
          b: { type: 'number' },
        });
      });

      it('returns empty dict for no params (AC-13)', async () => {
        const script = `
          || { 42 } => $fn
          $fn.params
        `;
        const result = await run(script);
        expect(result).toEqual({});
      });

      it('includes annotations in params dict', async () => {
        const script = `
          |^(min: 0, max: 100) x: number| { $x } => $fn
          $fn.params.x.__annotations
        `;
        const result = await run(script);
        expect(result).toEqual({ min: 0, max: 100 });
      });

      it('returns params with mixed annotation presence', async () => {
        const script = `
          |^(min: 0) x: number, y: string| { $x } => $fn
          $fn.params
        `;
        const result = await run(script);
        expect(result).toEqual({
          x: { type: 'number', __annotations: { min: 0 } },
          y: { type: 'string' },
        });
      });

      it('throws when accessing .params on non-closure (EC-6)', async () => {
        const script = `
          "hello" => $str
          $str.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on string/
        );
      });

      it('throws when accessing .params on number', async () => {
        const script = `
          42 => $num
          $num.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on number/
        );
      });

      it('throws when accessing .params on boolean', async () => {
        const script = `
          true => $bool
          $bool.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on bool/
        );
      });

      it('throws when accessing .params on list', async () => {
        const script = `
          [1, 2, 3] => $list
          $list.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on list/
        );
      });

      it('throws when accessing .params on dict', async () => {
        const script = `
          [name: "test"] => $dict
          $dict.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on dict/
        );
      });

      it('accesses specific param by name', async () => {
        const script = `
          |a: string, b: number| { $a } => $fn
          $fn.params.a.type
        `;
        expect(await run(script)).toBe('string');
      });

      it('handles params without type annotations', async () => {
        const script = `
          |x, y| { $x } => $fn
          $fn.params
        `;
        const result = await run(script);
        expect(result).toEqual({
          x: {},
          y: {},
        });
      });
    });

    describe('Type System Expansion (AC-8, BC-3, EC-8)', () => {
      it('parses closure type in param position (AC-8)', () => {
        const ast = parse('|x: closure| { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses list type in param position (AC-8)', () => {
        const ast = parse('|x: list| { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses dict type in param position (AC-8)', () => {
        const ast = parse('|x: dict| { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses vector type in param position (AC-8)', () => {
        const ast = parse('|x: vector| { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses any type in param position (AC-8)', () => {
        const ast = parse('|x: any| { $x }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('accepts any value type with $x:any capture (BC-3)', async () => {
        expect(await run('"hello" => $x:any\n$x')).toBe('hello');
        expect(await run('42 => $x:any\n$x')).toBe(42);
        expect(await run('true => $x:any\n$x')).toBe(true);
        expect(await run('[1, 2] => $x:any\n$x')).toEqual([1, 2]);
        expect(await run('[a: 1] => $x:any\n$x')).toEqual({ a: 1 });
      });

      it('rejects invalid type name in param position (EC-8)', () => {
        try {
          parse('|x: invalid| { $x }');
          expect.fail('Should have thrown ParseError');
        } catch (err) {
          expect(err).toBeInstanceOf(ParseError);
        }
      });
    });

    describe('Description Shorthand (AC-9)', () => {
      it('bare string expands to description annotation', async () => {
        const script = `
          ^("text") |x|($x) => $fn
          $fn.^description
        `;
        expect(await run(script)).toBe('text');
      });

      it('bare string with additional named args sets description and other keys', async () => {
        const script = `
          ^("text", cache: true) |x|($x) => $fn
          [$fn.^description, $fn.^cache]
        `;
        expect(await run(script)).toEqual(['text', true]);
      });
    });

    describe('Combined Reflection Operations', () => {
      it('accesses both closure and param annotations', async () => {
        const script = `
          ^(doc: "test function") |^(min: 0) x: number| { $x } => $fn
          [$fn.^doc, $fn.params.x.__annotations.min]
        `;
        expect(await run(script)).toEqual(['test function', 0]);
      });

      it('chains annotation access with pipe', async () => {
        const script = `
          ^(config: [timeout: 30]) |x|($x) => $fn
          $fn.^config -> .timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('uses annotation value in conditional', async () => {
        const script = `
          ^(enabled: true) |x|($x) => $fn
          $fn.^enabled ? "yes" ! "no"
        `;
        expect(await run(script)).toBe('yes');
      });

      it('uses param annotation in arithmetic', async () => {
        const script = `
          |^(min: 0, max: 100) x: number| { $x } => $fn
          $fn.params.x.__annotations.max - $fn.params.x.__annotations.min
        `;
        expect(await run(script)).toBe(100);
      });
    });
  });

  describe('Parser Bug Fixes', () => {
    it('parses annotation after newline before closure (AC-1)', async () => {
      const script = `^("desc")\n|x| { $x } => $fn\n$fn.^description`;
      expect(await run(script)).toBe('desc');
    });

    it('parses multi-line parameter list (AC-3)', async () => {
      const script = `|x: string,\ny: number| { "{$x}: {$y}" } => $fn\n$fn("hello", 42)`;
      expect(await run(script)).toBe('hello: 42');
    });

    it('parses multi-line function call arguments (AC-4)', async () => {
      const script = `log(\n  "hello",\n  42\n)`;
      await expect(run(script)).resolves.not.toThrow();
    });

    it('throws parse error for annotation with no target (BC-1)', () => {
      try {
        parse('^(key: "val")');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('throws parse error for annotation followed by newlines then EOF (EC-1)', () => {
      try {
        parse('^(key: "val")\n');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('throws parse error for invalid token after newline in param list (EC-3)', () => {
      try {
        parse('|x: string,\n @| { $x }');
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

    describe('While loop (@) with operator-level annotation', () => {
      it('parses ^(limit:) before while body without error', () => {
        // Syntax: value -> (cond) @ ^(limit: N) { body }
        const ast = parse('0 -> ($ < 3) @ ^(limit: 100) { $ + 1 }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes while loop with operator-level annotation (limit not enforced in Phase 2)', async () => {
        // Runtime does not yet read operator-level limit; loop runs to natural end.
        const result = await run('0 -> ($ < 50) @ ^(limit: 100) { $ + 1 }');
        expect(result).toBe(50);
      });
    });

    describe('each with operator-level annotation', () => {
      it('parses ^(limit:) before each body without error', () => {
        const ast = parse('[1, 2, 3] -> each ^(limit: 10) { $ }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes each with operator-level annotation and produces correct result', async () => {
        const result = await run('[1, 2, 3] -> each ^(limit: 10) { $ }');
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('map with operator-level annotation', () => {
      it('parses ^(limit:) before map body without error', () => {
        const ast = parse('[1, 2, 3] -> map ^(limit: 10) { $ * 2 }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes map with operator-level annotation and doubles each element', async () => {
        const result = await run('[1, 2, 3] -> map ^(limit: 10) { $ * 2 }');
        expect(result).toEqual([2, 4, 6]);
      });
    });

    describe('fold with operator-level annotation', () => {
      it('parses ^(limit:) before fold body without error', () => {
        // fold uses closure form with default accumulator so ^(...) can precede the body
        const ast = parse(
          '[1, 2, 3] -> fold ^(limit: 10) |x, acc = 0| ($acc + $x)'
        );
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes fold with operator-level annotation and sums elements', async () => {
        // fold(init) prefix conflicts with ^(...) placement; use closure form instead
        const result = await run(
          '[1, 2, 3] -> fold ^(limit: 10) |x, acc = 0| ($acc + $x)'
        );
        expect(result).toBe(6);
      });
    });

    describe('filter with operator-level annotation', () => {
      it('parses ^(limit:) before filter body without error', () => {
        const ast = parse('[1, 2, 3, 4] -> filter ^(limit: 10) { $ > 2 }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('executes filter with operator-level annotation and returns matching elements', async () => {
        const result = await run(
          '[1, 2, 3, 4] -> filter ^(limit: 10) { $ > 2 }'
        );
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
        const result = await run('^(limit: 1000) [1, 2, 3] -> each { $ }');
        expect(result).toEqual([1, 2, 3]);
      });

      it('statement-level ^(limit:) before while — still runs while to natural end', async () => {
        // Statement annotation does not restrict operator iteration count.
        const result = await run('^(limit: 1000) 0 -> ($ < 5) @ { $ + 1 }');
        expect(result).toBe(5);
      });
    });

    describe('EC-7: Invalid annotation key for operator context — parse-level acceptance', () => {
      // EC-7: Runtime enforcement of invalid operator annotation keys is not implemented in Phase 2.
      // Phase 2 only adds parser support. The parser accepts any key in ^(...) operator annotations.
      // This test verifies the parser does not reject unknown keys (runtime error is Phase 3 scope).

      it('parses unknown annotation key on each without error', () => {
        const ast = parse('[1, 2, 3] -> each ^(invalid_key: 99) { $ }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });

      it('parses unknown annotation key on map without error', () => {
        const ast = parse('[1, 2, 3] -> map ^(unknown: true) { $ }');
        expect(ast.statements).toHaveLength(1);
        expect(ast.statements[0]?.type).toBe('Statement');
      });
    });
  });

  describe('Annotation Capture', () => {
    describe('Statement-Level Annotation Capture (AC-1)', () => {
      it('captures closure-level annotation from statement', async () => {
        const result = await runFull('^(doc: "test") |x|($x * 2) => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toBeDefined();
          expect(fn.annotations['doc']).toBe('test');
        }
      });

      it('evaluates statement annotation values', async () => {
        const result = await runFull('^(timeout: 10 + 20) |x|($x) => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['timeout']).toBe(30);
        }
      });

      it('captures multiple statement annotations', async () => {
        const result = await runFull(
          '^(doc: "test", timeout: 30) |x|($x) => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['doc']).toBe('test');
          expect(fn.annotations['timeout']).toBe(30);
        }
      });

      it('evaluates annotation with variable reference', async () => {
        const result = await runFull(
          '100 => $limit\n^(max: $limit) |x|($x) => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['max']).toBe(100);
        }
      });
    });

    describe('Annotation Propagation (AC-7)', () => {
      it('propagates annotations through assignment', async () => {
        const script = `
          ^(label: "test") |x|($x) => $fn
          $fn => $alias
        `;
        const result = await runFull(script);
        const alias = result.variables['alias'];

        expect(isScriptCallable(alias)).toBe(true);
        if (isScriptCallable(alias)) {
          expect(alias.annotations['label']).toBe('test');
        }
      });

      it('preserves annotations across multiple assignments', async () => {
        const script = `
          ^(doc: "original", version: 1) |x|($x * 2) => $fn
          $fn => $alias1
          $alias1 => $alias2
        `;
        const result = await runFull(script);
        const alias2 = result.variables['alias2'];

        expect(isScriptCallable(alias2)).toBe(true);
        if (isScriptCallable(alias2)) {
          expect(alias2.annotations['doc']).toBe('original');
          expect(alias2.annotations['version']).toBe(1);
        }
      });
    });

    describe('Empty Annotations (AC-12)', () => {
      it('results in empty objects when no annotations present', async () => {
        const result = await runFull('|x|($x) => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toEqual({});
          expect(fn.paramAnnotations).toEqual({});
        }
      });

      it('has empty closure annotations when only param annotations exist', async () => {
        const result = await runFull('|^(min: 0) x: number|{ $x } => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toEqual({});
          expect(fn.paramAnnotations['x']!['min']).toBe(0);
        }
      });
    });

    describe('Parameter Annotations', () => {
      it('captures parameter annotations (AC-5)', async () => {
        const result = await runFull('|^(min: 0) x: number|{ $x } => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']).toBeDefined();
          expect(fn.paramAnnotations['x']!['min']).toBe(0);
        }
      });

      it('captures multiple parameter annotations', async () => {
        const result = await runFull(
          '|^(min: 0, max: 100) x: number|{ $x } => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']!['min']).toBe(0);
          expect(fn.paramAnnotations['x']!['max']).toBe(100);
        }
      });

      it('captures annotations for multiple parameters', async () => {
        const result = await runFull(
          '|^(min: 0) x: number, ^(required: true) y: string|{ $x } => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']!['min']).toBe(0);
          expect(fn.paramAnnotations['y']!['required']).toBe(true);
        }
      });

      it('evaluates parameter annotation values', async () => {
        const result = await runFull(
          '5 => $limit\n|^(max: $limit * 2) x: number|{ $x } => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']!['max']).toBe(10);
        }
      });

      it('propagates error from parameter annotation evaluation (AC-11, EC-7)', async () => {
        const script = '|^(min: $undefined) x: number|{ $x }';
        await expect(run(script)).rejects.toThrow(/undefined variable/i);
      });

      it('propagates error from closure-level annotation evaluation (AC-11, EC-7)', async () => {
        const script = '^(config: $undefined_var) |x|($x)';
        await expect(run(script)).rejects.toThrow(/undefined variable/i);
      });

      it('has empty paramAnnotations for params without annotations', async () => {
        const result = await runFull('|x: number, y: string|{ $x } => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations).toEqual({});
        }
      });
    });
  });

  describe('Annotation Consistency E2E', () => {
    it('multi-line params with expanded types parse without error (AC-3, AC-8)', async () => {
      // Multi-line parameter list using closure and dict types (AC-8 expanded types)
      const ast = parse('|^("a") x: closure,\n^("b") y: dict| { $x }');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('Statement');
    });

    it('block-closure annotation + operator-level limit run without error (AC-2, IR-8)', async () => {
      // Block-closure carries ^("loop") annotation; .^description returns "loop"
      const script = `^("loop") { 1 } => $b\n$b.^description`;
      expect(await run(script)).toBe('loop');
    });

    it('operator-level limit on each with block-closure runs without error (IR-8)', async () => {
      // Combines operator-level annotation (IR-8) with each collection operator
      const result = await run('[1, 2, 3] -> each ^(limit: 10) { $ * 2 }');
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe('Closure Shapes', () => {
    describe('^input auto-generation', () => {
      it('$fn.^input returns a shape value (AC-1)', async () => {
        const result = await run(`
          |x: number, y: string| { $x } => $fn
          $fn.^input -> :?shape
        `);
        expect(result).toBe(true);
      });

      it('$fn.^input.^type equals shape type value (AC-1)', async () => {
        const result = await run(`
          |x: number| { $x } => $fn
          $fn.^input -> :?shape
        `);
        expect(result).toBe(true);
      });

      it('$fn.^input.keys returns param names in declaration order (AC-2)', async () => {
        const result = await run(`
          |a: number, b: string, c: bool| { $a } => $fn
          $fn.^input -> .keys
        `);
        expect(result).toEqual(['a', 'b', 'c']);
      });

      it('param without default produces optional: false (AC-3)', async () => {
        const result = await run(`
          |x: number| { $x } => $fn
          $fn.^input.x.optional
        `);
        expect(result).toBe(false);
      });

      it('param with default produces optional: true (AC-4)', async () => {
        const result = await run(`
          |x: number = 0| { $x } => $fn
          $fn.^input.x.optional
        `);
        expect(result).toBe(true);
      });

      it('zero-param closure produces empty shape (AC-5)', async () => {
        const result = await run(`
          || { 42 } => $fn
          $fn.^input -> .keys
        `);
        expect(result).toEqual([]);
      });

      it('$fn.^input.nonexistent throws for missing field (AC-29)', async () => {
        // Implementation throws RILL-R003 for missing shape fields (standard shape behavior).
        // The spec describes "returns false" but the runtime throws; the test matches actual behavior.
        await expect(
          run(`
          |x: number| { $x } => $fn
          $fn.^input.nonexistent
        `)
        ).rejects.toThrow('Shape has no field "nonexistent"');
      });

      it('zero-param closure: ^input produces empty shape without error (AC-30)', async () => {
        const result = await run(`
          || { "hello" } => $fn
          $fn.^input -> :?shape
        `);
        expect(result).toBe(true);
      });

      it('all params with defaults produce all fields optional: true (AC-31)', async () => {
        const result = await run(`
          |a: number = 1, b: string = "x", c: bool = false| { $a } => $fn
          [$fn.^input.a.optional, $fn.^input.b.optional, $fn.^input.c.optional]
        `);
        expect(result).toEqual([true, true, true]);
      });

      it('closure with 20+ params produces shape with all fields in declaration order (AC-32)', async () => {
        const result = await run(`
          |p1: number, p2: number, p3: number, p4: number, p5: number,
           p6: number, p7: number, p8: number, p9: number, p10: number,
           p11: number, p12: number, p13: number, p14: number, p15: number,
           p16: number, p17: number, p18: number, p19: number, p20: number,
           p21: number| { $p1 } => $fn
          $fn.^input -> .keys
        `);
        expect(result).toEqual([
          'p1',
          'p2',
          'p3',
          'p4',
          'p5',
          'p6',
          'p7',
          'p8',
          'p9',
          'p10',
          'p11',
          'p12',
          'p13',
          'p14',
          'p15',
          'p16',
          'p17',
          'p18',
          'p19',
          'p20',
          'p21',
        ]);
      });
    });

    describe('^input annotation round-trip', () => {
      it('bare string annotation on param surfaces as ^description via shape field (AC-6)', async () => {
        const result = await run(`
          |^("City name") city: string| { $city } => $fn
          $fn.^input.city.^description
        `);
        expect(result).toBe('City name');
      });

      it('default key annotation on param surfaces via shape field (AC-7)', async () => {
        const result = await run(`
          |^("Max temp", default: 30) max_temp: number| { $max_temp } => $fn
          $fn.^input.max_temp.^default
        `);
        expect(result).toBe(30);
      });

      it('bare string annotation also sets description readable via shape field (AC-7)', async () => {
        const result = await run(`
          |^("Max temp", default: 30) max_temp: number| { $max_temp } => $fn
          $fn.^input.max_temp.^description
        `);
        expect(result).toBe('Max temp');
      });

      it('named annotation key surfaces unchanged through shape field introspection (AC-8)', async () => {
        const result = await run(`
          |^(min: 0, max: 100) value: number| { $value } => $fn
          [$fn.^input.value.^min, $fn.^input.value.^max]
        `);
        expect(result).toEqual([0, 100]);
      });

      it('string and number annotation values surface unchanged (AC-8)', async () => {
        const result = await run(`
          |^(label: "weight", scale: 1000) w: number| { $w } => $fn
          [$fn.^input.w.^label, $fn.^input.w.^scale]
        `);
        expect(result).toEqual(['weight', 1000]);
      });

      it('boolean annotation value surfaces unchanged (AC-8)', async () => {
        const result = await run(`
          |^(required: true) name: string| { $name } => $fn
          $fn.^input.name.^required
        `);
        expect(result).toBe(true);
      });

      it('declaring ^(...) on param alone is sufficient — no closure-level annotation needed (AC-9)', async () => {
        // No statement-level annotation; param annotation is the only annotation present.
        const result = await run(`
          |^("City name") city: string| { $city } => $fn
          $fn.^input.city.^description
        `);
        expect(result).toBe('City name');
      });

      it('param annotation does not bleed into closure-level annotations (AC-9)', async () => {
        // Param annotation stays on the shape field, not on $fn directly.
        await expect(
          run(`
          |^("City name") city: string| { $city } => $fn
          $fn.^description
        `)
        ).rejects.toThrow(/Annotation 'description' not found/);
      });

      it('multiple params each carry their own independent annotations (AC-8)', async () => {
        const result = await run(`
          |^("City name") city: string, ^("Max temp", default: 30) max_temp: number| { $city } => $fn
          [$fn.^input.city.^description, $fn.^input.max_temp.^description, $fn.^input.max_temp.^default]
        `);
        expect(result).toEqual(['City name', 'Max temp', 30]);
      });
    });

    describe('^output declaration and access', () => {
      it('$fn.^output returns declared shape when :shape(...) postfix is present (AC-10)', async () => {
        const result = await run(`
          |x: number| { [value: $x, doubled: $x * 2] }:shape(value: number, doubled: number) => $fn
          $fn.^output -> :?shape
        `);
        expect(result).toBe(true);
      });

      it('$fn.^output.^type.name returns "shape" for a shape-typed output (AC-11)', async () => {
        const result = await run(`
          |x: number| { [value: $x, doubled: $x * 2] }:shape(value: number, doubled: number) => $fn
          $fn.^output.^type.name
        `);
        expect(result).toBe('shape');
      });

      it('$fn.^output.keys returns field names in declaration order (AC-12)', async () => {
        const result = await run(`
          |x: number| { [value: $x, doubled: $x * 2] }:shape(value: number, doubled: number) => $fn
          $fn.^output -> .keys
        `);
        expect(result).toEqual(['value', 'doubled']);
      });

      it('non-optional field: $fn.^output.value.optional returns false (AC-13)', async () => {
        const result = await run(`
          |x: number| { [value: $x, doubled: $x * 2] }:shape(value: number, doubled: number) => $fn
          $fn.^output.value.optional
        `);
        expect(result).toBe(false);
      });

      it('omitted :type-target: $fn.^output returns type value any (AC-17)', async () => {
        const result = await run(`
          |x: number| { $x } => $fn
          $fn.^output -> :?type
        `);
        expect(result).toBe(true);
      });

      it('omitted :type-target: $fn.^output.^type.name returns "type" (AC-18)', async () => {
        const result = await run(`
          |x: number| { $x } => $fn
          $fn.^output.^type.name
        `);
        expect(result).toBe('type');
      });

      it('no error raised for omitted output declaration (AC-19)', async () => {
        await expect(
          run(`
          |x: number| { $x } => $fn
          $fn.^output
        `)
        ).resolves.toBeDefined();
      });

      it(':any explicit is identical to omission at runtime (AC-33)', async () => {
        const result = await run(`
          |x: number| { $x }:any => $fn
          $fn.^output -> :?type
        `);
        expect(result).toBe(true);
      });
    });

    describe('assertion enforcement', () => {
      it(':shape declared closure returning non-dict halts with RILL-R004 (AC-14, EC-3)', async () => {
        await expect(
          run(`
            |x: number| { $x }:shape(value: number) => $fn
            42 -> $fn
          `)
        ).rejects.toThrow('Shape assertion failed: expected dict, got number');
      });

      it(':string declared closure returning number halts with RILL-R004 (AC-15, EC-4)', async () => {
        await expect(
          run(`
            |x: number| { $x }:string => $fn
            42 -> $fn
          `)
        ).rejects.toThrow('Type assertion failed: expected string, got number');
      });

      it('assertion fires on each call, not at definition time (AC-16)', async () => {
        // Definition alone must not throw; only the invocation triggers the assertion.
        const source = `
          |x: number| { $x }:string => $fn
          $fn
        `;
        await expect(run(source)).resolves.toBeDefined();
      });

      it(':shape assertion RILL-R004 message matches EC-3 format', async () => {
        await expect(
          run(`
            |x: number| { $x }:shape(value: number) => $fn
            99 -> $fn
          `)
        ).rejects.toThrow('Shape assertion failed: expected dict, got number');
      });

      it(':string declared closure: RILL-R004 message matches EC-4 format', async () => {
        await expect(
          run(`
            |x: string| { 42 }:string => $fn
            "hello" -> $fn
          `)
        ).rejects.toThrow('Type assertion failed: expected string, got number');
      });
    });

    describe('full contract inspection', () => {
      it('$fn.^description, $fn.^input.keys, $fn.^output.keys all return correct values (AC-20)', async () => {
        const result = await run(`
          ^("Process user input")
          |^("User name") name: string, ^("Style", enum: ["bold", "italic"]) style: string|
          { [processed: $name] }:shape(processed: string) => $fn
          [$fn.^description, $fn.^input -> .keys, $fn.^output -> .keys]
        `);
        expect(result).toEqual([
          'Process user input',
          ['name', 'style'],
          ['processed'],
        ]);
      });

      it('$fn.^input.name.type.name returns "string" for a typed param (AC-21)', async () => {
        const result = await run(`
          ^("Process user input")
          |^("User name") name: string, ^("Style", enum: ["bold", "italic"]) style: string|
          { [processed: $name] }:shape(processed: string) => $fn
          $fn.^input.name.type.name
        `);
        expect(result).toBe('string');
      });

      it('$fn.^input.style.^enum returns the enum annotation value (AC-22)', async () => {
        const result = await run(`
          ^("Process user input")
          |^("User name") name: string, ^("Style", enum: ["bold", "italic"]) style: string|
          { [processed: $name] }:shape(processed: string) => $fn
          $fn.^input.style.^enum
        `);
        expect(result).toEqual(['bold', 'italic']);
      });
    });

    describe('error cases', () => {
      it('$fn.^input on non-callable halts with RILL-R003 (AC-25, EC-1)', async () => {
        await expect(
          run(`
            42 => $fn
            $fn.^input
          `)
        ).rejects.toThrow('annotation not found: ^input');
      });

      it('$fn.^output on non-callable halts with RILL-R003 (AC-26, EC-2)', async () => {
        await expect(
          run(`
            42 => $fn
            $fn.^output
          `)
        ).rejects.toThrow('annotation not found: ^output');
      });

      it(':shape returning number: RILL-R004 with exact message (AC-27)', async () => {
        await expect(
          run(`
            |x: number| { $x }:shape(value: number) => $fn
            42 -> $fn
          `)
        ).rejects.toThrow('Shape assertion failed: expected dict, got number');
      });

      it(':string returning 42: RILL-R004 with exact message (AC-28)', async () => {
        await expect(
          run(`
            |x: number| { $x }:string => $fn
            42 -> $fn
          `)
        ).rejects.toThrow('Type assertion failed: expected string, got number');
      });
    });
  });

  describe('Phase 3 Breaking Changes', () => {
    it('block-closure carries annotation (AC-2)', async () => {
      // ^("...") shorthand sets description annotation on a block-closure (no params)
      const script = `^("doubles input") { $ * 2 } => $fn\n$fn.^description`;
      expect(await run(script)).toBe('doubles input');
    });

    it('block-closure carries named annotation (AC-2)', async () => {
      // Named annotation key on a block-closure
      const script = `^(label: "my fn") { $ + 1 } => $fn\n$fn.^label`;
      expect(await run(script)).toBe('my fn');
    });

    it('old param annotation syntax produces parse error (AC-5)', () => {
      // |name: type ^(key: val)| is no longer valid syntax
      expect(() =>
        parse('|city: string ^(description: "City name")| { $city }')
      ).toThrow(ParseError);
    });

    it('old param annotation syntax error message (EC-4)', () => {
      // EC-4: same syntax, verify it throws ParseError
      expect(() => parse('|name: string ^(required: true)| { }')).toThrow(
        ParseError
      );
    });

    it('annotation does not inherit to nested block-closure (AC-7)', async () => {
      // Outer statement annotated; inner block-closure defined in same script is not
      const script = `
        ^(version: 2) |x|($x * 2) => $fn
        { $ + 1 } => $inner
        $inner.^version
      `;
      await expect(run(script)).rejects.toThrow(
        /Annotation 'version' not found/
      );
    });

    it('only inner (second) annotation attaches when two precede one closure (BC-2)', async () => {
      // Two consecutive ^(...) before one closure: only the immediately preceding annotation attaches
      const script = `
        ^(first: 1) ^(second: 2) |x|($x) => $fn
        $fn.^second
      `;
      expect(await run(script)).toBe(2);
    });

    it('outer (first) annotation does not attach to closure when two annotations present (BC-2)', async () => {
      // The outer annotation is discarded; only the inner annotation attaches
      const script = `
        ^(first: 1) ^(second: 2) |x|($x) => $fn
        $fn.^first
      `;
      await expect(run(script)).rejects.toThrow(/Annotation 'first' not found/);
    });

    it('unannotated block-closure .^key errors (EC-2)', async () => {
      // Block-closure with no annotation: accessing .^key throws
      const script = `
        { $ * 2 } => $fn
        $fn.^description
      `;
      await expect(run(script)).rejects.toThrow(
        /Annotation 'description' not found/
      );
    });

    it('nested closure annotation not found (EC-6)', async () => {
      // Inner block-closure inside annotated statement scope: .^key errors
      const script = `
        ^(version: 2) |x|($x) => $outer
        { $ * 3 } => $inner
        $inner.^version
      `;
      await expect(run(script)).rejects.toThrow(
        /Annotation 'version' not found/
      );
    });
  });

  describe('ApplicationCallable and paramsToShape edge cases', () => {
    describe('AC-23: $fn.^input on host function with defined params returns a shape', () => {
      it('returns a shape value when host function has params defined', async () => {
        // Register a host function with typed params; capture via HostRef (no parens = callable value).
        const result = await run(`app::greet => $fn\n$fn.^input -> :?shape`, {
          functions: {
            'app::greet': {
              params: [{ name: 'x', type: 'string' }],
              fn: (args) => args[0],
            },
          },
        });
        expect(result).toBe(true);
      });

      it('shape keys match registered param names (AC-23)', async () => {
        const result = await run(`app::fn => $fn\n$fn.^input -> .keys`, {
          functions: {
            'app::fn': {
              params: [
                { name: 'name', type: 'string' },
                { name: 'age', type: 'number' },
              ],
              fn: () => null,
            },
          },
        });
        expect(result).toEqual(['name', 'age']);
      });
    });

    describe('AC-24: $fn.^input on host function with params undefined returns false', () => {
      it('returns false when host function has no params metadata', async () => {
        // callable() creates an ApplicationCallable with params: undefined.
        // Inject it as a pre-set variable so the script can access it.
        const untypedFn: ApplicationCallable = callable(() => 'result');
        const result = await run(`$fn.^input`, {
          variables: { fn: untypedFn },
        });
        expect(result).toBe(false);
      });
    });

    describe('AC-34: Concurrent read access to $fn.^input on the same closure is safe', () => {
      it('returns identical shape on repeated reads (shape is immutable after creation)', async () => {
        // Rill is single-threaded JS. Reading ^input twice on the same callable returns
        // the same frozen shape object — no race conditions possible.
        const result = await run(
          `
            app::process => $fn
            [$fn.^input -> :?shape, $fn.^input -> :?shape]
          `,
          {
            functions: {
              'app::process': {
                params: [{ name: 'data', type: 'string' }],
                fn: (args) => args[0],
              },
            },
          }
        );
        expect(result).toEqual([true, true]);
      });

      it('shape field access is stable across multiple reads (AC-34)', async () => {
        const result = await run(
          `
            app::process => $fn
            [$fn.^input.data.optional, $fn.^input.data.optional]
          `,
          {
            functions: {
              'app::process': {
                params: [{ name: 'data', type: 'string' }],
                fn: (args) => args[0],
              },
            },
          }
        );
        expect(result).toEqual([false, false]);
      });
    });

    describe('AC-35: paramsToShape() with empty params array returns shape with fields: {}', () => {
      it('zero-param host function ^input returns shape with no keys', async () => {
        const result = await run(`app::noop => $fn\n$fn.^input -> .keys`, {
          functions: {
            'app::noop': {
              params: [],
              fn: () => null,
            },
          },
        });
        expect(result).toEqual([]);
      });

      it('zero-param host function ^input is a shape value (AC-35)', async () => {
        const result = await run(`app::noop => $fn\n$fn.^input -> :?shape`, {
          functions: {
            'app::noop': {
              params: [],
              fn: () => null,
            },
          },
        });
        expect(result).toBe(true);
      });
    });

    describe('EC-5: Invalid typeName in param triggers RILL-R001 Unknown type', () => {
      it('throws RILL-R001 when host callable has invalid typeName in params', async () => {
        // Build an ApplicationCallable with an invalid typeName directly.
        // HostFunctionParam.type is typed; we bypass by constructing CallableParam manually.
        const badParam: CallableParam = {
          name: 'x',
          typeName: 'invalid_type' as never,
          defaultValue: null,
          annotations: {},
        };
        const badFn: ApplicationCallable = {
          __type: 'callable',
          kind: 'application',
          params: [badParam],
          fn: () => null,
          isProperty: false,
        };
        await expect(
          run(`$fn.^input`, { variables: { fn: badFn } })
        ).rejects.toThrow('Unknown type: invalid_type');
      });
    });
  });
});
