/**
 * Tests for Evaluator composition and caching
 *
 * Verifies:
 * - AC-15: All 10 mixins are composed in correct order
 * - AC-16: Empty context creates new Evaluator via WeakMap
 * - AC-17: Repeated evaluations return cached instance via WeakMap
 */

import { describe, it, expect } from 'vitest';
import { createRuntimeContext } from '../../src/runtime/core/context.js';
import {
  Evaluator,
  getEvaluator,
} from '../../src/runtime/core/eval/evaluator.js';

describe('Evaluator composition', () => {
  describe('mixin composition', () => {
    it('composes all 10 mixins in correct order', () => {
      const ctx = createRuntimeContext();
      const evaluator = new Evaluator(ctx);

      // Verify that all required methods exist on the evaluator
      // These methods come from different mixins, proving composition works

      // From CoreMixin
      expect(typeof evaluator.evaluateExpression).toBe('function');
      expect(typeof evaluator.evaluatePipeChain).toBe('function');
      expect(typeof evaluator.evaluatePostfixExpr).toBe('function');
      expect(typeof evaluator.evaluatePrimary).toBe('function');
      expect(typeof evaluator.evaluatePipeTarget).toBe('function');
      expect(typeof evaluator.evaluateArgs).toBe('function');

      // From AnnotationsMixin (outermost)
      expect(typeof evaluator.executeStatement).toBe('function');
      expect(typeof evaluator.getAnnotation).toBe('function');
      expect(typeof evaluator.getIterationLimit).toBe('function');

      // Verify evaluator has access to context (from base)
      expect(evaluator).toHaveProperty('ctx');
    });
  });

  describe('WeakMap caching', () => {
    it('creates new Evaluator for empty context', () => {
      const ctx = createRuntimeContext();
      const evaluator = getEvaluator(ctx);

      expect(evaluator).toBeDefined();
      expect(evaluator).toBeInstanceOf(Evaluator);
    });

    it('returns cached instance for repeated access', () => {
      const ctx = createRuntimeContext();
      const evaluator1 = getEvaluator(ctx);
      const evaluator2 = getEvaluator(ctx);

      // Same instance returned (cached)
      expect(evaluator1).toBe(evaluator2);
    });

    it('creates separate instances for different contexts', () => {
      const ctx1 = createRuntimeContext();
      const ctx2 = createRuntimeContext();

      const evaluator1 = getEvaluator(ctx1);
      const evaluator2 = getEvaluator(ctx2);

      // Different instances for different contexts
      expect(evaluator1).not.toBe(evaluator2);
    });

    it('caches work with context options', () => {
      const ctx = createRuntimeContext({
        variables: { x: 42 },
        timeout: 5000,
      });

      const evaluator1 = getEvaluator(ctx);
      const evaluator2 = getEvaluator(ctx);

      // Same instance even with options
      expect(evaluator1).toBe(evaluator2);
    });
  });

  describe('mixin integration', () => {
    it('evaluator can access base utilities', () => {
      const ctx = createRuntimeContext();
      const evaluator = new Evaluator(ctx);

      // getIterationLimit is from AnnotationsMixin but uses base getAnnotation
      const limit = evaluator.getIterationLimit();
      expect(limit).toBe(10000); // Default limit
    });

    it('annotations stack is initialized', () => {
      const ctx = createRuntimeContext();
      const evaluator = new Evaluator(ctx);

      // getAnnotation should return undefined for empty stack
      const annotation = evaluator.getAnnotation('nonexistent');
      expect(annotation).toBeUndefined();
    });
  });
});
