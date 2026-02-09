/**
 * Tests for vector value utilities
 * Verifies inferType, formatValue, deepEquals, isTruthy for vector type
 */

import { describe, expect, it } from 'vitest';
import {
  createVector,
  deepEquals,
  formatValue,
  inferType,
  isEmpty,
  isTruthy,
} from '../../src/runtime/core/values.js';

describe('Vector value utilities', () => {
  describe('inferType', () => {
    it('returns "vector" for vector values', () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'test-model');
      expect(inferType(vec)).toBe('vector');
    });
  });

  describe('formatValue', () => {
    it('formats vector as vector(model, Nd)', () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'voyage-3');
      expect(formatValue(vec)).toBe('vector(voyage-3, 3d)');
    });

    it('formats vector with correct dimension count', () => {
      const vec = createVector(
        new Float32Array(1024),
        'text-embedding-3-small'
      );
      expect(formatValue(vec)).toBe('vector(text-embedding-3-small, 1024d)');
    });
  });

  describe('deepEquals', () => {
    it('returns true for vectors with same model and data', () => {
      const vec1 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      const vec2 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      expect(deepEquals(vec1, vec2)).toBe(true);
    });

    it('returns false for vectors with different models', () => {
      const vec1 = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vec2 = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-b');
      expect(deepEquals(vec1, vec2)).toBe(false);
    });

    it('returns false for vectors with different data', () => {
      const vec1 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      const vec2 = createVector(
        new Float32Array([1.0, 2.0, 4.0]),
        'test-model'
      );
      expect(deepEquals(vec1, vec2)).toBe(false);
    });

    it('returns false for vectors with different lengths', () => {
      const vec1 = createVector(new Float32Array([1.0, 2.0]), 'test-model');
      const vec2 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      expect(deepEquals(vec1, vec2)).toBe(false);
    });

    it('returns false when comparing vector to non-vector', () => {
      const vec = createVector(new Float32Array([1.0, 2.0]), 'test-model');
      expect(deepEquals(vec, [1.0, 2.0])).toBe(false);
      expect(deepEquals(vec, { data: [1.0, 2.0], model: 'test-model' })).toBe(
        false
      );
    });
  });

  describe('isTruthy', () => {
    it('returns true for any vector (always truthy)', () => {
      const vec1 = createVector(new Float32Array([0.0]), 'test-model');
      const vec2 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      expect(isTruthy(vec1)).toBe(true);
      expect(isTruthy(vec2)).toBe(true);
    });
  });

  describe('isEmpty', () => {
    it('returns false for any vector (never empty)', () => {
      const vec1 = createVector(new Float32Array([0.0]), 'test-model');
      const vec2 = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'test-model'
      );
      expect(isEmpty(vec1)).toBe(false);
      expect(isEmpty(vec2)).toBe(false);
    });
  });
});
