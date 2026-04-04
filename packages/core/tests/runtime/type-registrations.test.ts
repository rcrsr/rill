/**
 * Tests for type-registrations.ts dispatch functions and error contracts.
 *
 * AC-1:  BUILT_IN_TYPES has exactly 12 entries, each with unique name
 * AC-2:  inferType returns same type name as existing inferType from values.ts
 * AC-5:  formatValue output matches existing formatValue from values.ts
 * AC-10: copyValue returns same reference for immutable, independent copy for mutable
 * BC-1:  inferType(null) returns 'string'
 * BC-2:  Vector identified before dict fallback
 * BC-3:  deepEquals works on types with eq but no compare
 * BC-4:  dict registration has convertTo defined
 * EC-1:  Validator detects duplicate type names
 * EC-2:  Validator detects missing protocol.format
 * EC-3:  deepEquals on two iterators returns false (no protocol.eq)
 * EC-4:  Bool registration has no protocol.compare
 * EC-8:  serializeValue on closure throws Error with 'closures are not JSON-serializable'
 * EC-9:  deserializeValue with unrecognized type name raises RILL-R004
 * EC-10: deserializeValue(null, 'number') raises RILL-R004
 *
 * Integration tests (rill script execution):
 * AC-9:  json built-in serializes dict, list, string, number, bool correctly
 * EC-3:  iterator == iterator raises RILL-R002 via script execution
 * EC-4:  true > false raises RILL-R002 via script execution (breaking change)
 * EC-5:  :> unsupported target raises RILL-R036 via script execution
 * EC-6:  "abc" :> number raises RILL-R038 via script execution
 * EC-7:  json(closure) raises RILL-R004 via script execution
 * BC-3:  list eq works, list ordering raises RILL-R002 via script execution
 * BC-4:  type with undefined convertTo has no conversions (field_descriptor)
 * BC-5:  Derived collections frozen after context creation
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TYPES,
  callable,
  copyValue,
  createOrdered,
  createRuntimeContext,
  createTuple,
  createVector,
  deepEquals as newDeepEquals,
  deserializeValue,
  formatValue as newFormatValue,
  inferType as newInferType,
  isIterator,
  RuntimeError,
  serializeValue,
  type RillTypeValue,
  type RillValue,
  type TypeDefinition,
  type TypeProtocol,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// Old implementations from values.ts for comparison.
// These remain as internal imports because they verify parity between
// the legacy values.ts functions and the new type-registrations dispatch.
import {
  inferType as oldInferType,
  formatValue as oldFormatValue,
} from '../../src/runtime/core/values.js';

// ============================================================
// Test Value Fixtures
// ============================================================

/** Construct a minimal RillTypeValue for testing. */
function makeTypeValue(typeName: string): RillTypeValue {
  return {
    __rill_type: true as const,
    typeName: typeName as RillTypeValue['typeName'],
    structure: {
      kind: typeName as RillTypeValue['typeName'],
    } as RillTypeValue['structure'],
  };
}

/** Construct a minimal iterator for testing. */
function makeIterator(
  done: boolean,
  value?: RillValue
): Record<string, RillValue> {
  const nextFn = callable(() => makeIterator(true) as RillValue);
  const iter: Record<string, RillValue> = {
    done,
    next: nextFn,
  };
  if (!done && value !== undefined) {
    iter['value'] = value;
  }
  return iter;
}

// ============================================================
// Validator Helpers (EC-1, EC-2)
// ============================================================

/**
 * Validate a set of type registrations for duplicate names.
 * Throws if any two registrations share the same name.
 */
function validateNoDuplicateNames(
  registrations: readonly TypeDefinition[]
): void {
  const seen = new Set<string>();
  for (const reg of registrations) {
    if (seen.has(reg.name)) {
      throw new Error(`Duplicate type registration '${reg.name}'`);
    }
    seen.add(reg.name);
  }
}

/**
 * Validate that every registration has a protocol.format function.
 * Throws if any registration lacks protocol.format.
 */
function validateRequiredProtocols(
  registrations: readonly TypeDefinition[]
): void {
  for (const reg of registrations) {
    if (!reg.protocol.format) {
      throw new Error(`Type '${reg.name}' missing required format protocol`);
    }
  }
}

// ============================================================
// Representative test values for all 12 types
// ============================================================

