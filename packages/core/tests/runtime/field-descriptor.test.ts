/**
 * Tests for buildFieldDescriptor
 *
 * IR-1: Returns frozen RillFieldDescriptor with correct fields.
 * EC-1: Throws RILL-R003 when fieldName is absent from structuralType.fields.
 */

import { describe, expect, it } from 'vitest';
import { buildFieldDescriptor, RuntimeError } from '@rcrsr/rill';
import type { RillStructuralType, SourceLocation } from '@rcrsr/rill';

// Minimal SourceLocation for error reporting
const LOC: SourceLocation = { line: 1, column: 1, offset: 0 };

// Minimal RillStructuralType entries for test structural types
const STRING_TYPE: RillStructuralType = { kind: 'primitive', name: 'string' };

const NUMBER_TYPE: RillStructuralType = { kind: 'primitive', name: 'number' };

function makeStructuralDictType(
  fields: Record<string, RillStructuralType>
): RillStructuralType & { kind: 'dict' } {
  return Object.freeze({
    kind: 'dict' as const,
    fields: Object.freeze(fields),
  });
}

describe('buildFieldDescriptor', () => {
  describe('IR-1: returns correct RillFieldDescriptor', () => {
    it('returns object with brand marker __rill_field_descriptor true', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.__rill_field_descriptor).toBe(true);
    });

    it('returns object with correct fieldName', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.fieldName).toBe('name');
    });

    it('returns object with fieldType matching structuralType.fields[fieldName]', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.fieldType).toBe(STRING_TYPE);
    });

    it('returns frozen object (non-writable properties)', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(Object.isFrozen(descriptor)).toBe(true);
    });

    it('handles number field type correctly', () => {
      const structType = makeStructuralDictType({ count: NUMBER_TYPE });
      const descriptor = buildFieldDescriptor(structType, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.fieldType).toEqual({
        kind: 'primitive',
        name: 'number',
      });
    });

    it('selects the correct field when structural type has multiple fields', () => {
      const structType = makeStructuralDictType({
        name: STRING_TYPE,
        count: NUMBER_TYPE,
      });
      const descriptor = buildFieldDescriptor(structType, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.fieldType).toBe(NUMBER_TYPE);
    });
  });

  describe('EC-1: throws RILL-R003 when fieldName absent', () => {
    it('throws RuntimeError for unknown field name', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      expect(() => buildFieldDescriptor(structType, 'missing', LOC)).toThrow(
        'Shape has no field "missing"'
      );
    });

    it('thrown error is a RuntimeError with code RILL-R003', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      let caught: unknown;
      try {
        buildFieldDescriptor(structType, 'absent', LOC);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R003'
      );
    });

    it('error message includes the missing field name', () => {
      const structType = makeStructuralDictType({ name: STRING_TYPE });
      expect(() =>
        buildFieldDescriptor(structType, 'nonexistent', LOC)
      ).toThrow('"nonexistent"');
    });

    it('throws for empty structural type (no fields at all)', () => {
      const structType = makeStructuralDictType({});
      expect(() => buildFieldDescriptor(structType, 'name', LOC)).toThrow(
        'Shape has no field "name"'
      );
    });
  });
});
