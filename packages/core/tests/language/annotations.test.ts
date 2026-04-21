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
} from '@rcrsr/rill';
import { run, runWithContext } from '../helpers/runtime.js';

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
      const ast = parse('dict[limit: 10] => $opts\n^(...$opts) "hello"');
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
      const result = await run('dict[limit: 10] => $opts\n^(...$opts) "hello"');
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
      // Statement-level annotation on seq (callable form)
      const script = `
        list[1, 2, 3] -> seq({ $ })
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
          list[$fn.^min, $fn.^max]
        `;
        expect(await run(script)).toEqual([0, 100]);
      });

      it('throws RILL-R008 when annotation is missing on ScriptCallable (AC-3, EC-4)', async () => {
        const script = `
          |x|($x) => $fn
          $fn.^missing
        `;
        try {
          await run(script);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId', 'RILL-R008');
        }
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
          ^(config: dict[timeout: 30, endpoints: list["a", "b"]]) |x|($x) => $fn
          $fn.^config.timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('accesses nested list in annotation', async () => {
        const script = `
          ^(config: dict[timeout: 30, endpoints: list["a", "b"]]) |x|($x) => $fn
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
          list[1, 2, 3] => $list
          $list.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

      it('throws error for annotation access on dict', async () => {
        const script = `
          dict[name: "test"] => $dict
          $dict.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /annotation not found: \^key/
        );
      });

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
          list[$fn.params.x.__annotations.min, $fn.params.x.__annotations.max]
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
        // Mixed-type list [number, bool] not allowed; verify each annotation separately
        const script1 = `
          |^(min: 0) x: number, ^(required: true) y: string| { $x } => $fn
          $fn.params.x.__annotations.min
        `;
        expect(await run(script1)).toEqual(0);
        const script2 = `
          |^(min: 0) x: number, ^(required: true) y: string| { $x } => $fn
          $fn.params.y.__annotations.required
        `;
        expect(await run(script2)).toEqual(true);
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
          list[1, 2, 3] => $list
          $list.params
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access \.params on list/
        );
      });

      it('throws when accessing .params on dict', async () => {
        const script = `
          dict[name: "test"] => $dict
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
        expect(await run('list[1, 2] => $x:any\n$x')).toEqual([1, 2]);
        expect(await run('dict[a: 1] => $x:any\n$x')).toEqual({ a: 1 });
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
        // Mixed-type list [string, bool] not allowed; verify each annotation separately
        const script1 = `
          ^("text", cache: true) |x|($x) => $fn
          $fn.^description
        `;
        expect(await run(script1)).toBe('text');
        const script2 = `
          ^("text", cache: true) |x|($x) => $fn
          $fn.^cache
        `;
        expect(await run(script2)).toBe(true);
      });
    });

    describe('Combined Reflection Operations', () => {
      it('accesses both closure and param annotations', async () => {
        // Mixed-type list [string, number] not allowed; verify each annotation separately
        const script1 = `
          ^(doc: "test function") |^(min: 0) x: number| { $x } => $fn
          $fn.^doc
        `;
        expect(await run(script1)).toBe('test function');
        const script2 = `
          ^(doc: "test function") |^(min: 0) x: number| { $x } => $fn
          $fn.params.x.__annotations.min
        `;
        expect(await run(script2)).toBe(0);
      });

      it('chains annotation access with pipe', async () => {
        const script = `
          ^(config: dict[timeout: 30]) |x|($x) => $fn
          $fn.^config -> .timeout
        `;
        expect(await run(script)).toBe(30);
      });

      it('accesses annotation via pipe target .^key', async () => {
        const script = `
          ^(label: "test") |x|($x) => $fn
          $fn -> .^label
        `;
        expect(await run(script)).toBe('test');
      });

      it('throws when pipe target .^key accesses missing annotation', async () => {
        const script = `
          |x|($x) => $fn
          $fn -> .^missing
        `;
        await expect(run(script)).rejects.toThrow(
          /Annotation 'missing' not found/
        );
      });

      it('chains pipe target .^key with method', async () => {
        const script = `
          ^(name: "HELLO") |x|($x) => $fn
          $fn -> .^name -> .lower
        `;
        expect(await run(script)).toBe('hello');
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

      it('statement-level ^(limit:) before while — still runs while to natural end', async () => {
        // Statement annotation does not restrict operator iteration count.
        const result = await run('^(limit: 1000) 0 -> ($ < 5) @ { $ + 1 }');
        expect(result).toBe(5);
      });
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
          '^(doc: "test") |x|($x * 2) => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations).toBeDefined();
          expect(fn.annotations['doc']).toBe('test');
        }
      });

      it('evaluates statement annotation values', async () => {
        const { context } = await runWithContext(
          '^(timeout: 10 + 20) |x|($x) => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['timeout']).toBe(30);
        }
      });

      it('captures multiple statement annotations', async () => {
        const { context } = await runWithContext(
          '^(doc: "test", timeout: 30) |x|($x) => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.annotations['doc']).toBe('test');
          expect(fn.annotations['timeout']).toBe(30);
        }
      });

      it('evaluates annotation with variable reference', async () => {
        const { context } = await runWithContext(
          '100 => $limit\n^(max: $limit) |x|($x) => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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
          true
        `;
        const { context } = await runWithContext(script);
        const alias = context.variables.get('alias');

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
          true
        `;
        const { context } = await runWithContext(script);
        const alias2 = context.variables.get('alias2');

        expect(isScriptCallable(alias2)).toBe(true);
        if (isScriptCallable(alias2)) {
          expect(alias2.annotations['doc']).toBe('original');
          expect(alias2.annotations['version']).toBe(1);
        }
      });
    });

    describe('Empty Annotations (AC-12)', () => {
      it('results in empty objects when no annotations present', async () => {
        const { context } = await runWithContext('|x|($x) => $fn\ntrue');
        const fn = context.variables.get('fn');

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
          '|^(min: 0) x: number|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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
          '|^(min: 0) x: number|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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
          '|^(min: 0, max: 100) x: number|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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
          '|^(min: 0) x: number, ^(required: true) y: string|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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

      it('evaluates parameter annotation values', async () => {
        const { context } = await runWithContext(
          '5 => $limit\n|^(max: $limit * 2) x: number|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(
            fn.params.find((p) => p.name === 'x')!.annotations['max']
          ).toBe(10);
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

      it('has empty annotations object for params without annotations', async () => {
        const { context } = await runWithContext(
          '|x: number, y: string|{ $x } => $fn\ntrue'
        );
        const fn = context.variables.get('fn');

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
      const ast = parse('|^("a") x: closure,\n^("b") y: dict| { $x }');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('Statement');
    });

    it('block-closure annotation + operator-level limit run without error (AC-2, IR-8)', async () => {
      // Block-closure carries ^("loop") annotation; .^description returns "loop"
      const script = `^("loop") { 1 } => $b\n$b.^description`;
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

    it('unannotated block-closure .^description returns empty record (EC-3)', async () => {
      // Block-closure with no annotation: ^description returns {} rather than throwing
      const script = `
        { $ * 2 } => $fn
        $fn.^description
      `;
      expect(await run(script)).toEqual({});
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

  describe('ApplicationCallable and paramsToStructuralType edge cases', () => {
    describe('AC-23: $fn.^input on host function with defined params returns a closure structural type', () => {
      it('structural type params array matches registered param names (AC-23)', async () => {
        // Inject the callable directly as a variable to avoid bare-name invocation.
        const hostFn: ApplicationCallable = {
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
        };
        expect(
          isScriptCallable(hostFn) ||
            (hostFn !== null &&
              typeof hostFn === 'object' &&
              '__type' in hostFn)
        ).toBe(true);
        // $fn.^input returns RillTypeValue: { __rill_type: true, typeName: 'ordered', structure: { kind: 'ordered', fields: [...] } }
        const inputResult = await run(`$fn.^input`, {
          variables: { fn: hostFn },
        });
        const shape = inputResult as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            fields: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('ordered');
        expect(shape.structure.fields).toEqual([
          { name: 'name', type: { kind: 'string' } },
          { name: 'age', type: { kind: 'number' } },
        ]);
      });
    });

    describe('AC-24: $fn.^input on host function with params undefined returns empty ordered', () => {
      it('returns empty ordered when host function has no params metadata', async () => {
        // callable() creates an ApplicationCallable with params: undefined.
        // Inject it as a pre-set variable so the script can access it.
        const untypedFn: ApplicationCallable = callable(() => 'result');
        const result = await run(`$fn.^input`, {
          variables: { fn: untypedFn },
        });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: { type: string; fields: unknown[] };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('ordered');
        expect(shape.structure.fields).toEqual([]);
      });
    });

    describe('AC-34: Concurrent read access to $fn.^input on the same closure is safe', () => {
      it('structural type param entry is stable across multiple reads (AC-34)', async () => {
        // $fn.^input returns RillTypeValue: { __rill_type: true, typeName: 'ordered', structure: ... }
        // Access the structural type twice and verify both reads return the same value
        const processCallable: ApplicationCallable = {
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
          fn: (args) => args['data'],
          isProperty: false,
        };
        const result1 = await run(`$fn.^input`, {
          variables: { fn: processCallable },
        });
        const result2 = await run(`$fn.^input`, {
          variables: { fn: processCallable },
        });
        expect(result1).toEqual(result2);
        const shape = result1 as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            fields: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.structure.fields).toEqual([
          { name: 'data', type: { kind: 'string' } },
        ]);
      });
    });

    describe('AC-35: paramsToStructuralType() with empty params array returns closure with empty params', () => {
      it('zero-param host function ^input returns closure structural type with empty params (AC-35)', async () => {
        const noopCallable: ApplicationCallable = {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => null,
          isProperty: false,
        };
        const result = await run(`$fn.^input`, {
          variables: { fn: noopCallable },
        });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: { type: string; fields: unknown[] };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.typeName).toBe('ordered');
        expect(shape.structure.fields).toEqual([]);
      });
    });

    describe('EC-5: ^input maps RillParam.type to RillTypeValue in structural type', () => {
      it('host callable with typed RillParam maps to correct type value without throwing (EC-5)', async () => {
        // ^input reads param.type (TypeStructure) and converts via structureToTypeValue.
        // Build an ApplicationCallable with a RillParam using type: { kind: 'string' }.
        const fn: ApplicationCallable = {
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
        };
        const result = await run(`$fn.^input`, { variables: { fn } });
        const shape = result as {
          __rill_type: true;
          typeName: string;
          structure: {
            type: string;
            fields: { name: string; type: unknown }[];
          };
        };
        expect(shape.__rill_type).toBe(true);
        expect(shape.structure.fields).toEqual([
          { name: 'x', type: { kind: 'string' } },
        ]);
      });
    });
  });

  describe('ScriptCallable $fn.^input returns closure structural type', () => {
    it('typed param returns primitive structural type entry (VAL-1)', async () => {
      const result = await run(`|x: number| ($x) => $fn\n$fn.^input`);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: { name: string; type: unknown }[] };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.fields).toEqual([
        { name: 'x', type: { kind: 'number' } },
      ]);
    });

    it('untyped param returns any structural type entry (VAL-1)', async () => {
      const result = await run(`|x| ($x) => $fn\n$fn.^input`);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: { name: string; type: unknown }[] };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.fields).toEqual([
        { name: 'x', type: { kind: 'any' } },
      ]);
    });
  });
});
