/**
 * Tests for formatValue, serializeValue, and toNative
 *
 * IR-1: formatValue(value: RillValue): string — pure function, guard order:
 *   shape → callable → tuple → iterator → list → vector → type value → field descriptor → dict
 * IR-2: serializeValue(value: RillValue): unknown — throws plain Error for non-serializable types
 * IR-3: toNative(value: RillValue): NativeResult — always returns NativeResult { rillTypeName, rillTypeSignature, value }; non-native types (closures/iterators/vectors/type values) produce descriptor objects
 *
 * AC-1: Script returns number → ExecutionResult.result is JS number
 * AC-2: log(42) delivers string "42" to onLog
 * AC-3: json([1,2,3]) produces "[1,2,3]"
 * AC-4: json(dict(a: 1)) produces '{"a":1}'
 * AC-5: formatValue on list [1,2,3] → "list(1, 2, 3)"
 * AC-6: formatValue on dict {a:1} → "dict(a: 1)"
 * AC-7: formatValue on shape → "shape(name: string, age?: number)"
 * AC-8: formatValue on closure → "type(closure)"
 * AC-9: Script returns closure → returns as RillValue
 * AC-10: json(closure) throws RuntimeError RILL-R004
 * AC-11: json([1, closure, 3]) throws RuntimeError
 * AC-12: json(tuple(a:1)) throws RuntimeError
 * AC-13: json(vector(...)) throws RuntimeError
 * AC-14: Deeply nested list/dict convert recursively
 * AC-15: Shape with nested shapes renders inline
 * AC-16: null in formatValue → "type(null)"
 * AC-17: Guard clause ordering: shape before dict; callable before dict/array; tuple before dict
 *
 * EC-1 through EC-5: toNative — EC-1,EC-2 return descriptor objects for non-native types; EC-3,EC-6 convert tuple/ordered to JS array/object
 * EC-8 through EC-14: serializeValue throws plain Error for non-serializable types
 */

import { describe, expect, it } from 'vitest';
import {
  formatValue,
  serializeValue,
  toNative,
  createVector,
  createOrdered,
} from '../../src/runtime/core/values.js';
import type {
  RillTuple,
  RillTypeValue,
  RillValue,
} from '../../src/runtime/core/values.js';
import { callable } from '../../src/runtime/core/callable.js';

import { RuntimeError } from '@rcrsr/rill';
import { run, runFull, createLogCollector } from '../helpers/runtime.js';

// ============================================================
// Shared test fixtures
// ============================================================

function makeTypeValue(typeName: string): RillTypeValue {
  return {
    __rill_type: true as const,
    typeName: typeName as RillTypeValue['typeName'],
    structure: {
      kind: typeName as RillTypeValue['typeName'],
    } as RillTypeValue['structure'],
  };
}

// createTupleFromDict was removed in Phase 2. Construct RillTuple directly.
function createTupleFromDict(obj: Record<string, RillValue>): RillTuple {
  return {
    __rill_tuple: true as const,
    entries: Object.values(obj),
  };
}

function makeIterator(): RillValue {
  const done = callable(() => ({ done: true, next: callable(() => ({})) }));
  return {
    done: false,
    value: 1,
    next: done,
  };
}

// ============================================================
// formatValue — string representation
// ============================================================

