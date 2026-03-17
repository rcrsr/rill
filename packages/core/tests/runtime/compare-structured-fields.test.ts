/**
 * Tests for compareStructuredFields() dispatch helper.
 *
 * Verifies that the generic field dispatch handles dict, tuple, and
 * ordered kinds correctly, including valueType checks, empty fields,
 * and field presence mismatches.
 *
 * AC-6: compareStructuredFields handles dict, tuple, and ordered dispatch
 * AC-43: structureEquals handles empty union (0 members)
 */

import type {
  FieldComparisonCallbacks,
  TypeStructure,
} from '../../src/runtime/core/types/operations.js';
import {
  compareStructuredFields,
  structureEquals,
} from '../../src/runtime/core/values.js';
import { describe, expect, it } from 'vitest';

/** Test callbacks that return string labels identifying which callback fired */
const labelCallbacks: FieldComparisonCallbacks<string> = {
  onValueType: () => 'valueType',
  onValueTypeMismatch: () => 'valueTypeMismatch',
  onBothEmpty: () => 'bothEmpty',
  onFieldPresenceMismatch: () => 'fieldPresenceMismatch',
  onDictFields: () => 'dictFields',
  onTupleElements: () => 'tupleElements',
  onOrderedFields: () => 'orderedFields',
};

