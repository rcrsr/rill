/**
 * Tests for buildFieldDescriptor
 *
 * IR-1: Returns frozen RillShapeFieldDescriptor with correct fields.
 * EC-1: Throws RILL-R003 when fieldName is absent from shape.fields.
 */

import { describe, expect, it } from 'vitest';
import { buildFieldDescriptor, RuntimeError } from '@rcrsr/rill';
import type { RillShape, ShapeFieldSpec, SourceLocation } from '@rcrsr/rill';

// Minimal SourceLocation for error reporting
const LOC: SourceLocation = { line: 1, column: 1, offset: 0 };

// Minimal ShapeFieldSpec for test shapes
const STRING_SPEC: ShapeFieldSpec = {
  typeName: 'string',
  optional: false,
  nestedShape: undefined,
  annotations: {},
};

const OPTIONAL_NUMBER_SPEC: ShapeFieldSpec = {
  typeName: 'number',
  optional: true,
  nestedShape: undefined,
  annotations: {},
};

function makeShape(fields: Record<string, ShapeFieldSpec>): RillShape {
  return Object.freeze({
    __rill_shape: true as const,
    fields: Object.freeze(fields),
  });
}

describe('buildFieldDescriptor', () => {
  describe('IR-1: returns correct RillShapeFieldDescriptor', () => {
    it('returns object with brand marker __rill_field_descriptor true', () => {
      const shape = makeShape({ name: STRING_SPEC });
      const descriptor = buildFieldDescriptor(shape, 'name', LOC);
      expect(descriptor.__rill_field_descriptor).toBe(true);
    });

    it('returns object with correct fieldName', () => {
      const shape = makeShape({ name: STRING_SPEC });
      const descriptor = buildFieldDescriptor(shape, 'name', LOC);
      expect(descriptor.fieldName).toBe('name');
    });

    it('returns object with spec matching shape.fields[fieldName]', () => {
      const shape = makeShape({ name: STRING_SPEC });
      const descriptor = buildFieldDescriptor(shape, 'name', LOC);
      expect(descriptor.spec).toBe(STRING_SPEC);
    });

    it('returns frozen object (non-writable properties)', () => {
      const shape = makeShape({ name: STRING_SPEC });
      const descriptor = buildFieldDescriptor(shape, 'name', LOC);
      expect(Object.isFrozen(descriptor)).toBe(true);
    });

    it('handles optional field spec correctly', () => {
      const shape = makeShape({ count: OPTIONAL_NUMBER_SPEC });
      const descriptor = buildFieldDescriptor(shape, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.spec.optional).toBe(true);
      expect(descriptor.spec.typeName).toBe('number');
    });

    it('selects the correct field when shape has multiple fields', () => {
      const shape = makeShape({
        name: STRING_SPEC,
        count: OPTIONAL_NUMBER_SPEC,
      });
      const descriptor = buildFieldDescriptor(shape, 'count', LOC);
      expect(descriptor.fieldName).toBe('count');
      expect(descriptor.spec).toBe(OPTIONAL_NUMBER_SPEC);
    });
  });

  describe('EC-1: throws RILL-R003 when fieldName absent', () => {
    it('throws RuntimeError for unknown field name', () => {
      const shape = makeShape({ name: STRING_SPEC });
      expect(() => buildFieldDescriptor(shape, 'missing', LOC)).toThrow(
        'Shape has no field "missing"'
      );
    });

    it('thrown error is a RuntimeError with code RILL-R003', () => {
      const shape = makeShape({ name: STRING_SPEC });
      let caught: unknown;
      try {
        buildFieldDescriptor(shape, 'absent', LOC);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R003'
      );
    });

    it('error message includes the missing field name', () => {
      const shape = makeShape({ name: STRING_SPEC });
      expect(() => buildFieldDescriptor(shape, 'nonexistent', LOC)).toThrow(
        '"nonexistent"'
      );
    });

    it('throws for empty shape (no fields at all)', () => {
      const shape = makeShape({});
      expect(() => buildFieldDescriptor(shape, 'name', LOC)).toThrow(
        'Shape has no field "name"'
      );
    });
  });
});
