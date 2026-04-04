/**
 * Tests for buildFieldDescriptor
 *
 * IR-1: Returns frozen RillFieldDescriptor with correct fields.
 * EC-1: Throws RILL-R003 when fieldName is absent from structuralType.fields.
 */

import { describe, expect, it } from 'vitest';
import { buildFieldDescriptor, RuntimeError } from '@rcrsr/rill';
import type { RillFieldDef, TypeStructure, SourceLocation } from '@rcrsr/rill';

// Minimal SourceLocation for error reporting
const LOC: SourceLocation = { line: 1, column: 1, offset: 0 };

// Minimal TypeStructure entries for test structural types
const STRING_TYPE: TypeStructure = { kind: 'string' };

const NUMBER_TYPE: TypeStructure = { kind: 'number' };

function makeStructuralDictType(
  fields: Record<string, RillFieldDef>
): TypeStructure & { kind: 'dict' } {
  return Object.freeze({
    kind: 'dict' as const,
    fields: Object.freeze(fields),
  });
}

describe('buildFieldDescriptor', () => {
  describe('IR-1: returns correct RillFieldDescriptor', () => {
    it('returns object with brand marker __rill_field_descriptor true', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.__rill_field_descriptor).toBe(true);
    });

    it('returns object with correct fieldName', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.fieldName).toBe('name');
    });

    it('returns object with fieldType matching structuralType.fields[fieldName]', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.fieldType).toEqual({ type: STRING_TYPE });
    });

    it('returns frozen object (non-writable properties)', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(Object.isFrozen(descriptor)).toBe(true);
    });

    it('handles number field type correctly', () => {
      const structType = makeStructuralDictType({
        count: { type: NUMBER_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.fieldType).toEqual({ type: NUMBER_TYPE });
    });

    it('selects the correct field when structural type has multiple fields', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
        count: { type: NUMBER_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.fieldType).toEqual({ type: NUMBER_TYPE });
    });
  });

  describe('FR-DFIELD-2: annotated fields in field descriptor', () => {
    it('returns fieldType with annotations when field carries annotations', () => {
      const structType = makeStructuralDictType({
        name: {
          type: STRING_TYPE,
          annotations: { description: 'User name' },
        },
      });
      const descriptor = buildFieldDescriptor(structType, 'name', LOC);
      expect(descriptor.fieldName).toBe('name');
      expect(descriptor.fieldType).toEqual({
        type: STRING_TYPE,
        annotations: { description: 'User name' },
      });
    });

    it('returns fieldType without annotations when field has none', () => {
      const structType = makeStructuralDictType({
        count: { type: NUMBER_TYPE },
      });
      const descriptor = buildFieldDescriptor(structType, 'count', LOC);
      expect(descriptor.fieldType).toEqual({ type: NUMBER_TYPE });
      expect(descriptor.fieldType.annotations).toBeUndefined();
    });

    it('selects correct annotated field from multiple fields', () => {
      const structType = makeStructuralDictType({
        name: {
          type: STRING_TYPE,
          annotations: { description: 'label' },
        },
        count: { type: NUMBER_TYPE },
      });
      const nameDesc = buildFieldDescriptor(structType, 'name', LOC);
      const countDesc = buildFieldDescriptor(structType, 'count', LOC);
      expect(nameDesc.fieldType.annotations).toEqual({
        description: 'label',
      });
      expect(countDesc.fieldType.annotations).toBeUndefined();
    });
  });

  describe('EC-1: throws RILL-R003 when fieldName absent', () => {
    it('throws RuntimeError for unknown field name', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
      expect(() => buildFieldDescriptor(structType, 'missing', LOC)).toThrow(
        'Shape has no field "missing"'
      );
    });

    it('thrown error is a RuntimeError with code RILL-R003', () => {
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
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
      const structType = makeStructuralDictType({
        name: { type: STRING_TYPE },
      });
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