describe('formatValue', () => {
  describe('primitives', () => {
    it('AC-16: formats null as "type(null)"', () => {
      expect(formatValue(null)).toBe('type(null)');
    });

    it('formats string as itself', () => {
      expect(formatValue('hello')).toBe('hello');
    });

    it('formats empty string as empty string', () => {
      expect(formatValue('')).toBe('');
    });

    it('formats number via String()', () => {
      expect(formatValue(42)).toBe('42');
    });

    it('formats negative number', () => {
      expect(formatValue(-7)).toBe('-7');
    });

    it('formats float number', () => {
      expect(formatValue(3.14)).toBe('3.14');
    });

    it('formats boolean true', () => {
      expect(formatValue(true)).toBe('true');
    });

    it('formats boolean false', () => {
      expect(formatValue(false)).toBe('false');
    });
  });

  describe('AC-5: list', () => {
    it('formats list with multiple elements', () => {
      expect(formatValue([1, 2, 3])).toBe('list[1, 2, 3]');
    });

    it('formats empty list', () => {
      expect(formatValue([])).toBe('list[]');
    });

    it('formats list with string elements', () => {
      expect(formatValue(['a', 'b'])).toBe('list[a, b]');
    });

    it('formats list with boolean elements', () => {
      expect(formatValue([true, false])).toBe('list[true, false]');
    });
  });

  describe('AC-6: dict', () => {
    it('formats dict with one entry', () => {
      expect(formatValue({ a: 1 })).toBe('dict[a: 1]');
    });

    it('formats dict with multiple entries', () => {
      expect(formatValue({ a: 1, b: 2 })).toBe('dict[a: 1, b: 2]');
    });

    it('formats empty dict', () => {
      expect(formatValue({})).toBe('dict[]');
    });

    it('formats dict with string values', () => {
      expect(formatValue({ name: 'Alice' })).toBe('dict[name: Alice]');
    });
  });

  describe('AC-8: closure', () => {
    it('formats callable as "type(closure)"', () => {
      const fn = callable(() => null);
      expect(formatValue(fn)).toBe('type(closure)');
    });
  });

  describe('iterator', () => {
    it('formats iterator as "type(iterator)"', () => {
      const iterator = makeIterator();
      expect(formatValue(iterator)).toBe('type(iterator)');
    });
  });

  describe('tuple', () => {
    it('formats positional tuple', () => {
      // RillTuple.entries is RillValue[] in Phase 2 (not a Map).
      const posTuple: RillTuple = {
        __rill_tuple: true as const,
        entries: ['x' as RillValue, 'y' as RillValue],
      };
      expect(formatValue(posTuple)).toBe('tuple[x, y]');
    });
  });

  describe('vector', () => {
    it('formats vector as "vector(model, Nd)"', () => {
      const vec = createVector(new Float32Array(1536), 'voyage-3');
      expect(formatValue(vec)).toBe('vector(voyage-3, 1536d)');
    });
  });

  describe('AC-14: recursive conversion', () => {
    it('formats deeply nested list', () => {
      expect(
        formatValue([
          [1, 2],
          [3, 4],
        ])
      ).toBe('list[list[1, 2], list[3, 4]]');
    });

    it('formats list containing dict', () => {
      expect(formatValue([{ a: 1 }])).toBe('list[dict[a: 1]]');
    });

    it('formats dict containing list', () => {
      expect(formatValue({ items: [1, 2] })).toBe('dict[items: list[1, 2]]');
    });

    it('formats dict containing dict', () => {
      expect(formatValue({ outer: { inner: 42 } })).toBe(
        'dict[outer: dict[inner: 42]]'
      );
    });
  });

  describe('AC-17: guard clause ordering', () => {
    it('callable is formatted before dict (callable has __type, not treated as plain dict)', () => {
      const fn = callable(() => null);
      const result = formatValue(fn);
      expect(result).toBe('type(closure)');
      expect(result).not.toMatch(/^dict/);
    });

    it('tuple is formatted before dict (tuple has __rill_tuple, not treated as plain dict)', () => {
      const tuple = createTupleFromDict({ a: 1 });
      const result = formatValue(tuple);
      // Phase 2: entries=[1], positional only: tuple[1]
      expect(result).toBe('tuple[1]');
      expect(result).not.toMatch(/^dict/);
    });
  });

  describe('AC-26: ordered', () => {
    it('formats ordered value as "ordered[...]"', () => {
      const ord = createOrdered([
        ['a', 1],
        ['b', 2],
      ]);
      expect(formatValue(ord)).toBe('ordered[a: 1, b: 2]');
    });

    it('formats empty ordered value', () => {
      const ord = createOrdered([]);
      expect(formatValue(ord)).toBe('ordered[]');
    });
  });
});

// ============================================================
// serializeValue — JSON serialization
// ============================================================

