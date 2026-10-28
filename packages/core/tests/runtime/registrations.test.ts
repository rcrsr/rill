/**
 * Tests for types/registrations.ts dispatch functions and error contracts.
 *
 * BUILT_IN_TYPES has exactly 16 entries, each with unique name
 * inferType returns the documented type name for each fixture
 * formatValue returns the expected display string for each fixture
 * copyValue returns same reference for immutable, independent copy for mutable
 * BC-1:  inferType(null) returns 'string'
 * BC-2:  Vector identified before dict fallback
 * BC-3:  deepEquals works on types with eq but no compare
 * BC-4:  dict registration has convertTo defined
 * Every registration has protocol.format
 * deepEquals on two iterators returns false (no protocol.eq)
 * serializeValue on closure throws Error with 'closures are not JSON-serializable'
 * deserializeValue with unrecognized type name raises RILL-R004
 * deserializeValue(null, 'number') raises RILL-R004
 *
 * Integration tests (rill script execution):
 * json built-in serializes dict, list, string, number, bool correctly
 * iterator == iterator raises RILL-R002 via script execution
 * true > false raises RILL-R002 via script execution (breaking change)
 * -> unsupported target raises RILL-R036 via script execution
 * "abc" -> number raises RILL-R038 via script execution
 * json(closure) raises RILL-R004 via script execution
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
  RuntimeHaltSignal,
  serializeValue,
  type RillTypeValue,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import {
  expectHaltMessage,
  expectHaltMessageSync,
  expectHaltSync,
  expectHalt,
} from '../helpers/halt.js';

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
// Representative test values for all 12 types
// ============================================================

const testValues: {
  typeName: string;
  value: RillValue;
  formatted: string;
}[] = [
  { typeName: 'string', value: 'hello', formatted: 'hello' },
  { typeName: 'number', value: 42, formatted: '42' },
  { typeName: 'bool', value: true, formatted: 'true' },
  {
    typeName: 'tuple',
    value: createTuple([1, 2, 3]),
    formatted: 'tuple[1, 2, 3]',
  },
  {
    typeName: 'ordered',
    value: createOrdered([
      ['a', 1],
      ['b', 2],
    ]),
    formatted: 'ordered[a: 1, b: 2]',
  },
  {
    typeName: 'vector',
    value: createVector(new Float32Array([0.1, 0.2, 0.3]), 'test-model'),
    formatted: 'vector(test-model, 3d)',
  },
  {
    typeName: 'type',
    value: makeTypeValue('string'),
    formatted: 'string',
  },
  {
    typeName: 'closure',
    value: callable(() => 'test'),
    formatted: 'type(closure)',
  },
  {
    typeName: 'field_descriptor',
    value: { __rill_field_descriptor: true } as unknown as RillValue,
    formatted: 'type(field_descriptor)',
  },
  {
    typeName: 'iterator',
    value: makeIterator(false, 1) as RillValue,
    formatted: 'type(iterator)',
  },
  { typeName: 'list', value: [1, 2, 3], formatted: 'list[1, 2, 3]' },
  { typeName: 'dict', value: { a: 1, b: 2 }, formatted: 'dict[a: 1, b: 2]' },
];

// ============================================================
// Tests
// ============================================================

describe('types/registrations', () => {
  // BUILT_IN_TYPES has exactly 16 entries, each with unique name.
  // Task 1.2 added the `:atom` primitive as the 16th type.
  describe('BUILT_IN_TYPES registry', () => {
    it('has exactly 16 entries', () => {
      expect(BUILT_IN_TYPES).toHaveLength(16);
    });

    it('has unique names for all entries', () => {
      const names = BUILT_IN_TYPES.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(16);
    });
  });

  // inferType returns the declared type name for each fixture
  describe('inferType returns the fixture type name', () => {
    for (const { typeName, value } of testValues) {
      it(`returns '${typeName}' for ${typeName} value`, () => {
        expect(newInferType(value)).toBe(typeName);
      });
    }
  });

  // formatValue returns the expected display string for each fixture
  describe('formatValue returns the expected display string', () => {
    for (const { typeName, value, formatted } of testValues) {
      it(`formats ${typeName} value as '${formatted}'`, () => {
        expect(newFormatValue(value)).toBe(formatted);
      });
    }
  });

  // copyValue returns same reference for immutable, independent copy for mutable
  describe('copyValue immutable vs mutable', () => {
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

    it('tuple registration has protocol.compare', () => {
      const tupleReg = BUILT_IN_TYPES.find((t) => t.name === 'tuple');
      expect(tupleReg).toBeDefined();
      expect(tupleReg!.protocol.compare).toBeTypeOf('function');
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

  // every registration has a format protocol
  describe('format protocol presence', () => {
    it('every BUILT_IN_TYPES entry has protocol.format', () => {
      for (const reg of BUILT_IN_TYPES) {
        expect(typeof reg.protocol.format, reg.name).toBe('function');
      }
    });
  });

  // deepEquals on two iterators returns false (no protocol.eq)
  describe('iterator equality', () => {
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

  // serializeValue on non-serializable types throws RuntimeError (RILL-R067)
  describe('non-serializable type errors', () => {
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

  // deserializeValue with invalid data raises RILL-R004
  describe('deserialize invalid data', () => {
    it('halts typed-atom for unrecognized type name', () => {
      expectHaltSync(() => deserializeValue('bad', 'nonexistent_type'), {
        code: 'INVALID_INPUT',
      });
    });

    it('error message contains "Cannot deserialize as" for unrecognized type', () => {
      expectHaltMessageSync(
        () => deserializeValue('bad', 'nonexistent_type'),
        'Cannot deserialize as nonexistent_type'
      );
    });
  });

  // deserializeValue(null, 'number') halts typed-atom
  describe('deserialize null', () => {
    it('halts typed-atom for null input', () => {
      expectHaltSync(() => deserializeValue(null, 'number'), {
        code: 'INVALID_INPUT',
      });
    });

    it('error message contains "Cannot deserialize null as number"', () => {
      expectHaltMessageSync(
        () => deserializeValue(null, 'number'),
        'Cannot deserialize null as number'
      );
    });
  });

  // ============================================================
  // Integration Tests: Protocol Dispatch via Script Execution
  // ============================================================

  // json built-in uses protocol.serialize for all serializable types
  describe('Integration: json built-in serialization', () => {
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

  // iterator == iterator raises RILL-R002 via rill script execution
  describe('Integration: iterator equality raises RILL-R002', () => {
    it('raises RILL-R002 when comparing iterators with ==', async () => {
      await expect(run('range(1, 3) == range(1, 3)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('error message contains "Cannot compare"', async () => {
      await expectHaltMessage(
        () => run('range(1, 3) == range(1, 3)'),
        /Cannot compare/
      );
    });
  });

  // true > false raises RILL-R002 via rill script execution (breaking change)
  describe('Integration: bool ordering raises RILL-R002', () => {
    it('raises RILL-R002 when comparing booleans with >', async () => {
      await expect(run('true > false')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('error message contains "Cannot compare"', async () => {
      await expectHaltMessage(() => run('true > false'), /Cannot compare/);
    });
  });

  // -> unsupported target raises RILL-R036 via rill script execution
  describe('Integration: unsupported conversion raises RILL-R036', () => {
    it('raises RILL-R036 for number -> bool', async () => {
      await expect(run('42 -> bool')).rejects.toHaveProperty(
        'errorId',
        'RILL-R036'
      );
    });

    it('error message contains "cannot convert"', async () => {
      await expectHaltMessage(() => run('42 -> bool'), /cannot convert/);
    });
  });

  // "abc" -> number raises RILL-R038 via rill script execution
  describe('Integration: string-to-number parse failure raises RILL-R038', () => {
    it('raises RILL-R038 for non-numeric string to number', async () => {
      await expect(run('"abc" -> number')).rejects.toHaveProperty(
        'errorId',
        'RILL-R038'
      );
    });

    it('error message contains "cannot convert"', async () => {
      await expectHaltMessage(() => run('"abc" -> number'), /cannot convert/);
    });
  });

  // json built-in on non-serializable type halts typed-atom
  describe('Integration: json on non-serializable halts typed-atom', () => {
    it('halts #INVALID_INPUT for closure passed to json', async () => {
      await expectHalt(() => run('||{ "test" } -> json'), {
        code: 'INVALID_INPUT',
      });
    });

    it('rejects with RuntimeHaltSignal (not RuntimeError)', async () => {
      await expect(run('||{ "test" } -> json')).rejects.toBeInstanceOf(
        RuntimeHaltSignal
      );
    });

    it('error message contains "not JSON-serializable"', async () => {
      await expectHaltMessage(
        () => run('||{ "test" } -> json'),
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
      await expectHaltMessage(
        () => run('list[1, 2] > list[3, 4]'),
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
