/**
 * Unit tests for buildJsonSchema.
 *
 * Covers all 6 rill type mappings, descriptor forms, nesting, enum constraints,
 * empty schema, and all error contracts (EC-1, EC-2).
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { buildJsonSchema } from '../src/schema.js';

// ============================================================
// ALL 6 RILL TYPES (AC-15, AC-30)
// ============================================================

describe('buildJsonSchema', () => {
  describe('AC-15: all 6 rill types map correctly', () => {
    it('maps string to JSON Schema type "string"', () => {
      const result = buildJsonSchema({ name: 'string' });
      expect(result.properties['name']?.type).toBe('string');
    });

    it('maps number to JSON Schema type "number"', () => {
      const result = buildJsonSchema({ count: 'number' });
      expect(result.properties['count']?.type).toBe('number');
    });

    it('maps bool to JSON Schema type "boolean"', () => {
      const result = buildJsonSchema({ active: 'bool' });
      expect(result.properties['active']?.type).toBe('boolean');
    });

    it('maps list to JSON Schema type "array"', () => {
      const result = buildJsonSchema({ tags: 'list' });
      expect(result.properties['tags']?.type).toBe('array');
    });

    it('maps dict to JSON Schema type "object"', () => {
      const result = buildJsonSchema({ meta: 'dict' });
      expect(result.properties['meta']?.type).toBe('object');
    });

    it('maps vector to JSON Schema type "object"', () => {
      // AC-16: vector is a special case that maps to object
      const result = buildJsonSchema({ embedding: 'vector' });
      expect(result.properties['embedding']?.type).toBe('object');
    });
  });

  // ============================================================
  // AC-16: VECTOR MAPS TO OBJECT (explicit)
  // ============================================================

  describe('AC-16: vector maps to object', () => {
    it('buildJsonSchema({embedding: "vector"}) returns properties.embedding.type === "object"', () => {
      const result = buildJsonSchema({ embedding: 'vector' });
      expect(result.properties['embedding']?.type).toBe('object');
    });
  });

  // ============================================================
  // AC-28: EMPTY SCHEMA
  // ============================================================

  describe('AC-28: empty schema produces valid JSON Schema', () => {
    it('returns type "object" for empty input', () => {
      const result = buildJsonSchema({});
      expect(result.type).toBe('object');
    });

    it('returns empty properties for empty input', () => {
      const result = buildJsonSchema({});
      expect(result.properties).toEqual({});
    });

    it('returns empty required array for empty input', () => {
      const result = buildJsonSchema({});
      expect(result.required).toEqual([]);
    });
  });

  // ============================================================
  // REQUIRED ARRAY
  // ============================================================

  describe('required array includes all top-level keys', () => {
    it('lists all keys in required', () => {
      const result = buildJsonSchema({ name: 'string', age: 'number' });
      expect(result.required).toContain('name');
      expect(result.required).toContain('age');
      expect(result.required).toHaveLength(2);
    });

    it('preserves insertion order in required', () => {
      const result = buildJsonSchema({ a: 'string', b: 'number', c: 'bool' });
      expect(result.required).toEqual(['a', 'b', 'c']);
    });
  });

  // ============================================================
  // AC-2: FULL DESCRIPTOR DICT WITH DESCRIPTION
  // ============================================================

  describe('AC-2: full descriptor dict forwards description', () => {
    it('includes description in property schema', () => {
      const result = buildJsonSchema({
        name: { type: 'string', description: 'Full name' },
      });
      expect(result.properties['name']?.description).toBe('Full name');
    });

    it('includes type alongside description', () => {
      const result = buildJsonSchema({
        name: { type: 'string', description: 'Full name' },
      });
      expect(result.properties['name']?.type).toBe('string');
    });

    it('omits description when not provided in simple string form', () => {
      const result = buildJsonSchema({ name: 'string' });
      expect(result.properties['name']?.description).toBeUndefined();
    });
  });

  // ============================================================
  // AC-5: ENUM CONSTRAINT ON STRING
  // ============================================================

  describe('AC-5: enum constraint included in provider schema', () => {
    it('includes enum values in property schema', () => {
      const result = buildJsonSchema({
        status: { type: 'string', enum: ['active', 'inactive'] },
      });
      expect(result.properties['status']?.enum).toEqual(['active', 'inactive']);
    });

    it('preserves enum array order', () => {
      const result = buildJsonSchema({
        color: { type: 'string', enum: ['red', 'green', 'blue'] },
      });
      expect(result.properties['color']?.enum).toEqual([
        'red',
        'green',
        'blue',
      ]);
    });

    it('allows single-value enum', () => {
      const result = buildJsonSchema({
        role: { type: 'string', enum: ['admin'] },
      });
      expect(result.properties['role']?.enum).toEqual(['admin']);
    });
  });

  // ============================================================
  // LIST WITH ITEMS
  // ============================================================

  describe('list with items sub-schema', () => {
    it('builds items sub-schema for list with string items', () => {
      const result = buildJsonSchema({
        tags: { type: 'list', items: 'string' },
      });
      expect(result.properties['tags']?.type).toBe('array');
      expect(result.properties['tags']?.items?.type).toBe('string');
    });

    it('builds items sub-schema for list with number items', () => {
      const result = buildJsonSchema({
        scores: { type: 'list', items: 'number' },
      });
      expect(result.properties['scores']?.items?.type).toBe('number');
    });
  });

  // ============================================================
  // AC-29: NESTED DICT (RECURSIVE)
  // ============================================================

  describe('AC-29: nested dict produces recursive JSON Schema', () => {
    it('builds nested properties for dict with properties', () => {
      const result = buildJsonSchema({
        addr: {
          type: 'dict',
          properties: { city: 'string', zip: 'number' },
        },
      });
      const addr = result.properties['addr'];
      expect(addr?.type).toBe('object');
      expect(addr?.properties?.['city']?.type).toBe('string');
      expect(addr?.properties?.['zip']?.type).toBe('number');
    });

    it('includes required array in nested dict', () => {
      const result = buildJsonSchema({
        addr: {
          type: 'dict',
          properties: { city: 'string', zip: 'number' },
        },
      });
      const addr = result.properties['addr'];
      expect(addr?.required).toContain('city');
      expect(addr?.required).toContain('zip');
    });

    it('builds deeply nested dict (dict within dict within dict)', () => {
      const result = buildJsonSchema({
        level1: {
          type: 'dict',
          properties: {
            level2: {
              type: 'dict',
              properties: {
                level3: {
                  type: 'dict',
                  properties: { value: 'string' },
                },
              },
            },
          },
        },
      });

      const level1 = result.properties['level1'];
      expect(level1?.type).toBe('object');

      const level2 = level1?.properties?.['level2'];
      expect(level2?.type).toBe('object');

      const level3 = level2?.properties?.['level3'];
      expect(level3?.type).toBe('object');
      expect(level3?.properties?.['value']?.type).toBe('string');
    });
  });

  // ============================================================
  // AC-30: ALL 6 TYPES IN ONE DICT
  // ============================================================

  describe('AC-30: schema with all 6 supported types produces valid JSON Schema', () => {
    it('builds valid schema with all 6 rill types as top-level keys', () => {
      const result = buildJsonSchema({
        label: 'string',
        score: 'number',
        active: 'bool',
        tags: 'list',
        meta: 'dict',
        embedding: 'vector',
      });

      expect(result.type).toBe('object');
      expect(result.properties['label']?.type).toBe('string');
      expect(result.properties['score']?.type).toBe('number');
      expect(result.properties['active']?.type).toBe('boolean');
      expect(result.properties['tags']?.type).toBe('array');
      expect(result.properties['meta']?.type).toBe('object');
      expect(result.properties['embedding']?.type).toBe('object');
    });

    it('includes all 6 keys in required array', () => {
      const result = buildJsonSchema({
        label: 'string',
        score: 'number',
        active: 'bool',
        tags: 'list',
        meta: 'dict',
        embedding: 'vector',
      });

      expect(result.required).toHaveLength(6);
      expect(result.required).toContain('label');
      expect(result.required).toContain('score');
      expect(result.required).toContain('active');
      expect(result.required).toContain('tags');
      expect(result.required).toContain('meta');
      expect(result.required).toContain('embedding');
    });
  });

  // ============================================================
  // additionalProperties: false (OpenAI strict mode / Groq requirement)
  // ============================================================

  describe('additionalProperties: false on all object types', () => {
    it('sets additionalProperties: false on top-level schema', () => {
      const result = buildJsonSchema({ name: 'string' });
      expect(result.additionalProperties).toBe(false);
    });

    it('sets additionalProperties: false on empty schema', () => {
      const result = buildJsonSchema({});
      expect(result.additionalProperties).toBe(false);
    });

    it('sets additionalProperties: false on nested dict property', () => {
      const result = buildJsonSchema({
        addr: {
          type: 'dict',
          properties: { city: 'string', zip: 'number' },
        },
      });
      expect(result.properties['addr']?.additionalProperties).toBe(false);
    });

    it('sets additionalProperties: false on deeply nested dict', () => {
      const result = buildJsonSchema({
        level1: {
          type: 'dict',
          properties: {
            level2: {
              type: 'dict',
              properties: { value: 'string' },
            },
          },
        },
      });
      const level1 = result.properties['level1'];
      expect(level1?.additionalProperties).toBe(false);
      expect(level1?.properties?.['level2']?.additionalProperties).toBe(false);
    });

    it('does not set additionalProperties on non-object property types', () => {
      const result = buildJsonSchema({ name: 'string', count: 'number' });
      expect(result.properties['name']?.additionalProperties).toBeUndefined();
      expect(result.properties['count']?.additionalProperties).toBeUndefined();
    });

    it('does not set additionalProperties on dict property without nested properties', () => {
      const result = buildJsonSchema({ meta: 'dict' });
      expect(result.properties['meta']?.additionalProperties).toBeUndefined();
    });
  });

  // ============================================================
  // EC-1: UNSUPPORTED TYPE THROWS RILL-R004 (AC-19, AC-20)
  // ============================================================

  describe('EC-1: unsupported type throws RuntimeError RILL-R004', () => {
    it('AC-19: throws for "timestamp" type', () => {
      // AC-19: schema: {ts: "timestamp"} throws RILL-R004 before any HTTP call
      expect(() => buildJsonSchema({ ts: 'timestamp' })).toThrow(RuntimeError);
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchema({ ts: 'timestamp' });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('AC-20: throws for "integer" type', () => {
      // AC-20: schema: {count: "integer"} throws RILL-R004 before any HTTP call
      expect(() => buildJsonSchema({ count: 'integer' })).toThrow(RuntimeError);
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchema({ count: 'integer' });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('throws for unknown type "float"', () => {
      expect(() => buildJsonSchema({ x: 'float' })).toThrow(RuntimeError);
    });

    it('throws for unknown type "any"', () => {
      expect(() => buildJsonSchema({ x: 'any' })).toThrow(RuntimeError);
    });

    it('throws for unknown type in descriptor object', () => {
      expect(() =>
        buildJsonSchema({ x: { type: 'timestamp', description: 'Created at' } })
      ).toThrow(RuntimeError);
    });

    it('includes unsupported type name in error message', () => {
      expect(() => buildJsonSchema({ ts: 'timestamp' })).toThrow(
        'unsupported type: timestamp'
      );
    });
  });

  // ============================================================
  // EC-2: ENUM ON NON-STRING TYPE THROWS RILL-R004 (AC-26)
  // ============================================================

  describe('EC-2: enum on non-string type throws RuntimeError RILL-R004', () => {
    it('AC-26: throws for enum on "number" type', () => {
      expect(() =>
        buildJsonSchema({ n: { type: 'number', enum: [1, 2] } })
      ).toThrow(RuntimeError);
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchema({ n: { type: 'number', enum: [1, 2] } });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('throws for enum on "bool" type', () => {
      expect(() =>
        buildJsonSchema({ flag: { type: 'bool', enum: [true, false] } })
      ).toThrow(RuntimeError);
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchema({ flag: { type: 'bool', enum: [true, false] } });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('throws for enum on "list" type', () => {
      expect(() =>
        buildJsonSchema({ items: { type: 'list', enum: ['a', 'b'] } })
      ).toThrow(RuntimeError);
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchema({ items: { type: 'list', enum: ['a', 'b'] } });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('throws for enum on "dict" type', () => {
      expect(() =>
        buildJsonSchema({ obj: { type: 'dict', enum: ['x'] } })
      ).toThrow(RuntimeError);
    });

    it('throws for enum on "vector" type', () => {
      expect(() =>
        buildJsonSchema({ vec: { type: 'vector', enum: ['x'] } })
      ).toThrow(RuntimeError);
    });

    it('includes explanation in error message for enum on non-string', () => {
      expect(() =>
        buildJsonSchema({ n: { type: 'number', enum: [1, 2] } })
      ).toThrow('enum is only valid for string type');
    });
  });
});
