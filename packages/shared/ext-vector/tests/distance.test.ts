/**
 * Test suite for distance metric normalization.
 * Validates acceptance criteria (AC-7, AC-8, AC-20).
 */

import { describe, it, expect } from 'vitest';
import { normalizeDistance } from '../src/distance.js';

describe('normalizeDistance', () => {
  describe('AC-7: dotproduct variations', () => {
    it('normalizes "dotproduct" to "dot"', () => {
      expect(normalizeDistance('dotproduct')).toBe('dot');
    });

    it('normalizes "Dot" to "dot"', () => {
      expect(normalizeDistance('Dot')).toBe('dot');
    });

    it('normalizes "dot" to "dot"', () => {
      expect(normalizeDistance('dot')).toBe('dot');
    });
  });

  describe('cosine variations', () => {
    it('normalizes "cosine" to "cosine"', () => {
      expect(normalizeDistance('cosine')).toBe('cosine');
    });

    it('normalizes "Cosine" to "cosine"', () => {
      expect(normalizeDistance('Cosine')).toBe('cosine');
    });
  });

  describe('AC-8: euclidean variations', () => {
    it('normalizes "euclidean" to "euclidean"', () => {
      expect(normalizeDistance('euclidean')).toBe('euclidean');
    });

    it('normalizes "Euclid" to "euclidean"', () => {
      expect(normalizeDistance('Euclid')).toBe('euclidean');
    });
  });

  describe('AC-20: unknown metric unchanged', () => {
    it('returns unknown metric unchanged', () => {
      expect(normalizeDistance('unknown_metric')).toBe('unknown_metric');
    });

    it('returns custom metric unchanged', () => {
      expect(normalizeDistance('custom')).toBe('custom');
    });

    it('returns empty string unchanged', () => {
      expect(normalizeDistance('')).toBe('');
    });
  });

  describe('case sensitivity', () => {
    it('does not normalize "COSINE" (all caps)', () => {
      expect(normalizeDistance('COSINE')).toBe('COSINE');
    });

    it('does not normalize "DOT" (all caps)', () => {
      expect(normalizeDistance('DOT')).toBe('DOT');
    });

    it('does not normalize "EUCLIDEAN" (all caps)', () => {
      expect(normalizeDistance('EUCLIDEAN')).toBe('EUCLIDEAN');
    });

    it('does not normalize "eucLidean" (mixed case)', () => {
      expect(normalizeDistance('eucLidean')).toBe('eucLidean');
    });
  });

  describe('provider-specific patterns', () => {
    it('handles Qdrant-style capitalized metrics', () => {
      expect(normalizeDistance('Cosine')).toBe('cosine');
      expect(normalizeDistance('Euclid')).toBe('euclidean');
      expect(normalizeDistance('Dot')).toBe('dot');
    });

    it('handles Pinecone-style lowercase metrics', () => {
      expect(normalizeDistance('cosine')).toBe('cosine');
      expect(normalizeDistance('euclidean')).toBe('euclidean');
      expect(normalizeDistance('dotproduct')).toBe('dot');
    });

    it('handles standard lowercase metric names', () => {
      expect(normalizeDistance('dot')).toBe('dot');
      expect(normalizeDistance('cosine')).toBe('cosine');
      expect(normalizeDistance('euclidean')).toBe('euclidean');
    });
  });

  describe('edge cases', () => {
    it('does not normalize similar but different strings', () => {
      expect(normalizeDistance('dotprod')).toBe('dotprod');
      expect(normalizeDistance('cos')).toBe('cos');
      expect(normalizeDistance('euclid')).toBe('euclid');
    });

    it('handles metrics with prefixes', () => {
      expect(normalizeDistance('metric_cosine')).toBe('metric_cosine');
      expect(normalizeDistance('custom_dot')).toBe('custom_dot');
    });

    it('handles metrics with suffixes', () => {
      expect(normalizeDistance('cosine_similarity')).toBe('cosine_similarity');
      expect(normalizeDistance('dot_product')).toBe('dot_product');
    });
  });

  describe('return type', () => {
    it('returns DistanceMetric for known metrics', () => {
      const result = normalizeDistance('cosine');
      const validMetrics: Array<'cosine' | 'euclidean' | 'dot'> = [
        'cosine',
        'euclidean',
        'dot',
      ];
      expect(validMetrics).toContain(result);
    });

    it('returns string for unknown metrics', () => {
      const result = normalizeDistance('custom');
      expect(typeof result).toBe('string');
    });
  });
});