describe('serializeValue', () => {
  describe('serializable types', () => {
    it('serializes null', () => {
      expect(serializeValue(null)).toBeNull();
    });

    it('serializes string', () => {
      expect(serializeValue('hello')).toBe('hello');
    });

    it('serializes number', () => {
      expect(serializeValue(42)).toBe(42);
    });

    it('serializes boolean true', () => {
      expect(serializeValue(true)).toBe(true);
    });

    it('serializes boolean false', () => {
      expect(serializeValue(false)).toBe(false);
    });

    it('AC-3 (unit): serializes list to array', () => {
      expect(serializeValue([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('AC-4 (unit): serializes dict to plain object', () => {
      expect(serializeValue({ a: 1 })).toEqual({ a: 1 });
    });

    it('serializes empty list', () => {
      expect(serializeValue([])).toEqual([]);
    });

    it('serializes empty dict', () => {
      expect(serializeValue({})).toEqual({});
    });
  });

  describe('AC-14: recursive serialization', () => {
    it('serializes nested list', () => {
      expect(
        serializeValue([
          [1, 2],
          [3, 4],
        ])
      ).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('serializes nested dict', () => {
      expect(serializeValue({ outer: { inner: 42 } })).toEqual({
        outer: { inner: 42 },
      });
    });

    it('serializes list containing dict', () => {
      expect(serializeValue([{ a: 1 }, { b: 2 }])).toEqual([
        { a: 1 },
        { b: 2 },
      ]);
    });

    it('serializes dict containing list', () => {
      expect(serializeValue({ items: [1, 2, 3] })).toEqual({
        items: [1, 2, 3],
      });
    });
  });

  describe('EC-8: closure throws plain Error', () => {
    it('throws Error (not RuntimeError) for callable', () => {
      const fn = callable(() => null);
      expect(() => serializeValue(fn)).toThrow(
        'closures are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const fn = callable(() => null);
      let caught: unknown;
      try {
        serializeValue(fn);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });

  describe('EC-9: iterator throws plain Error', () => {
    it('throws Error for iterator', () => {
      const iterator = makeIterator();
      expect(() => serializeValue(iterator)).toThrow(
        'iterators are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const iterator = makeIterator();
      let caught: unknown;
      try {
        serializeValue(iterator);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });

  describe('EC-10: tuple throws plain Error', () => {
    it('throws Error for tuple', () => {
      const tuple = createTupleFromDict({ a: 1 });
      expect(() => serializeValue(tuple)).toThrow(
        'tuples are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const tuple = createTupleFromDict({ a: 1 });
      let caught: unknown;
      try {
        serializeValue(tuple);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });

  describe('EC-11: type value throws plain Error', () => {
    it('throws Error for type value', () => {
      expect(() => serializeValue(makeTypeValue('string'))).toThrow(
        'type values are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      let caught: unknown;
      try {
        serializeValue(makeTypeValue('number'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });

  describe('EC-12: vector throws plain Error', () => {
    it('throws Error for vector', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      expect(() => serializeValue(vec)).toThrow(
        'vectors are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      let caught: unknown;
      try {
        serializeValue(vec);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });
});

// ============================================================
// toNative — native value conversion
// ============================================================

describe('toNative', () => {
  // AC-1 through AC-12: happy path conversions
  describe('native types', () => {
    it('AC-21: converts null', () => {
      const r = toNative(null);
      expect(r.rillTypeName).toBe('string');
      expect(r.rillTypeSignature).toBe('string');
      expect(r.value).toBeNull();
    });

    it('AC-1: converts string', () => {
      const r = toNative('hello');
      expect(r.rillTypeName).toBe('string');
      expect(r.rillTypeSignature).toBe('string');
      expect(r.value).toBe('hello');
    });

    it('AC-2: converts number', () => {
      const r = toNative(42);
      expect(r.rillTypeName).toBe('number');
      expect(r.rillTypeSignature).toBe('number');
      expect(r.value).toBe(42);
    });

    it('AC-3: converts boolean true', () => {
      const r = toNative(true);
      expect(r.rillTypeName).toBe('bool');
      expect(r.rillTypeSignature).toBe('bool');
      expect(r.value).toBe(true);
    });

    it('converts boolean false', () => {
      const r = toNative(false);
      expect(r.rillTypeName).toBe('bool');
      expect(r.rillTypeSignature).toBe('bool');
      expect(r.value).toBe(false);
    });

    it('AC-4: converts list to native array', () => {
      const r = toNative([1, 2, 3]);
      expect(r.rillTypeName).toBe('list');
      expect(r.rillTypeSignature).toBe('list(number)');
      expect(r.value).toEqual([1, 2, 3]);
    });

    it('AC-5: converts dict to native plain object', () => {
      const r = toNative({ a: 1 });
      expect(r.rillTypeName).toBe('dict');
      expect(r.rillTypeSignature).toBe('dict(a: number)');
      expect(r.value).toEqual({ a: 1 });
    });

    it('AC-22: converts empty list', () => {
      const r = toNative([]);
      expect(r.rillTypeName).toBe('list');
      expect(r.rillTypeSignature).toBe('list(any)');
      expect(r.value).toEqual([]);
    });

    it('AC-23: converts empty dict', () => {
      const r = toNative({});
      expect(r.rillTypeName).toBe('dict');
      expect(r.rillTypeSignature).toBe('dict()');
      expect(r.value).toEqual({});
    });
  });

  describe('AC-14: recursive native conversion', () => {
    it('converts nested list', () => {
      const r = toNative([
        [1, 2],
        [3, 4],
      ]);
      expect(r.value).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('converts nested dict', () => {
      const r = toNative({ outer: { inner: 42 } });
      expect(r.value).toEqual({ outer: { inner: 42 } });
    });

    it('converts list containing dict', () => {
      expect(toNative([{ a: 1 }]).value).toEqual([{ a: 1 }]);
    });

    it('converts dict containing list', () => {
      expect(toNative({ items: [1, 2] }).value).toEqual({ items: [1, 2] });
    });
  });

  describe('AC-8: closure produces descriptor object', () => {
    it('returns rillTypeName "closure"', () => {
      const fn = callable(() => null);
      expect(toNative(fn).rillTypeName).toBe('closure');
    });

    it('returns rillTypeSignature for callable', () => {
      const fn = callable(() => null);
      expect(toNative(fn).rillTypeSignature).toBe('|| :any');
    });

    it('returns value with signature descriptor', () => {
      const fn = callable(() => null);
      const r = toNative(fn);
      expect(r.value).toEqual({ signature: '|| :any' });
    });
  });

  describe('AC-11 / AC-12: iterator produces descriptor object', () => {
    it('AC-11: fresh iterator returns rillTypeName "iterator"', () => {
      const iterator = makeIterator();
      expect(toNative(iterator).rillTypeName).toBe('iterator');
    });

    it('AC-11: fresh iterator value has done: false', () => {
      const iterator = makeIterator();
      expect(toNative(iterator).value).toEqual({ done: false });
    });

    it('AC-12: exhausted iterator value has done: true', () => {
      const done = callable(() => ({ done: true, next: callable(() => ({})) }));
      const exhausted = { done: true, next: done };
      expect(toNative(exhausted).value).toEqual({ done: true });
    });

    it('AC-26: repeated toNative on same iterator returns same done state', () => {
      const iterator = makeIterator();
      expect(toNative(iterator).value).toEqual({ done: false });
      expect(toNative(iterator).value).toEqual({ done: false });
    });
  });

  describe('AC-6: tuple converts to native array', () => {
    it('converts tuple entries to a native array', () => {
      const tuple = createTupleFromDict({ a: 1 });
      expect(toNative(tuple).rillTypeName).toBe('tuple');
      expect(toNative(tuple).value).toEqual([1]);
    });

    it('recursively converts nested tuple entries', () => {
      const inner = createTupleFromDict({ x: 2 });
      const outer: RillTuple = {
        __rill_tuple: true as const,
        entries: [inner],
      };
      expect(toNative(outer).value).toEqual([[2]]);
    });
  });

  describe('AC-10: type value produces descriptor object', () => {
    it('returns rillTypeName "type"', () => {
      expect(toNative(makeTypeValue('string')).rillTypeName).toBe('type');
    });

    it('returns rillTypeSignature "type"', () => {
      expect(toNative(makeTypeValue('string')).rillTypeSignature).toBe('type');
    });

    it('returns value with name and signature descriptor', () => {
      const r = toNative(makeTypeValue('number'));
      expect(r.value).toEqual({ name: 'number', signature: 'number' });
    });
  });

  describe('AC-9: vector produces descriptor object', () => {
    it('returns rillTypeName "vector"', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      expect(toNative(vec).rillTypeName).toBe('vector');
    });

    it('returns rillTypeSignature "vector"', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      expect(toNative(vec).rillTypeSignature).toBe('vector');
    });

    it('returns value with model and dimensions descriptor', () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'test-model');
      expect(toNative(vec).value).toEqual({
        model: 'test-model',
        dimensions: 3,
      });
    });
  });

  describe('AC-7: ordered converts to native plain object', () => {
    it('converts ordered entries to a native object', () => {
      const ordered = createOrdered([
        ['a', 1],
        ['b', 'x'],
      ]);
      expect(toNative(ordered).rillTypeName).toBe('ordered');
      expect(toNative(ordered).value).toEqual({ a: 1, b: 'x' });
    });

    it('recursively converts nested ordered values', () => {
      const inner = createOrdered([['x', 2]]);
      const outer = createOrdered([['nested', inner]]);
      expect(toNative(outer).value).toEqual({ nested: { x: 2 } });
    });
  });

  describe('rillTypeSignature field', () => {
    it('returns "string" for string', () => {
      expect(toNative('hi').rillTypeSignature).toBe('string');
    });

    it('returns "number" for number', () => {
      expect(toNative(42).rillTypeSignature).toBe('number');
    });

    it('returns "bool" for boolean', () => {
      expect(toNative(true).rillTypeSignature).toBe('bool');
    });

    it('returns "list(number)" for number list', () => {
      expect(toNative([1, 2, 3]).rillTypeSignature).toBe('list(number)');
    });
  });

  describe('AC-24: nested list containing closure', () => {
    it('outer value is array; closure entry becomes descriptor', () => {
      const fn = callable(() => null);
      const r = toNative([fn]);
      expect(Array.isArray(r.value)).toBe(true);
      const entries = r.value as unknown[];
      expect(entries[0]).toEqual({ signature: '|| :any' });
    });
  });

  describe('AC-25: dict containing iterator value', () => {
    it('dict is plain object; iterator field becomes descriptor', () => {
      const iterator = makeIterator();
      // Wrap iterator in a plain dict via a list to exercise toNativeValue recursion.
      // A plain dict with an iterator value will have that field converted.
      const r = toNative([iterator]);
      expect(Array.isArray(r.value)).toBe(true);
      const entries = r.value as unknown[];
      expect(entries[0]).toEqual({ done: false });
    });
  });
});

// ============================================================
// Script-level integration tests (AC-1 through AC-13)
// ============================================================

describe('Script-level integration', () => {
  describe('AC-1: Script returns number → result is JS number', () => {
    it('result is JS number, not string', async () => {
      const result = await runFull('42');
      expect(typeof result.result).toBe('number');
      expect(result.result).toBe(42);
    });
  });

  describe('AC-2: log(42) delivers string "42" to onLog', () => {
    it('log delivers formatted number string', async () => {
      const { logs, callbacks } = createLogCollector();
      await run('42 -> log', { callbacks });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe('42');
    });
  });

  describe('AC-3: json([1,2,3]) produces "[1,2,3]"', () => {
    it('json on a list produces compact JSON', async () => {
      const result = await run('list[1, 2, 3] -> json');
      expect(result).toBe('[1,2,3]');
    });
  });

  describe('AC-4: json(dict(a: 1)) produces \'{"a":1}\'', () => {
    it('json on a dict produces compact JSON', async () => {
      const result = await run('dict[a: 1] -> json');
      expect(result).toBe('{"a":1}');
    });
  });

  describe('AC-9: Script returning closure returns as RillValue', () => {
    it('closure is returned without error', async () => {
      const result = await run('|| { "fn" }');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });
  });

  describe('AC-10: json(closure) throws RuntimeError RILL-R004', () => {
    it('json on a closure rejects with RuntimeError', async () => {
      await expect(run('|x| { $x * 2 } -> json')).rejects.toThrow(RuntimeError);
    });

    it('error message mentions closures', async () => {
      await expect(run('|x| { $x * 2 } -> json')).rejects.toThrow('closures');
    });
  });

  describe('AC-11: json([1, closure, 3]) throws RuntimeError', () => {
    it('json on list containing closure rejects', async () => {
      await expect(run('list[1, ||{ "fn" }, 3] -> json')).rejects.toThrow(
        RuntimeError
      );
    });
  });

  describe('AC-12: json(tuple(a:1)) throws RuntimeError', () => {
    it('json on tuple rejects', async () => {
      await expect(run('ordered[a: 1] -> json')).rejects.toThrow(RuntimeError);
    });
  });

  describe('AC-13: json(vector(...)) throws RuntimeError', () => {
    it('json on vector created via host function rejects', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0]), 'test-model');
      await expect(
        run('get_vec() -> json', {
          functions: {
            get_vec: { params: [], fn: () => vec },
          },
        })
      ).rejects.toThrow(RuntimeError);
    });
  });
});
