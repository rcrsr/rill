/**
 * Rill Runtime Tests: Annotations
 * Tests for statement annotations with ^(key: value) syntax.
 */

import { describe, expect, it } from 'vitest';
import {
  parse,
  ParseError,
  isScriptCallable,
  type ScriptCallable,
} from '../../src/index.js';
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

    it('parses parameter annotations |x ^(min: 0)| (AC-5)', () => {
      const ast = parse('|x: number ^(min: 0)|{ $x }');
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
      // Error case: ^min without parentheses
      const source = '|x ^min|{ $x }';

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
      // Error case: unclosed annotation
      const source = '|x ^(min: 0|{ $x }';

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
      // Uses $ as accumulator (block scoping: variables don't leak)
      const script = `
        ^(limit: 5) 0 -> ($ < 3) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('throws when while loop exceeds limit', async () => {
      // Uses $ as accumulator
      const script = `
        ^(limit: 3) 0 -> ($ < 100) @ { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('includes iteration count in error context when limit exceeded', async () => {
      // Verify AC-13: error context contains limit and iteration count
      const script = `
        ^(limit: 5) 0 -> ($ < 100) @ { $ + 1 }
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
      // Uses $ as accumulator
      const script = `
        0 -> ($ < 100) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('allows for-each loops within limit', async () => {
      const script = `
        ^(limit: 10) [1, 2, 3] -> each { $ }
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('ignores non-positive limit values', async () => {
      // Should use default instead of 0 or negative
      // Uses $ as accumulator
      const script = `
        ^(limit: -5) 0 -> ($ < 100) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('floors fractional limit values', async () => {
      // Uses $ as accumulator
      const script = `
        ^(limit: 3.9) 0 -> ($ < 100) @ { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('preserves limit behavior with multiple annotations (AC-8)', async () => {
      // Multiple annotations should not affect limit enforcement
      const script = `
        ^(limit: 50, meta: "test") 0 -> ($ < 100) @ { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 50 iterations/);
    });
  });

  describe('Annotation Inheritance', () => {
    it('inner annotations override outer', async () => {
      // Inner limit of 2 should take precedence
      // Uses $ as accumulator
      const script = `
        ^(limit: 100) "" -> {
          ^(limit: 2) 0 -> ($ < 10) @ { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 2 iterations/);
    });

    it('inner scope inherits outer annotations', async () => {
      // This test verifies that limit applies in nested scopes
      // Uses $ as accumulator
      const script = `
        ^(limit: 3) "" -> {
          0 -> ($ < 10) @ { $ + 1 }
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
          /Cannot access annotation on string/
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
          /Cannot access annotation on number/
        );
      });

      it('throws error for annotation access on boolean', async () => {
        const script = `
          true => $bool
          $bool.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access annotation on bool/
        );
      });

      it('throws error for annotation access on list', async () => {
        const script = `
          [1, 2, 3] => $list
          $list.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access annotation on list/
        );
      });

      it('throws error for annotation access on dict', async () => {
        const script = `
          [name: "test"] => $dict
          $dict.^key
        `;
        await expect(run(script)).rejects.toThrow(
          /Cannot access annotation on dict/
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
          |x: number ^(min: 0, max: 100)| { $x } => $fn
          $fn.params.x.__annotations.min
        `;
        expect(await run(script)).toBe(0);
      });

      it('accesses multiple parameter annotations via __annotations', async () => {
        const script = `
          |x: number ^(min: 0, max: 100)| { $x } => $fn
          [$fn.params.x.__annotations.min, $fn.params.x.__annotations.max]
        `;
        expect(await run(script)).toEqual([0, 100]);
      });

      it('supports coalescing for missing parameter annotation field', async () => {
        const script = `
          |x: number ^(min: 0)| { $x } => $fn
          $fn.params.x.__annotations.max ?? 100
        `;
        expect(await run(script)).toBe(100);
      });

      it('handles multiple params with different annotations', async () => {
        const script = `
          |x: number ^(min: 0), y: string ^(required: true)| { $x } => $fn
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
          |x: number ^(min: 0, max: 100)| { $x } => $fn
          $fn.params.x.__annotations
        `;
        const result = await run(script);
        expect(result).toEqual({ min: 0, max: 100 });
      });

      it('returns params with mixed annotation presence', async () => {
        const script = `
          |x: number ^(min: 0), y: string| { $x } => $fn
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

    describe('Combined Reflection Operations', () => {
      it('accesses both closure and param annotations', async () => {
        const script = `
          ^(doc: "test function") |x: number ^(min: 0)| { $x } => $fn
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
          |x: number ^(min: 0, max: 100)| { $x } => $fn
          $fn.params.x.__annotations.max - $fn.params.x.__annotations.min
        `;
        expect(await run(script)).toBe(100);
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
        const result = await runFull('|x: number ^(min: 0)|{ $x } => $fn');
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
        const result = await runFull('|x: number ^(min: 0)|{ $x } => $fn');
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']).toBeDefined();
          expect(fn.paramAnnotations['x']!['min']).toBe(0);
        }
      });

      it('captures multiple parameter annotations', async () => {
        const result = await runFull(
          '|x: number ^(min: 0, max: 100)|{ $x } => $fn'
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
          '|x: number ^(min: 0), y: string ^(required: true)|{ $x } => $fn'
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
          '5 => $limit\n|x: number ^(max: $limit * 2)|{ $x } => $fn'
        );
        const fn = result.variables['fn'];

        expect(isScriptCallable(fn)).toBe(true);
        if (isScriptCallable(fn)) {
          expect(fn.paramAnnotations['x']!['max']).toBe(10);
        }
      });

      it('propagates error from parameter annotation evaluation (AC-11, EC-7)', async () => {
        const script = '|x: number ^(min: $undefined)|{ $x }';
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
});
