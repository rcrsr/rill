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
import { structuralTypeEquals } from '../../src/runtime/core/values.js';

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
