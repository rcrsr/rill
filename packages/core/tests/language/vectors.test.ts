/**
 * Rill Runtime Tests: Vector Type
 * Tests for vector type operations, methods, and error conditions
 */

import { createVector, type RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Vector Type', () => {
  describe('type() function [AC-9]', () => {
    it('returns "vector" for vector values', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'test-model');
      const actual = await run('get_vector() => $v\ntype($v)', {
        functions: {
          get_vector: {
            params: [],
            fn: () => vec,
          },
        },
      });
      expect(actual).toBe('vector');
    });
  });

  describe('.similarity() method [AC-10]', () => {
    it('returns number in [-1, 1] for parallel vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 0.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([2.0, 0.0, 0.0]), 'model-a');
      const result = await run('$a -> .similarity($b)', {
        functions: {
          vec_a: { params: [], fn: () => vecA },
          vec_b: { params: [], fn: () => vecB },
        },
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(1.0);
    });

    it('returns 0 for orthogonal vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 0.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([0.0, 1.0, 0.0]), 'model-a');
      const result = await run('$a -> .similarity($b)', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(0.0);
    });

    it('returns -1 for opposite vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 0.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([-1.0, 0.0, 0.0]), 'model-a');
      const result = await run('$a -> .similarity($b)', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(-1.0);
    });

    it('handles arbitrary normalized vectors', async () => {
      // Two unit vectors at 60 degrees (cos(60°) = 0.5)
      const vecA = createVector(new Float32Array([1.0, 0.0]), 'model-a');
      const vecB = createVector(
        new Float32Array([0.5, Math.sqrt(3) / 2]),
        'model-a'
      );
      const result = await run('$a -> .similarity($b)', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBeCloseTo(0.5, 5);
    });
  });

  describe('== comparison [AC-11]', () => {
    it('returns true for same data and model', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const result = await run('$a == $b', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(true);
    });

    it('returns false for same data different model', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-b');
      const result = await run('$a == $b', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(false);
    });

    it('returns false for different data same model', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 4.0]), 'model-a');
      const result = await run('$a == $b', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(false);
    });

    it('returns false for different dimensions', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const result = await run('$a == $b', {
        variables: {
          a: vecA,
          b: vecB,
        },
      });
      expect(result).toBe(false);
    });
  });

  describe('.similarity() error conditions [AC-20, EC-29]', () => {
    it('throws RILL-R003 for non-vector argument', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> .similarity("not a vector")', {
          variables: { v: vec },
        })
      ).rejects.toThrow('expected vector, got string');
    });

    it('throws RILL-R003 for number argument', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> .similarity(42)', {
          variables: { v: vec },
        })
      ).rejects.toThrow('expected vector, got number');
    });

    it('throws RILL-R003 for dict argument', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> .similarity([a: 1])', {
          variables: { v: vec },
        })
      ).rejects.toThrow('expected vector, got dict');
    });
  });

  describe('.similarity() dimension mismatch [AC-21, EC-30]', () => {
    it('throws RILL-R003 for dimension mismatch', async () => {
      const vec3d = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vec5d = createVector(
        new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]),
        'model-a'
      );
      await expect(
        run('$a -> .similarity($b)', {
          variables: { a: vec3d, b: vec5d },
        })
      ).rejects.toThrow('vector dimension mismatch: 3 vs 5');
    });

    it('throws RILL-R003 for 2d vs 4d mismatch', async () => {
      const vec2d = createVector(new Float32Array([1.0, 2.0]), 'model-a');
      const vec4d = createVector(
        new Float32Array([1.0, 2.0, 3.0, 4.0]),
        'model-a'
      );
      await expect(
        run('$a -> .similarity($b)', {
          variables: { a: vec2d, b: vec4d },
        })
      ).rejects.toThrow('vector dimension mismatch: 2 vs 4');
    });
  });

  describe('string interpolation [AC-22, EC-31]', () => {
    it('throws RILL-R003 for vector in string interpolation', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('"Vector: {$v}"', {
          variables: { v: vec },
        })
      ).rejects.toThrow('cannot coerce vector to string');
    });

    it('throws RILL-R003 for vector in string concatenation', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('"Prefix: {$v} suffix"', {
          variables: { v: vec },
        })
      ).rejects.toThrow('cannot coerce vector to string');
    });
  });

  describe('collection operations [EC-32]', () => {
    it('throws RILL-R003 for each on vector', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> each { $ * 2 }', {
          variables: { v: vec },
        })
      ).rejects.toThrow(
        'Collection operators require list, string, dict, or iterator, got vector'
      );
    });

    it('throws RILL-R003 for map on vector', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> map { $ * 2 }', {
          variables: { v: vec },
        })
      ).rejects.toThrow(
        'Collection operators require list, string, dict, or iterator, got vector'
      );
    });

    it('throws RILL-R003 for filter on vector', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> filter { $ > 1.5 }', {
          variables: { v: vec },
        })
      ).rejects.toThrow(
        'Collection operators require list, string, dict, or iterator, got vector'
      );
    });

    it('throws RILL-R003 for fold on vector', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> fold(0) { $@ + $ }', {
          variables: { v: vec },
        })
      ).rejects.toThrow(
        'Collection operators require list, string, dict, or iterator, got vector'
      );
    });
  });

  describe('zero-dimension vector [AC-29]', () => {
    it('throws error when creating zero-dimension vector', () => {
      expect(() => createVector(new Float32Array([]), 'model-a')).toThrow(
        'Vector data must have at least one dimension'
      );
    });
  });

  describe('.dimensions method', () => {
    it('returns dimension count', async () => {
      const vec3d = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const result = await run('$v -> .dimensions', {
        variables: { v: vec3d },
      });
      expect(result).toBe(3);
    });

    it('returns 5 for 5-dimensional vector', async () => {
      const vec5d = createVector(
        new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]),
        'model-a'
      );
      const result = await run('$v -> .dimensions', {
        variables: { v: vec5d },
      });
      expect(result).toBe(5);
    });

    it('throws RILL-R003 for non-vector receiver', async () => {
      await expect(run('[1, 2, 3] -> .dimensions')).rejects.toThrow(
        'dimensions requires vector receiver'
      );
    });
  });

  describe('.model property access', () => {
    it('returns model name', async () => {
      const vec = createVector(
        new Float32Array([1.0, 2.0, 3.0]),
        'gpt-4-turbo'
      );
      const result = await run('$v -> .model', {
        variables: { v: vec },
      });
      expect(result).toBe('gpt-4-turbo');
    });

    it('returns different model names correctly', async () => {
      const vec = createVector(
        new Float32Array([1.0, 2.0]),
        'text-embedding-3-small'
      );
      const result = await run('$v -> .model', {
        variables: { v: vec },
      });
      expect(result).toBe('text-embedding-3-small');
    });
  });

  describe('.dot() method', () => {
    it('calculates dot product of aligned vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([4.0, 5.0, 6.0]), 'model-a');
      const result = await run('$a -> .dot($b)', {
        variables: { a: vecA, b: vecB },
      });
      // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
      expect(result).toBe(32);
    });

    it('returns 0 for orthogonal vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([0.0, 1.0]), 'model-a');
      const result = await run('$a -> .dot($b)', {
        variables: { a: vecA, b: vecB },
      });
      expect(result).toBe(0);
    });

    it('throws RILL-R003 for dimension mismatch', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$a -> .dot($b)', {
          variables: { a: vecA, b: vecB },
        })
      ).rejects.toThrow('vector dimension mismatch');
    });

    it('throws RILL-R003 for non-vector argument', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> .dot(42)', {
          variables: { v: vec },
        })
      ).rejects.toThrow('expected vector, got number');
    });
  });

  describe('.distance() method', () => {
    it('calculates Euclidean distance', async () => {
      const vecA = createVector(new Float32Array([0.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([3.0, 4.0]), 'model-a');
      const result = await run('$a -> .distance($b)', {
        variables: { a: vecA, b: vecB },
      });
      // sqrt((3-0)^2 + (4-0)^2) = sqrt(9 + 16) = 5
      expect(result).toBe(5);
    });

    it('returns 0 for identical vectors', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const result = await run('$a -> .distance($b)', {
        variables: { a: vecA, b: vecB },
      });
      expect(result).toBe(0);
    });

    it('throws RILL-R003 for dimension mismatch', async () => {
      const vecA = createVector(new Float32Array([1.0, 2.0]), 'model-a');
      const vecB = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$a -> .distance($b)', {
          variables: { a: vecA, b: vecB },
        })
      ).rejects.toThrow('vector dimension mismatch');
    });

    it('throws RILL-R003 for non-vector argument', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> .distance("not a vector")', {
          variables: { v: vec },
        })
      ).rejects.toThrow('expected vector, got string');
    });
  });

  describe('.norm() method', () => {
    it('calculates L2 norm (magnitude)', async () => {
      const vec = createVector(new Float32Array([3.0, 4.0]), 'model-a');
      const result = await run('$v -> .norm', {
        variables: { v: vec },
      });
      // sqrt(3^2 + 4^2) = sqrt(9 + 16) = 5
      expect(result).toBe(5);
    });

    it('returns 1 for unit vector', async () => {
      const vec = createVector(new Float32Array([1.0, 0.0, 0.0]), 'model-a');
      const result = await run('$v -> .norm', {
        variables: { v: vec },
      });
      expect(result).toBe(1);
    });

    it('calculates norm for 3d vector', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 2.0]), 'model-a');
      const result = await run('$v -> .norm', {
        variables: { v: vec },
      });
      // sqrt(1 + 4 + 4) = 3
      expect(result).toBe(3);
    });

    it('throws RILL-R003 for non-vector receiver', async () => {
      await expect(run('[3, 4] -> .norm')).rejects.toThrow(
        'norm requires vector receiver'
      );
    });
  });

  describe('.normalize() method', () => {
    it('returns unit vector in same direction', async () => {
      const vec = createVector(new Float32Array([3.0, 4.0]), 'model-a');
      const result = await run('$v -> .normalize -> .norm', {
        variables: { v: vec },
      });
      expect(result).toBeCloseTo(1.0, 5);
    });

    it('preserves direction', async () => {
      const vec = createVector(new Float32Array([3.0, 4.0]), 'model-a');
      const normalized = (await run('$v -> .normalize', {
        variables: { v: vec },
      })) as RillValue;
      expect(normalized).toHaveProperty('__rill_vector', true);
      if (
        typeof normalized === 'object' &&
        normalized !== null &&
        '__rill_vector' in normalized
      ) {
        const vecNorm = normalized as { data: Float32Array };
        expect(vecNorm.data[0]).toBeCloseTo(0.6, 5);
        expect(vecNorm.data[1]).toBeCloseTo(0.8, 5);
      }
    });

    it('preserves model name', async () => {
      const vec = createVector(new Float32Array([3.0, 4.0]), 'test-model');
      const result = await run('$v -> .normalize -> .model', {
        variables: { v: vec },
      });
      expect(result).toBe('test-model');
    });

    it('throws RILL-R003 for non-vector receiver', async () => {
      await expect(run('[3, 4] -> .normalize')).rejects.toThrow(
        'normalize requires vector receiver'
      );
    });

    it('handles already normalized vector', async () => {
      const vec = createVector(new Float32Array([1.0, 0.0, 0.0]), 'model-a');
      const result = await run('$v -> .normalize -> .norm', {
        variables: { v: vec },
      });
      expect(result).toBeCloseTo(1.0, 5);
    });
  });

  describe('complex vector operations', () => {
    it('chains similarity with conditional', async () => {
      const vecA = createVector(new Float32Array([1.0, 0.0]), 'model-a');
      const vecB = createVector(new Float32Array([0.0, 1.0]), 'model-a');
      const result = await run(
        '$a -> .similarity($b) -> ($ > 0.5) ? "similar" ! "different"',
        {
          variables: { a: vecA, b: vecB },
        }
      );
      expect(result).toBe('different');
    });

    it('uses dot product in calculations', async () => {
      const vecA = createVector(new Float32Array([2.0, 3.0]), 'model-a');
      const vecB = createVector(new Float32Array([4.0, 5.0]), 'model-a');
      const result = await run('$a -> .dot($b) -> ($ * 2)', {
        variables: { a: vecA, b: vecB },
      });
      // (2*4 + 3*5) * 2 = (8 + 15) * 2 = 46
      expect(result).toBe(46);
    });

    it('compares normalized vectors', async () => {
      const vecA = createVector(new Float32Array([3.0, 4.0]), 'model-a');
      const vecB = createVector(new Float32Array([6.0, 8.0]), 'model-a');
      const result = await run(
        '$a -> .normalize => $normA\n$b -> .normalize => $normB\n$normA -> .similarity($normB)',
        {
          variables: { a: vecA, b: vecB },
        }
      );
      expect(result).toBeCloseTo(1.0, 5);
    });

    it('chains dimension check with conditional', async () => {
      const vec3d = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      const result = await run(
        '$v -> .dimensions -> ($ == 3) ? "3D" ! "not 3D"',
        {
          variables: { v: vec3d },
        }
      );
      expect(result).toBe('3D');
    });
  });

  // Note: Type assertion tests (:vector, :?vector) omitted because vector type
  // is not yet registered in the parser's type system. These will be added when
  // the parser is updated to recognize "vector" as a valid type name.
});
