/**
 * Tests for structuralTypeEquals default value comparison.
 *
 * Verifies that two structural types with identical field types but
 * different default values are NOT considered equal (IR-7).
 */

import { type RillType } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// structuralTypeEquals is not exported from the public API.
// We test it indirectly via inferStructuralType + deepEquals,
// or directly via a thin re-export shim if available.
// Since it IS exported from values.ts (not re-exported from index),
// we import it from the internal path under test isolation.
import {
  commonType,
  structuralTypeEquals,
} from '../../src/runtime/core/values.js';

describe('structuralTypeEquals', () => {
  describe('dict branch - default value comparison', () => {
    it('returns true when both fields have identical defaults', () => {
      const a: RillType = {
        type: 'dict',
        fields: { x: { type: { type: 'number' }, defaultValue: 42 } },
      };
      const b: RillType = {
        type: 'dict',
        fields: { x: { type: { type: 'number' }, defaultValue: 42 } },
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('returns false when fields have different default values', () => {
      const a: RillType = {
        type: 'dict',
        fields: { x: { type: { type: 'number' }, defaultValue: 1 } },
      };
      const b: RillType = {
        type: 'dict',
        fields: { x: { type: { type: 'number' }, defaultValue: 2 } },
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns false when one field has a default and the other does not', () => {
      const a: RillType = {
        type: 'dict',
        fields: { x: { type: { type: 'number' }, defaultValue: 0 } },
      };
      const b: RillType = {
        type: 'dict',
        fields: { x: { type: 'number' } as RillType },
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns true when neither field has a default', () => {
      const a: RillType = {
        type: 'dict',
        fields: { x: { type: 'number' } as RillType },
      };
      const b: RillType = {
        type: 'dict',
        fields: { x: { type: 'number' } as RillType },
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('returns false when string defaults differ', () => {
      const a: RillType = {
        type: 'dict',
        fields: { name: { type: { type: 'string' }, defaultValue: 'Alice' } },
      };
      const b: RillType = {
        type: 'dict',
        fields: { name: { type: { type: 'string' }, defaultValue: 'Bob' } },
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });
  });

  describe('ordered branch - default value comparison', () => {
    it('returns true when both fields have identical defaults', () => {
      const a: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }, 10]],
      };
      const b: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }, 10]],
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('returns false when fields have different default values', () => {
      const a: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }, 1]],
      };
      const b: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }, 2]],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns false when one field has a default and the other does not', () => {
      const a: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }, 0]],
      };
      const b: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }]],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns true when neither field has a default', () => {
      const a: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }]],
      };
      const b: RillType = {
        type: 'ordered',
        fields: [['x', { type: 'number' }]],
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('compares multiple fields including defaults correctly', () => {
      const a: RillType = {
        type: 'ordered',
        fields: [
          ['x', { type: 'number' }],
          ['y', { type: 'string' }, 'hello'],
        ],
      };
      const b: RillType = {
        type: 'ordered',
        fields: [
          ['x', { type: 'number' }],
          ['y', { type: 'string' }, 'world'],
        ],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });
  });

  describe('tuple branch - default value comparison', () => {
    it('returns true when both elements have identical defaults', () => {
      const a: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }, 5]],
      };
      const b: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }, 5]],
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('returns false when elements have different default values', () => {
      const a: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }, 1]],
      };
      const b: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }, 2]],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns false when one element has a default and the other does not', () => {
      const a: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }, 0]],
      };
      const b: RillType = {
        type: 'tuple',
        elements: [[{ type: 'number' }]],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });

    it('returns true when neither element has a default', () => {
      const a: RillType = {
        type: 'tuple',
        elements: [[{ type: 'string' }]],
      };
      const b: RillType = {
        type: 'tuple',
        elements: [[{ type: 'string' }]],
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('compares boolean defaults correctly', () => {
      const a: RillType = {
        type: 'tuple',
        elements: [[{ type: 'bool' }, true]],
      };
      const b: RillType = {
        type: 'tuple',
        elements: [[{ type: 'bool' }, false]],
      };
      expect(structuralTypeEquals(a, b)).toBe(false);
    });
  });

  describe('commonType', () => {
    it('returns the specific type when first arg is any [AC-9]', () => {
      const result = commonType({ type: 'any' }, { type: 'number' });
      expect(result).toEqual({ type: 'number' });
    });

    it('returns the specific type when second arg is any (symmetric) [AC-9]', () => {
      const result = commonType({ type: 'number' }, { type: 'any' });
      expect(result).toEqual({ type: 'number' });
    });

    it('returns input type for two structurally equal list(number) types [AC-10]', () => {
      const listNum: RillType = { type: 'list', element: { type: 'number' } };
      const listNum2: RillType = { type: 'list', element: { type: 'number' } };
      const result = commonType(listNum, listNum2);
      expect(result).toEqual({ type: 'list', element: { type: 'number' } });
    });

    it('returns null for incompatible leaf types [AC-14]', () => {
      const result = commonType({ type: 'number' }, { type: 'string' });
      expect(result).toBeNull();
    });

    it('never returns undefined for any input combination [AC-15]', () => {
      const leafTypes: RillType[] = [
        { type: 'number' },
        { type: 'string' },
        { type: 'bool' },
        { type: 'vector' },
        { type: 'type' },
        { type: 'any' },
      ];
      const compoundTypes: RillType[] = [
        { type: 'list', element: { type: 'number' } },
        { type: 'dict', fields: { x: { type: { type: 'number' } } } },
        { type: 'tuple', elements: [[{ type: 'number' }]] },
        { type: 'ordered', fields: [['x', { type: 'number' }]] },
        { type: 'closure', params: [] },
        { type: 'union', members: [{ type: 'string' }] },
      ];
      const allTypes = [...leafTypes, ...compoundTypes];

      // leaf x leaf
      for (const a of leafTypes) {
        for (const b of leafTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
        }
      }

      // compound x compound
      for (const a of compoundTypes) {
        for (const b of compoundTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
        }
      }

      // leaf x compound (both directions)
      for (const a of leafTypes) {
        for (const b of compoundTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
          expect(commonType(b, a)).not.toBeUndefined();
        }
      }

      // Verify all 144 combinations were checked (12 types total)
      expect(allTypes).toHaveLength(12);
      expect(
        leafTypes.length * leafTypes.length +
          compoundTypes.length * compoundTypes.length +
          leafTypes.length * compoundTypes.length * 2
      ).toBe(144);
    });

    it('returns bare list for list(number) vs list(string) [AC-20]', () => {
      const listNum: RillType = { type: 'list', element: { type: 'number' } };
      const listStr: RillType = { type: 'list', element: { type: 'string' } };
      const result = commonType(listNum, listStr);
      expect(result).toEqual({ type: 'list' });
    });
  });

  describe('existing behavior preserved', () => {
    it('leaf types equal by type alone', () => {
      expect(structuralTypeEquals({ type: 'number' }, { type: 'number' })).toBe(
        true
      );
      expect(structuralTypeEquals({ type: 'string' }, { type: 'bool' })).toBe(
        false
      );
    });

    it('list types compare element type recursively', () => {
      const a: RillType = { type: 'list', element: { type: 'number' } };
      const b: RillType = { type: 'list', element: { type: 'number' } };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('union types compare members in order', () => {
      const a: RillType = {
        type: 'union',
        members: [{ type: 'string' }, { type: 'number' }],
      };
      const b: RillType = {
        type: 'union',
        members: [{ type: 'string' }, { type: 'number' }],
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });

    it('dict fields with same types and no defaults are equal', () => {
      const a: RillType = {
        type: 'dict',
        fields: {
          x: { type: 'number' } as RillType,
          y: { type: 'string' } as RillType,
        },
      };
      const b: RillType = {
        type: 'dict',
        fields: {
          x: { type: 'number' } as RillType,
          y: { type: 'string' } as RillType,
        },
      };
      expect(structuralTypeEquals(a, b)).toBe(true);
    });
  });
});
