/**
 * Tests for AnnotationsMixin
 *
 * Tests the annotation handling methods in isolation and error contracts:
 * - EC-25: Annotated statement execution errors propagate
 * - EC-26: Annotation evaluation errors propagate
 */

import { describe, it, expect } from 'vitest';
import { EvaluatorBase } from '../../src/runtime/core/eval/base.js';
import { AnnotationsMixin } from '../../src/runtime/core/eval/mixins/annotations.js';
import { createRuntimeContext } from '../../src/runtime/index.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../src/types.js';
import type { StatementNode, AnnotatedStatementNode } from '../../src/types.js';
import { run } from '../helpers/runtime.js';

describe('AnnotationsMixin', () => {
  describe('getAnnotation', () => {
    it('retrieves annotation value from stack', () => {
      const ctx = createRuntimeContext();
      ctx.annotationStack.push({ limit: 100, custom: 'value' });

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getAnnotation('limit')).toBe(100);
      expect(evaluator.getAnnotation('custom')).toBe('value');
      expect(evaluator.getAnnotation('missing')).toBeUndefined();
    });

    it('returns undefined when annotation stack is empty', () => {
      const ctx = createRuntimeContext();

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getAnnotation('limit')).toBeUndefined();
    });

    it('returns value from top of stack when multiple scopes exist', () => {
      const ctx = createRuntimeContext();
      ctx.annotationStack.push({ limit: 100 });
      ctx.annotationStack.push({ limit: 50 });

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getAnnotation('limit')).toBe(50);
    });
  });

  describe('getIterationLimit', () => {
    it('returns annotation limit when set', () => {
      const ctx = createRuntimeContext();
      ctx.annotationStack.push({ limit: 100 });

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getIterationLimit()).toBe(100);
    });

    it('returns default when limit not set', () => {
      const ctx = createRuntimeContext();

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getIterationLimit()).toBe(10000);
    });

    it('floors fractional limits', () => {
      const ctx = createRuntimeContext();
      ctx.annotationStack.push({ limit: 100.7 });

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getIterationLimit()).toBe(100);
    });

    it('returns default for non-positive limits', () => {
      const ctx = createRuntimeContext();

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      ctx.annotationStack.push({ limit: 0 });
      expect(evaluator.getIterationLimit()).toBe(10000);

      ctx.annotationStack.pop();
      ctx.annotationStack.push({ limit: -5 });
      expect(evaluator.getIterationLimit()).toBe(10000);
    });

    it('returns default for non-numeric limits', () => {
      const ctx = createRuntimeContext();
      ctx.annotationStack.push({ limit: 'not a number' });

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      expect(evaluator.getIterationLimit()).toBe(10000);
    });
  });

  describe('executeStatement', () => {
    it('throws error when evaluateExpression is not available', async () => {
      const ctx = createRuntimeContext();
      const stmt: StatementNode = {
        type: 'Statement',
        expression: {
          type: 'PipeChain',
          head: {
            type: 'PostfixExpr',
            primary: {
              type: 'NumberLiteral',
              value: 42,
              span: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 3, offset: 2 },
              },
            },
            methods: [],
            span: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 3, offset: 2 },
            },
          },
          pipes: [],
          terminator: null,
          span: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 3, offset: 2 },
          },
        },
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 3, offset: 2 },
        },
      };

      class TestEvaluator extends AnnotationsMixin(EvaluatorBase) {}
      const evaluator = new TestEvaluator(ctx);

      // Should fail because evaluateExpression is not implemented (requires CoreMixin)
      await expect(evaluator.executeStatement(stmt)).rejects.toThrow();
    });
  });

  describe('EC-25: Annotated statement execution errors propagate', () => {
    it('propagates errors from inner statement execution', async () => {
      // When the annotated statement throws, error should propagate
      await expect(run('^(limit: 100) $undefined')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('propagates errors during loop execution within annotation', async () => {
      // Error during loop should propagate through annotation
      await expect(
        run('^(limit: 10) [1, 2, 3] -> each { error("boom") }', {
          functions: {
            error: {
              params: [{ name: 'msg', type: 'string' }],
              fn: (args) => {
                throw new RuntimeError(
                  RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                  String(args[0]),
                  { line: 1, column: 1, offset: 0 }
                );
              },
            },
          },
        })
      ).rejects.toThrow(/boom/);
    });

    it('propagates type errors from annotated expressions', async () => {
      // Type error in annotated statement should propagate
      await expect(run('^(limit: 50) ("string" + 5)')).rejects.toThrow(
        /Arithmetic requires number/
      );
    });

    it('propagates runtime errors during pipe chain in annotated statement', async () => {
      await expect(
        run('^(limit: 100) "test" -> fail()', {
          functions: {
            fail: {
              params: [],
              fn: () => {
                throw new RuntimeError(
                  RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                  'Function failed',
                  { line: 1, column: 1, offset: 0 }
                );
              },
            },
          },
        })
      ).rejects.toThrow(/Function failed/);
    });

    it('propagates errors from nested annotated statements', async () => {
      // Nested annotations with error
      await expect(
        run('^(limit: 100) { ^(limit: 50) $missing }')
      ).rejects.toThrow(/Undefined variable/);
    });

    it('maintains error location when propagating', async () => {
      try {
        await run('^(limit: 100) undefined_function()');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
        expect(runtimeErr.location).toBeDefined();
      }
    });

    it('cleans up annotation stack on error', async () => {
      // After an error in annotated statement, stack should be cleaned up
      try {
        await run('^(limit: 50) { throw_error() }', {
          functions: {
            throw_error: () => {
              throw new Error('Test error');
            },
          },
        });
      } catch {
        // Expected to throw
      }

      // Subsequent execution should work normally
      const result = await run('^(limit: 100) "success"');
      expect(result).toBe('success');
    });
  });

  describe('EC-26: Annotation evaluation errors propagate', () => {
    it('propagates errors when annotation value evaluation fails', async () => {
      // Reference to undefined variable in annotation
      await expect(run('^(limit: $undefined) "hello"')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('propagates errors from computed annotation expressions', async () => {
      // Arithmetic error in annotation
      await expect(run('^(limit: "string" + 5) "hello"')).rejects.toThrow(
        /Arithmetic requires number/
      );
    });

    it('propagates errors from function calls in annotations', async () => {
      await expect(
        run('^(limit: fail()) "hello"', {
          functions: {
            fail: {
              params: [],
              fn: () => {
                throw new RuntimeError(
                  RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                  'Annotation function failed',
                  { line: 1, column: 1, offset: 0 }
                );
              },
            },
          },
        })
      ).rejects.toThrow(/Annotation function failed/);
    });

    it('throws error for invalid spread annotation type (list)', async () => {
      // Spreading a list as annotations should fail
      await expect(
        run('[1, 2, 3] :> $list\n^(*$list) "hello"')
      ).rejects.toThrow(/requires dict/);
    });

    it('throws error for invalid spread annotation type (primitive)', async () => {
      // Spreading a non-dict primitive should fail
      await expect(run('^(*"string") "hello"')).rejects.toThrow(
        /requires dict/
      );

      await expect(run('^(*42) "hello"')).rejects.toThrow(/requires dict/);

      await expect(run('^(*true) "hello"')).rejects.toThrow(/requires dict/);
    });

    it('propagates errors from spread dict evaluation', async () => {
      // Error when evaluating the spread expression
      await expect(run('^(*$missing) "hello"')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('maintains error location from annotation evaluation', async () => {
      try {
        await run('^(limit: missing_fn()) "hello"');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
        expect(runtimeErr.location).toBeDefined();
      }
    });

    it('handles multiple annotation errors correctly', async () => {
      // First annotation that would error
      await expect(
        run('^(limit: $missing, timeout: 30) "hello"')
      ).rejects.toThrow(/Undefined variable/);
    });

    it('validates spread annotation contains dict', async () => {
      // Create a dict and spread it (should work)
      const result = await run('[limit: 100] :> $opts\n^(*$opts) "hello"');
      expect(result).toBe('hello');

      // But list spread should fail
      await expect(
        run('[100, 200] :> $opts\n^(*$opts) "hello"')
      ).rejects.toThrow(/requires dict with named keys/);
    });
  });
});
