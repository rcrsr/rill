/**
 * Tests for RillShape → manifest format serialization.
 * IC-20: shape-manifest.test.ts
 * Covers: AC-33, EC-9
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import type { RillShape, ShapeFieldSpec } from '@rcrsr/rill';
import {
  rillShapeToInputSchema,
  rillShapeToOutputSchema,
} from '../src/schema.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Builds a minimal RillShape for testing.
 * Accepts partial ShapeFieldSpec per field; fills in safe defaults.
 */
function makeShape(
  fields: Record<string, Partial<ShapeFieldSpec> & { typeName: string }>
): RillShape {
  const fullFields: Record<string, ShapeFieldSpec> = {};
  for (const [name, partial] of Object.entries(fields)) {
    fullFields[name] = {
      typeName: partial.typeName,
      optional: partial.optional ?? false,
      nestedShape: partial.nestedShape,
      annotations: partial.annotations ?? {},
    };
  }
  return {
    __rill_shape: true as const,
    fields: fullFields,
  };
}

// ============================================================
// rillShapeToInputSchema
// ============================================================

describe('rillShapeToInputSchema', () => {
  // ============================================================
  // TYPE NAME MAPPING [AC-33]
  // ============================================================

  describe('type name mapping [AC-33]', () => {
    it('maps "string" typeName to type "string"', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ name: { typeName: 'string' } })
      );
      expect(schema['name']?.type).toBe('string');
    });

    it('maps "number" typeName to type "number"', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ age: { typeName: 'number' } })
      );
      expect(schema['age']?.type).toBe('number');
    });

    it('maps "bool" typeName to type "bool"', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ active: { typeName: 'bool' } })
      );
      expect(schema['active']?.type).toBe('bool');
    });

    it('maps "list" typeName to type "list"', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ tags: { typeName: 'list' } })
      );
      expect(schema['tags']?.type).toBe('list');
    });

    it('maps "dict" typeName to type "dict"', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ meta: { typeName: 'dict' } })
      );
      expect(schema['meta']?.type).toBe('dict');
    });

    it('maps unknown typeName to type "dict" (default branch)', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ x: { typeName: 'shape' } })
      );
      expect(schema['x']?.type).toBe('dict');
    });
  });

  // ============================================================
  // REQUIRED / OPTIONAL INVERSION [AC-33]
  // ============================================================

  describe('required/optional inversion [AC-33]', () => {
    it('optional:false produces required:true', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ name: { typeName: 'string', optional: false } })
      );
      expect(schema['name']?.required).toBe(true);
    });

    it('optional:true does not set required:true', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ name: { typeName: 'string', optional: true } })
      );
      expect(schema['name']?.required).not.toBe(true);
    });
  });

  // ============================================================
  // ANNOTATION MAPPING [AC-33]
  // ============================================================

  describe('annotation mapping [AC-33]', () => {
    it('annotations.description maps to descriptor.description', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          name: {
            typeName: 'string',
            annotations: { description: 'User name' },
          },
        })
      );
      expect(schema['name']?.description).toBe('User name');
    });

    it('non-string description annotation is not mapped', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          count: { typeName: 'number', annotations: { description: 42 } },
        })
      );
      expect(schema['count']?.description).toBeUndefined();
    });

    it('annotations.default maps to descriptor.default', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          count: { typeName: 'number', annotations: { default: 42 } },
        })
      );
      expect(schema['count']?.default).toBe(42);
    });

    it('annotations.default of false is included (falsy default)', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          active: { typeName: 'bool', annotations: { default: false } },
        })
      );
      expect(schema['active']?.default).toBe(false);
    });

    it('annotations.default of 0 is included (falsy number default)', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          count: { typeName: 'number', annotations: { default: 0 } },
        })
      );
      expect(schema['count']?.default).toBe(0);
    });

    it('missing default annotation does not set descriptor.default', () => {
      const schema = rillShapeToInputSchema(
        makeShape({ name: { typeName: 'string', annotations: {} } })
      );
      expect(
        Object.prototype.hasOwnProperty.call(schema['name'], 'default')
      ).toBe(false);
    });
  });

  // ============================================================
  // MULTIPLE FIELDS [AC-33]
  // ============================================================

  describe('multiple fields [AC-33]', () => {
    it('maps all fields in the shape', () => {
      const schema = rillShapeToInputSchema(
        makeShape({
          name: { typeName: 'string', optional: false },
          age: { typeName: 'number', optional: true },
          active: { typeName: 'bool', optional: false },
        })
      );
      expect(Object.keys(schema)).toHaveLength(3);
      expect(schema['name']?.type).toBe('string');
      expect(schema['age']?.type).toBe('number');
      expect(schema['active']?.type).toBe('bool');
    });

    it('returns empty object for a shape with no fields', () => {
      const schema = rillShapeToInputSchema(makeShape({}));
      expect(schema).toEqual({});
    });
  });

  // ============================================================
  // UNSUPPORTED TYPES THROW RuntimeError [EC-9]
  // ============================================================

  describe('unsupported field types throw RuntimeError [EC-9]', () => {
    it('closure field type throws RuntimeError', () => {
      const shape = makeShape({ fn: { typeName: 'closure' } });
      expect(() => rillShapeToInputSchema(shape)).toThrow(RuntimeError);
    });

    it('closure field type error has errorId RILL-R004', () => {
      const shape = makeShape({ fn: { typeName: 'closure' } });
      let thrown: unknown;
      try {
        rillShapeToInputSchema(shape);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('tuple field type throws RuntimeError', () => {
      const shape = makeShape({ t: { typeName: 'tuple' } });
      expect(() => rillShapeToInputSchema(shape)).toThrow(RuntimeError);
    });

    it('tuple field type error has errorId RILL-R004', () => {
      const shape = makeShape({ t: { typeName: 'tuple' } });
      let thrown: unknown;
      try {
        rillShapeToInputSchema(shape);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('stops at first invalid field (does not process remaining fields)', () => {
      // closure comes before a valid string field
      const shape = makeShape({
        fn: { typeName: 'closure' },
        name: { typeName: 'string' },
      });
      expect(() => rillShapeToInputSchema(shape)).toThrow(RuntimeError);
    });
  });
});

// ============================================================
// rillShapeToOutputSchema
// ============================================================

describe('rillShapeToOutputSchema', () => {
  // ============================================================
  // OUTPUT SHAPE STRUCTURE [AC-33]
  // ============================================================

  describe('output schema structure [AC-33]', () => {
    it('always produces top-level type "dict"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ name: { typeName: 'string' } })
      );
      expect(schema.type).toBe('dict');
    });

    it('places field descriptors under schema.fields', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ name: { typeName: 'string' } })
      );
      expect(schema.fields).toBeDefined();
      expect(schema.fields?.['name']).toBeDefined();
    });

    it('maps "string" typeName to field type "string"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ name: { typeName: 'string' } })
      );
      expect(schema.fields?.['name']?.type).toBe('string');
    });

    it('maps "number" typeName to field type "number"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ score: { typeName: 'number' } })
      );
      expect(schema.fields?.['score']?.type).toBe('number');
    });

    it('maps "bool" typeName to field type "bool"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ flag: { typeName: 'bool' } })
      );
      expect(schema.fields?.['flag']?.type).toBe('bool');
    });

    it('maps "list" typeName to field type "list"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ items: { typeName: 'list' } })
      );
      expect(schema.fields?.['items']?.type).toBe('list');
    });

    it('maps "dict" typeName to field type "dict"', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ data: { typeName: 'dict' } })
      );
      expect(schema.fields?.['data']?.type).toBe('dict');
    });
  });

  // ============================================================
  // ANNOTATION MAPPING [AC-33]
  // ============================================================

  describe('annotation mapping [AC-33]', () => {
    it('description annotation maps to field description', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({
          name: {
            typeName: 'string',
            annotations: { description: 'The name' },
          },
        })
      );
      expect(schema.fields?.['name']?.description).toBe('The name');
    });

    it('non-string description annotation is not mapped', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({
          count: { typeName: 'number', annotations: { description: 99 } },
        })
      );
      expect(schema.fields?.['count']?.description).toBeUndefined();
    });

    it('missing description produces no description on field', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ name: { typeName: 'string', annotations: {} } })
      );
      expect(schema.fields?.['name']?.description).toBeUndefined();
    });
  });

  // ============================================================
  // NESTED SHAPE RECURSION [AC-33]
  // ============================================================

  describe('nested shape recursion [AC-33]', () => {
    it('nested shape field produces nested fields record', () => {
      const innerShape = makeShape({ city: { typeName: 'string' } });
      const schema = rillShapeToOutputSchema(
        makeShape({
          address: { typeName: 'shape', nestedShape: innerShape },
        })
      );
      expect(schema.fields?.['address']?.fields?.['city']?.type).toBe('string');
    });

    it('non-shape field with no nestedShape has no fields entry', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({ name: { typeName: 'string' } })
      );
      expect(schema.fields?.['name']?.fields).toBeUndefined();
    });
  });

  // ============================================================
  // MULTIPLE FIELDS [AC-33]
  // ============================================================

  describe('multiple fields [AC-33]', () => {
    it('maps all fields in the shape to output schema', () => {
      const schema = rillShapeToOutputSchema(
        makeShape({
          name: { typeName: 'string' },
          score: { typeName: 'number' },
        })
      );
      expect(Object.keys(schema.fields ?? {})).toHaveLength(2);
    });

    it('returns dict with empty fields for a shape with no fields', () => {
      const schema = rillShapeToOutputSchema(makeShape({}));
      expect(schema.type).toBe('dict');
      expect(schema.fields).toEqual({});
    });
  });

  // ============================================================
  // UNSUPPORTED TYPES THROW RuntimeError [EC-9]
  // ============================================================

  describe('unsupported field types throw RuntimeError [EC-9]', () => {
    it('closure field type throws RuntimeError', () => {
      const shape = makeShape({ fn: { typeName: 'closure' } });
      expect(() => rillShapeToOutputSchema(shape)).toThrow(RuntimeError);
    });

    it('closure field type error has errorId RILL-R004', () => {
      const shape = makeShape({ fn: { typeName: 'closure' } });
      let thrown: unknown;
      try {
        rillShapeToOutputSchema(shape);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('tuple field type throws RuntimeError', () => {
      const shape = makeShape({ t: { typeName: 'tuple' } });
      expect(() => rillShapeToOutputSchema(shape)).toThrow(RuntimeError);
    });

    it('tuple field type error has errorId RILL-R004', () => {
      const shape = makeShape({ t: { typeName: 'tuple' } });
      let thrown: unknown;
      try {
        rillShapeToOutputSchema(shape);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });
  });
});