const testValues: { typeName: string; value: RillValue }[] = [
  { typeName: 'string', value: 'hello' },
  { typeName: 'number', value: 42 },
  { typeName: 'bool', value: true },
  { typeName: 'tuple', value: createTuple([1, 2, 3]) },
  {
    typeName: 'ordered',
    value: createOrdered([
      ['a', 1],
      ['b', 2],
    ]),
  },
  {
    typeName: 'vector',
    value: createVector(new Float32Array([0.1, 0.2, 0.3]), 'test-model'),
  },
  { typeName: 'type', value: makeTypeValue('string') },
  { typeName: 'closure', value: callable(() => 'test') },
  {
    typeName: 'field_descriptor',
    value: { __rill_field_descriptor: true } as unknown as RillValue,
  },
  { typeName: 'iterator', value: makeIterator(false, 1) as RillValue },
  { typeName: 'list', value: [1, 2, 3] },
  { typeName: 'dict', value: { a: 1, b: 2 } },
];

/**
 * Values shared between old and new implementations.
 * Excludes field_descriptor, which is a new registration not
 * recognized by the old values.ts inferType/formatValue.
 */
const sharedTestValues = testValues.filter(
  (v) => v.typeName !== 'field_descriptor'
);

// ============================================================
// Tests
// ============================================================