describe('compareStructuredFields', () => {
  describe('dict dispatch (AC-6)', () => {
    it('dispatches to onDictFields for dict with fields', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' } } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { y: { type: { kind: 'string' } } },
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('dictFields');
    });

    it('dispatches to onValueType when both dicts have valueType', () => {
      const a: TypeStructure = {
        kind: 'dict',
        valueType: { kind: 'number' },
      };
      const b: TypeStructure = {
        kind: 'dict',
        valueType: { kind: 'string' },
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('valueType');
    });

    it('dispatches to onValueTypeMismatch when one dict has valueType', () => {
      const a: TypeStructure = {
        kind: 'dict',
        valueType: { kind: 'number' },
      };
      const b: TypeStructure = { kind: 'dict' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('valueTypeMismatch');
    });

    it('dispatches to onBothEmpty for bare dicts', () => {
      const a: TypeStructure = { kind: 'dict' };
      const b: TypeStructure = { kind: 'dict' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('bothEmpty');
    });

    it('dispatches to onFieldPresenceMismatch when one dict has fields', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' } } },
      };
      const b: TypeStructure = { kind: 'dict' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('fieldPresenceMismatch');
    });

    it('dispatches to onDictFields for empty fields object', () => {
      const a: TypeStructure = { kind: 'dict', fields: {} };
      const b: TypeStructure = { kind: 'dict', fields: {} };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('dictFields');
    });
  });

  describe('tuple dispatch (AC-6)', () => {
    it('dispatches to onTupleElements for tuple with elements', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' } }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'string' } }],
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('tupleElements');
    });

    it('dispatches to onValueType when both tuples have valueType', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        valueType: { kind: 'number' },
      };
      const b: TypeStructure = {
        kind: 'tuple',
        valueType: { kind: 'number' },
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('valueType');
    });

    it('dispatches to onBothEmpty for bare tuples', () => {
      const a: TypeStructure = { kind: 'tuple' };
      const b: TypeStructure = { kind: 'tuple' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('bothEmpty');
    });

    it('dispatches to onFieldPresenceMismatch for mixed tuple', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' } }],
      };
      const b: TypeStructure = { kind: 'tuple' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('fieldPresenceMismatch');
    });
  });

  describe('ordered dispatch (AC-6)', () => {
    it('dispatches to onOrderedFields for ordered with fields', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' } }],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'y', type: { kind: 'string' } }],
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('orderedFields');
    });

    it('dispatches to onValueType when both ordered have valueType', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        valueType: { kind: 'string' },
      };
      const b: TypeStructure = {
        kind: 'ordered',
        valueType: { kind: 'string' },
      };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('valueType');
    });

    it('dispatches to onBothEmpty for bare ordered types', () => {
      const a: TypeStructure = { kind: 'ordered' };
      const b: TypeStructure = { kind: 'ordered' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('bothEmpty');
    });
  });

  describe('fallback for non-structured kinds', () => {
    it('returns fallback for number kind', () => {
      const a: TypeStructure = { kind: 'number' };
      const b: TypeStructure = { kind: 'number' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('fallback');
    });

    it('returns fallback for list kind', () => {
      const a: TypeStructure = { kind: 'list' };
      const b: TypeStructure = { kind: 'list' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('fallback');
    });

    it('returns fallback for closure kind', () => {
      const a: TypeStructure = { kind: 'closure' };
      const b: TypeStructure = { kind: 'closure' };
      const result = compareStructuredFields(a, b, labelCallbacks, 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('callback receives correct field data', () => {
    it('passes dict fields to onDictFields', () => {
      const aFields = { x: { type: { kind: 'number' } as TypeStructure } };
      const bFields = { y: { type: { kind: 'string' } as TypeStructure } };
      const a: TypeStructure = { kind: 'dict', fields: aFields };
      const b: TypeStructure = { kind: 'dict', fields: bFields };

      let received: {
        a: Record<string, unknown>;
        b: Record<string, unknown>;
      } | null = null;
      const callbacks: FieldComparisonCallbacks<boolean> = {
        ...labelCallbacks,
        onDictFields: (af, bf) => {
          received = { a: af, b: bf };
          return true;
        },
      } as FieldComparisonCallbacks<boolean>;

      compareStructuredFields(a, b, callbacks, false);
      expect(received).not.toBeNull();
      expect(Object.keys(received!.a)).toEqual(['x']);
      expect(Object.keys(received!.b)).toEqual(['y']);
    });

    it('passes tuple elements to onTupleElements', () => {
      const aElems = [{ type: { kind: 'number' } as TypeStructure }];
      const bElems = [
        { type: { kind: 'string' } as TypeStructure },
        { type: { kind: 'bool' } as TypeStructure },
      ];
      const a: TypeStructure = { kind: 'tuple', elements: aElems };
      const b: TypeStructure = { kind: 'tuple', elements: bElems };

      let receivedLengths: { a: number; b: number } | null = null;
      const callbacks: FieldComparisonCallbacks<boolean> = {
        ...labelCallbacks,
        onTupleElements: (ae, be) => {
          receivedLengths = { a: ae.length, b: be.length };
          return true;
        },
      } as FieldComparisonCallbacks<boolean>;

      compareStructuredFields(a, b, callbacks, false);
      expect(receivedLengths).toEqual({ a: 1, b: 2 });
    });

    it('passes valueTypes to onValueType for ordered', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        valueType: { kind: 'number' },
      };
      const b: TypeStructure = {
        kind: 'ordered',
        valueType: { kind: 'string' },
      };

      let receivedKinds: { a: string; b: string } | null = null;
      const callbacks: FieldComparisonCallbacks<boolean> = {
        ...labelCallbacks,
        onValueType: (avt, bvt) => {
          receivedKinds = { a: avt.kind, b: bvt.kind };
          return true;
        },
      } as FieldComparisonCallbacks<boolean>;

      compareStructuredFields(a, b, callbacks, false);
      expect(receivedKinds).toEqual({ a: 'number', b: 'string' });
    });
  });
});

describe('structureEquals - empty union (AC-43)', () => {
  it('returns true for two empty unions', () => {
    const a: TypeStructure = { kind: 'union', members: [] };
    const b: TypeStructure = { kind: 'union', members: [] };
    expect(structureEquals(a, b)).toBe(true);
  });

  it('returns false for empty union vs single-member union', () => {
    const a: TypeStructure = { kind: 'union', members: [] };
    const b: TypeStructure = {
      kind: 'union',
      members: [{ kind: 'string' }],
    };
    expect(structureEquals(a, b)).toBe(false);
  });
});