describe('type-registrations', () => {
  // AC-1: BUILT_IN_TYPES has exactly 15 entries, each with unique name
  describe('AC-1: BUILT_IN_TYPES registry', () => {
    it('has exactly 15 entries', () => {
      expect(BUILT_IN_TYPES).toHaveLength(15);
    });

    it('has unique names for all entries', () => {
      const names = BUILT_IN_TYPES.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(15);
    });
  });

  // AC-2: inferType returns same type name as existing inferType from values.ts
  // Excludes field_descriptor (new registration, old values.ts returns 'dict')
  describe('AC-2: inferType parity with values.ts', () => {
    for (const { typeName, value } of sharedTestValues) {
      it(`returns '${typeName}' for ${typeName} value`, () => {
        const newResult = newInferType(value);
        const oldResult = oldInferType(value);
        expect(newResult).toBe(oldResult);
      });
    }

    it('returns field_descriptor for field_descriptor value', () => {
      const fd = {
        __rill_field_descriptor: true,
      } as unknown as RillValue;
      expect(newInferType(fd)).toBe('field_descriptor');
    });
  });

  // AC-5: formatValue output matches existing formatValue from values.ts
  // Excludes field_descriptor (new registration, old values.ts formats as dict)
  describe('AC-5: formatValue parity with values.ts', () => {
    for (const { typeName, value } of sharedTestValues) {
      it(`matches for ${typeName} value`, () => {
        const newResult = newFormatValue(value);
        const oldResult = oldFormatValue(value);
        expect(newResult).toBe(oldResult);
      });
    }

    it('formats field_descriptor as type(field_descriptor)', () => {
      const fd = {
        __rill_field_descriptor: true,
      } as unknown as RillValue;
      expect(newFormatValue(fd)).toBe('type(field_descriptor)');
    });
  });

  // AC-10: copyValue returns same reference for immutable, independent copy for mutable
  describe('AC-10: copyValue immutable vs mutable', () => {
    it('returns same reference for string', () => {
      const value = 'hello';
      expect(copyValue(value)).toBe(value);
    });

    it('returns same reference for number', () => {
      const value = 42;
      expect(copyValue(value)).toBe(value);
    });

    it('returns same reference for bool', () => {
      const value = true;
      expect(copyValue(value)).toBe(value);
    });

    it('returns independent copy for list', () => {
      const value = [1, 2, 3];
      const copied = copyValue(value);
      expect(copied).toEqual(value);
      expect(copied).not.toBe(value);
    });

    it('returns independent copy for dict', () => {
      const value = { a: 1, b: 2 };
      const copied = copyValue(value);
      expect(copied).toEqual(value);
      expect(copied).not.toBe(value);
    });
  });

  // BC-1: inferType(null) returns 'string'
  describe('BC-1: null type inference', () => {
    it('returns string for null', () => {
      expect(newInferType(null)).toBe('string');
    });
  });

  // BC-2: Vector identified before dict fallback
  describe('BC-2: vector registration order', () => {
    it('resolves a vector value as vector, not dict', () => {
      const vec = createVector(new Float32Array([1, 2, 3]), 'model');
      expect(newInferType(vec)).toBe('vector');
    });

    it('vector registration appears before dict in BUILT_IN_TYPES', () => {
      const vectorIdx = BUILT_IN_TYPES.findIndex((t) => t.name === 'vector');
      const dictIdx = BUILT_IN_TYPES.findIndex((t) => t.name === 'dict');
      expect(vectorIdx).toBeLessThan(dictIdx);
    });
  });

  // BC-3: Types with eq but no compare
  describe('BC-3: eq without compare', () => {
    it('deepEquals works for bool (has eq, no compare)', () => {
      expect(newDeepEquals(true, true)).toBe(true);
      expect(newDeepEquals(true, false)).toBe(false);
    });

    it('deepEquals works for list (has eq, no compare)', () => {
      expect(newDeepEquals([1, 2], [1, 2])).toBe(true);
      expect(newDeepEquals([1, 2], [1, 3])).toBe(false);
    });

    it('deepEquals works for tuple (has eq, no compare)', () => {
      const t1 = createTuple([1, 2]);
      const t2 = createTuple([1, 2]);
      const t3 = createTuple([1, 3]);
      expect(newDeepEquals(t1, t2)).toBe(true);
      expect(newDeepEquals(t1, t3)).toBe(false);
    });

    it('bool registration has no protocol.compare', () => {
      const boolReg = BUILT_IN_TYPES.find((t) => t.name === 'bool');
      expect(boolReg).toBeDefined();
      expect(boolReg!.protocol.compare).toBeUndefined();
    });

    it('list registration has no protocol.compare', () => {
      const listReg = BUILT_IN_TYPES.find((t) => t.name === 'list');
      expect(listReg).toBeDefined();
      expect(listReg!.protocol.compare).toBeUndefined();
    });

    it('tuple registration has no protocol.compare', () => {
      const tupleReg = BUILT_IN_TYPES.find((t) => t.name === 'tuple');
      expect(tupleReg).toBeDefined();
      expect(tupleReg!.protocol.compare).toBeUndefined();
    });
  });

  // BC-4: convertTo presence determines conversion availability
  describe('BC-4: convertTo availability', () => {
    it('dict registration has a convertTo record', () => {
      const dictReg = BUILT_IN_TYPES.find((t) => t.name === 'dict');
      expect(dictReg).toBeDefined();
      expect(dictReg!.protocol.convertTo).toBeDefined();
      expect(typeof dictReg!.protocol.convertTo).toBe('object');
    });

    it('field_descriptor has no convertTo (undefined)', () => {
      const fdReg = BUILT_IN_TYPES.find((t) => t.name === 'field_descriptor');
      expect(fdReg).toBeDefined();
      expect(fdReg!.protocol.convertTo).toBeUndefined();
    });
  });

  // EC-1: Validator detects duplicate type names
  describe('EC-1: duplicate name detection', () => {
    it('passes for BUILT_IN_TYPES (no duplicates)', () => {
      expect(() => validateNoDuplicateNames(BUILT_IN_TYPES)).not.toThrow();
    });

    it('throws for registrations with duplicate names', () => {
      const withDuplicate: TypeDefinition[] = [
        {
          name: 'string',
          identity: () => false,
          isLeaf: true,
          immutable: true,
          methods: {},
          protocol: { format: () => '' },
        },
        {
          name: 'string',
          identity: () => false,
          isLeaf: true,
          immutable: true,
          methods: {},
          protocol: { format: () => '' },
        },
      ];
      expect(() => validateNoDuplicateNames(withDuplicate)).toThrow(
        "Duplicate type registration 'string'"
      );
    });
  });

  // EC-2: Validator detects missing protocol.format
  describe('EC-2: missing format protocol detection', () => {
    it('passes for BUILT_IN_TYPES (all have format)', () => {
      expect(() => validateRequiredProtocols(BUILT_IN_TYPES)).not.toThrow();
    });

    it('throws for registration missing protocol.format', () => {
      const missingFormat: TypeDefinition[] = [
        {
          name: 'bad_type',
          identity: () => false,
          isLeaf: true,
          immutable: true,
          methods: {},
          protocol: {} as TypeProtocol,
        },
      ];
      expect(() => validateRequiredProtocols(missingFormat)).toThrow(
        "Type 'bad_type' missing required format protocol"
      );
    });
  });

  // EC-3: deepEquals on two iterators returns false (no protocol.eq)
  describe('EC-3: iterator equality', () => {
    it('returns false for two iterators (no protocol.eq)', () => {
      const iter1 = makeIterator(false, 1);
      const iter2 = makeIterator(false, 1);

      // Confirm they are iterators
      expect(isIterator(iter1 as RillValue)).toBe(true);
      expect(isIterator(iter2 as RillValue)).toBe(true);

      // deepEquals returns false because iterator has no protocol.eq
      expect(newDeepEquals(iter1 as RillValue, iter2 as RillValue)).toBe(false);
    });

    it('iterator registration has no protocol.eq', () => {
      const iterReg = BUILT_IN_TYPES.find((t) => t.name === 'iterator');
      expect(iterReg).toBeDefined();
      expect(iterReg!.protocol.eq).toBeUndefined();
    });
  });

  // EC-4: Bool has no protocol.compare (ordering unsupported)
  describe('EC-4: bool compare', () => {
    it('bool registration has no protocol.compare', () => {
      const boolReg = BUILT_IN_TYPES.find((t) => t.name === 'bool');
      expect(boolReg).toBeDefined();
      expect(boolReg!.protocol.compare).toBeUndefined();
    });
  });

  // EC-8: serializeValue on non-serializable types throws RuntimeError (RILL-R067)
  describe('EC-8: non-serializable type errors', () => {
    it('throws RuntimeError for closure', () => {
      const closureValue = callable(() => 'test');
      expect(() => serializeValue(closureValue)).toThrow(RuntimeError);
      expect(() => serializeValue(closureValue)).toThrow(
        'closures are not JSON-serializable'
      );
    });

    it('closure error is RuntimeError with RILL-R067', () => {
      const closureValue = callable(() => 'test');
      try {
        serializeValue(closureValue);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe('closures are not JSON-serializable');
      }
    });

    it('throws RuntimeError for tuple', () => {
      const tuple = createTuple([1, 2, 3]);
      try {
        serializeValue(tuple);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe('tuples are not JSON-serializable');
      }
    });

    it('throws RuntimeError for ordered', () => {
      const ordered = createOrdered([
        ['a', 1],
        ['b', 2],
      ]);
      try {
        serializeValue(ordered);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe(
          'ordered values are not JSON-serializable'
        );
      }
    });

    it('throws RuntimeError for vector', () => {
      const vec = createVector(new Float32Array([0.1, 0.2]), 'test-model');
      try {
        serializeValue(vec);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe('vectors are not JSON-serializable');
      }
    });

    it('throws RuntimeError for type value', () => {
      const typeVal = makeTypeValue('string');
      try {
        serializeValue(typeVal as RillValue);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe(
          'type values are not JSON-serializable'
        );
      }
    });

    it('throws RuntimeError for iterator', () => {
      const iter = makeIterator(false, 1);
      try {
        serializeValue(iter as RillValue);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R067');
        expect((e as Error).message).toBe(
          'iterators are not JSON-serializable'
        );
      }
    });
  });

  // EC-9: deserializeValue with invalid data raises RILL-R004
  describe('EC-9: deserialize invalid data', () => {
    it('throws RILL-R004 for unrecognized type name', () => {
      expect(() => deserializeValue('bad', 'nonexistent_type')).toThrow(
        RuntimeError
      );
      try {
        deserializeValue('bad', 'nonexistent_type');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R004');
      }
    });

    it('error message contains "Cannot deserialize as" for unrecognized type', () => {
      try {
        deserializeValue('bad', 'nonexistent_type');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as RuntimeError).message).toContain(
          'Cannot deserialize as nonexistent_type'
        );
      }
    });
  });

  // EC-10: deserializeValue(null, 'number') raises RILL-R004
  describe('EC-10: deserialize null', () => {
    it('throws RILL-R004 for null input', () => {
      expect(() => deserializeValue(null, 'number')).toThrow(RuntimeError);
      try {
        deserializeValue(null, 'number');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RuntimeError);
        expect((e as RuntimeError).errorId).toBe('RILL-R004');
      }
    });

    it('error message contains "Cannot deserialize null as number"', () => {
      try {
        deserializeValue(null, 'number');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as RuntimeError).message).toContain(
          'Cannot deserialize null as number'
        );
      }
    });
  });

  // ============================================================
  // Integration Tests: Protocol Dispatch via Script Execution
  // ============================================================

  // AC-9: json built-in uses protocol.serialize for all serializable types
  describe('AC-9 integration: json built-in serialization', () => {
    it('serializes a dict to valid JSON', async () => {
      const result = await run('dict[key: "val"] -> json');
      expect(result).toBe('{"key":"val"}');
    });

    it('serializes a list to valid JSON', async () => {
      const result = await run('list[1, 2, 3] -> json');
      expect(result).toBe('[1,2,3]');
    });

    it('serializes a string to valid JSON', async () => {
      const result = await run('"hello" -> json');
      expect(result).toBe('"hello"');
    });

    it('serializes a number to valid JSON', async () => {
      const result = await run('42 -> json');
      expect(result).toBe('42');
    });

    it('serializes a bool to valid JSON', async () => {
      const result = await run('true -> json');
      expect(result).toBe('true');
    });

    it('serializes nested dict with list to valid JSON', async () => {
      const result = await run('dict[items: list[1, 2]] -> json');
      expect(result).toBe('{"items":[1,2]}');
    });
  });

  // EC-3: iterator == iterator raises RILL-R002 via rill script execution
  describe('EC-3 integration: iterator equality raises RILL-R002', () => {
    it('raises RILL-R002 when comparing iterators with ==', async () => {
      await expect(run('range(1, 3) == range(1, 3)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('error message contains "Cannot compare"', async () => {
      await expect(run('range(1, 3) == range(1, 3)')).rejects.toThrow(
        /Cannot compare/
      );
    });
  });

  // EC-4: true > false raises RILL-R002 via rill script execution (breaking change)
  describe('EC-4 integration: bool ordering raises RILL-R002', () => {
    it('raises RILL-R002 when comparing booleans with >', async () => {
      await expect(run('true > false')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('error message contains "Cannot compare"', async () => {
      await expect(run('true > false')).rejects.toThrow(/Cannot compare/);
    });
  });

  // EC-5: :> unsupported target raises RILL-R036 via rill script execution
  describe('EC-5 integration: unsupported conversion raises RILL-R036', () => {
    it('raises RILL-R036 for number -> :>bool', async () => {
      await expect(run('42 -> :>bool')).rejects.toHaveProperty(
        'errorId',
        'RILL-R036'
      );
    });

    it('error message contains "cannot convert"', async () => {
      await expect(run('42 -> :>bool')).rejects.toThrow(/cannot convert/);
    });
  });

  // EC-6 (RI table): "abc" :> number raises RILL-R038 via rill script execution
  describe('EC-6 integration: string-to-number parse failure raises RILL-R038', () => {
    it('raises RILL-R038 for non-numeric string to number', async () => {
      await expect(run('"abc" -> :>number')).rejects.toHaveProperty(
        'errorId',
        'RILL-R038'
      );
    });

    it('error message contains "cannot convert"', async () => {
      await expect(run('"abc" -> :>number')).rejects.toThrow(/cannot convert/);
    });
  });

  // EC-7: json built-in on non-serializable type raises RILL-R004
  describe('EC-7 integration: json on non-serializable raises RILL-R004', () => {
    it('raises RILL-R004 for closure passed to json', async () => {
      await expect(run('||{ "test" } -> json')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });

    it('error message contains "not JSON-serializable"', async () => {
      await expect(run('||{ "test" } -> json')).rejects.toThrow(
        /not JSON-serializable/
      );
    });
  });

  // BC-3 integration: list eq works, list ordering raises RILL-R002
  describe('BC-3 integration: eq without compare via script', () => {
    it('list equality succeeds via ==', async () => {
      expect(await run('list[1, 2] == list[1, 2]')).toBe(true);
    });

    it('list inequality succeeds via !=', async () => {
      expect(await run('list[1, 2] != list[3, 4]')).toBe(true);
    });

    it('list ordering raises RILL-R002 via >', async () => {
      await expect(run('list[1, 2] > list[3, 4]')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('list ordering error contains "Cannot compare"', async () => {
      await expect(run('list[1, 2] > list[3, 4]')).rejects.toThrow(
        /Cannot compare/
      );
    });
  });

  // BC-5: Derived collections frozen after context creation
  describe('BC-5: derived collections are frozen after context creation', () => {
    it('leafTypes is frozen', () => {
      const ctx = createRuntimeContext();
      expect(Object.isFrozen(ctx.leafTypes)).toBe(true);
    });

    it('typeMethodDicts is frozen', () => {
      const ctx = createRuntimeContext();
      expect(Object.isFrozen(ctx.typeMethodDicts)).toBe(true);
    });
  });
});
