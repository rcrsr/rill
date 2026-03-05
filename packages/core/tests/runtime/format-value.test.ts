/**
 * Tests for formatValue, valueToJSON, and toNative
 *
 * IR-1: formatValue(value: RillValue): string — pure function, guard order:
 *   shape → callable → tuple → iterator → list → vector → type value → field descriptor → dict
 * IR-2: valueToJSON(value: RillValue): unknown — throws plain Error for non-serializable types
 * IR-3: toNative(value: RillValue): NativeValue — throws RuntimeError for non-representable types
 *
 * AC-1: Script returns number → ExecutionResult.result is JS number
 * AC-2: log(42) delivers string "42" to onLog
 * AC-3: json([1,2,3]) produces "[1,2,3]"
 * AC-4: json(dict(a: 1)) produces '{"a":1}'
 * AC-5: formatValue on list [1,2,3] → "list(1, 2, 3)"
 * AC-6: formatValue on dict {a:1} → "dict(a: 1)"
 * AC-7: formatValue on shape → "shape(name: string, age?: number)"
 * AC-8: formatValue on closure → "type(closure)"
 * AC-9: Script returns closure → runtime error
 * AC-10: json(closure) throws RuntimeError RILL-R004
 * AC-11: json([1, closure, 3]) throws RuntimeError
 * AC-12: json(tuple(a:1)) throws RuntimeError
 * AC-13: json(vector(...)) throws RuntimeError
 * AC-14: Deeply nested list/dict convert recursively
 * AC-15: Shape with nested shapes renders inline
 * AC-16: null in formatValue → "type(null)"
 * AC-17: Guard clause ordering: shape before dict; callable before dict/array; tuple before dict
 *
 * EC-1 through EC-7: toNative throws RuntimeError RILL-R004 for non-representable types
 * EC-8 through EC-14: valueToJSON throws plain Error for non-serializable types
 */

import { describe, expect, it } from 'vitest';
import {
  formatValue,
  valueToJSON,
  toNative,
  createVector,
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
      kind: 'primitive',
      name: typeName as RillTypeValue['typeName'],
    },
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
      expect(formatValue([1, 2, 3])).toBe('list(1, 2, 3)');
    });

    it('formats empty list', () => {
      expect(formatValue([])).toBe('list()');
    });

    it('formats list with string elements', () => {
      expect(formatValue(['a', 'b'])).toBe('list(a, b)');
    });

    it('formats list with boolean elements', () => {
      expect(formatValue([true, false])).toBe('list(true, false)');
    });
  });

  describe('AC-6: dict', () => {
    it('formats dict with one entry', () => {
      expect(formatValue({ a: 1 })).toBe('dict(a: 1)');
    });

    it('formats dict with multiple entries', () => {
      expect(formatValue({ a: 1, b: 2 })).toBe('dict(a: 1, b: 2)');
    });

    it('formats empty dict', () => {
      expect(formatValue({})).toBe('dict()');
    });

    it('formats dict with string values', () => {
      expect(formatValue({ name: 'Alice' })).toBe('dict(name: Alice)');
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
      expect(formatValue(posTuple)).toBe('tuple(x, y)');
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
      ).toBe('list(list(1, 2), list(3, 4))');
    });

    it('formats list containing dict', () => {
      expect(formatValue([{ a: 1 }])).toBe('list(dict(a: 1))');
    });

    it('formats dict containing list', () => {
      expect(formatValue({ items: [1, 2] })).toBe('dict(items: list(1, 2))');
    });

    it('formats dict containing dict', () => {
      expect(formatValue({ outer: { inner: 42 } })).toBe(
        'dict(outer: dict(inner: 42))'
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
      // Phase 2: entries=[1], positional only: tuple(1)
      expect(result).toBe('tuple(1)');
      expect(result).not.toMatch(/^dict/);
    });
  });
});

// ============================================================
// valueToJSON — JSON serialization
// ============================================================

describe('valueToJSON', () => {
  describe('serializable types', () => {
    it('serializes null', () => {
      expect(valueToJSON(null)).toBeNull();
    });

    it('serializes string', () => {
      expect(valueToJSON('hello')).toBe('hello');
    });

    it('serializes number', () => {
      expect(valueToJSON(42)).toBe(42);
    });

    it('serializes boolean true', () => {
      expect(valueToJSON(true)).toBe(true);
    });

    it('serializes boolean false', () => {
      expect(valueToJSON(false)).toBe(false);
    });

    it('AC-3 (unit): serializes list to array', () => {
      expect(valueToJSON([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('AC-4 (unit): serializes dict to plain object', () => {
      expect(valueToJSON({ a: 1 })).toEqual({ a: 1 });
    });

    it('serializes empty list', () => {
      expect(valueToJSON([])).toEqual([]);
    });

    it('serializes empty dict', () => {
      expect(valueToJSON({})).toEqual({});
    });
  });

  describe('AC-14: recursive serialization', () => {
    it('serializes nested list', () => {
      expect(
        valueToJSON([
          [1, 2],
          [3, 4],
        ])
      ).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('serializes nested dict', () => {
      expect(valueToJSON({ outer: { inner: 42 } })).toEqual({
        outer: { inner: 42 },
      });
    });

    it('serializes list containing dict', () => {
      expect(valueToJSON([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('serializes dict containing list', () => {
      expect(valueToJSON({ items: [1, 2, 3] })).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('EC-8: closure throws plain Error', () => {
    it('throws Error (not RuntimeError) for callable', () => {
      const fn = callable(() => null);
      expect(() => valueToJSON(fn)).toThrow(
        'closures are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const fn = callable(() => null);
      let caught: unknown;
      try {
        valueToJSON(fn);
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
      expect(() => valueToJSON(iterator)).toThrow(
        'iterators are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const iterator = makeIterator();
      let caught: unknown;
      try {
        valueToJSON(iterator);
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
      expect(() => valueToJSON(tuple)).toThrow(
        'tuples are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const tuple = createTupleFromDict({ a: 1 });
      let caught: unknown;
      try {
        valueToJSON(tuple);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RuntimeError);
    });
  });

  describe('EC-11: type value throws plain Error', () => {
    it('throws Error for type value', () => {
      expect(() => valueToJSON(makeTypeValue('string'))).toThrow(
        'type values are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      let caught: unknown;
      try {
        valueToJSON(makeTypeValue('number'));
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
      expect(() => valueToJSON(vec)).toThrow(
        'vectors are not JSON-serializable'
      );
    });

    it('thrown error is plain Error, not RuntimeError', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      let caught: unknown;
      try {
        valueToJSON(vec);
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
  describe('native types', () => {
    it('converts null', () => {
      expect(toNative(null)).toBeNull();
    });

    it('converts string', () => {
      expect(toNative('hello')).toBe('hello');
    });

    it('converts number', () => {
      expect(toNative(42)).toBe(42);
    });

    it('converts boolean true', () => {
      expect(toNative(true)).toBe(true);
    });

    it('converts boolean false', () => {
      expect(toNative(false)).toBe(false);
    });

    it('converts list to native array', () => {
      expect(toNative([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('converts dict to native plain object', () => {
      expect(toNative({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
    });

    it('converts empty list', () => {
      expect(toNative([])).toEqual([]);
    });

    it('converts empty dict', () => {
      expect(toNative({})).toEqual({});
    });
  });

  describe('AC-14: recursive native conversion', () => {
    it('converts nested list', () => {
      expect(
        toNative([
          [1, 2],
          [3, 4],
        ])
      ).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('converts nested dict', () => {
      expect(toNative({ outer: { inner: 42 } })).toEqual({
        outer: { inner: 42 },
      });
    });

    it('converts list containing dict', () => {
      expect(toNative([{ a: 1 }])).toEqual([{ a: 1 }]);
    });

    it('converts dict containing list', () => {
      expect(toNative({ items: [1, 2] })).toEqual({ items: [1, 2] });
    });
  });

  describe('EC-1: closure throws RuntimeError RILL-R004', () => {
    it('throws RuntimeError for callable', () => {
      const fn = callable(() => null);
      expect(() => toNative(fn)).toThrow(
        'closures cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError', () => {
      const fn = callable(() => null);
      let caught: unknown;
      try {
        toNative(fn);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
    });

    it('thrown error has errorId RILL-R004', () => {
      const fn = callable(() => null);
      let caught: unknown;
      try {
        toNative(fn);
      } catch (e) {
        caught = e;
      }
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R004'
      );
    });
  });

  describe('EC-2: iterator throws RuntimeError', () => {
    it('throws RuntimeError for iterator', () => {
      const iterator = makeIterator();
      expect(() => toNative(iterator)).toThrow(
        'iterators cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError with RILL-R004', () => {
      const iterator = makeIterator();
      let caught: unknown;
      try {
        toNative(iterator);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R004'
      );
    });
  });

  describe('EC-3: tuple throws RuntimeError', () => {
    it('throws RuntimeError for tuple', () => {
      const tuple = createTupleFromDict({ a: 1 });
      expect(() => toNative(tuple)).toThrow(
        'tuples cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError with RILL-R004', () => {
      const tuple = createTupleFromDict({ a: 1 });
      let caught: unknown;
      try {
        toNative(tuple);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R004'
      );
    });
  });

  describe('EC-4: type value throws RuntimeError', () => {
    it('throws RuntimeError for type value', () => {
      expect(() => toNative(makeTypeValue('string'))).toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError with RILL-R004', () => {
      let caught: unknown;
      try {
        toNative(makeTypeValue('number'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R004'
      );
    });
  });

  describe('EC-5: vector throws RuntimeError', () => {
    it('throws RuntimeError for vector', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      expect(() => toNative(vec)).toThrow(
        'vectors cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError with RILL-R004', () => {
      const vec = createVector(new Float32Array([1.0]), 'test-model');
      let caught: unknown;
      try {
        toNative(vec);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
        'RILL-R004'
      );
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
      const result = await run('[1, 2, 3] -> json');
      expect(result).toBe('[1,2,3]');
    });
  });

  describe('AC-4: json(dict(a: 1)) produces \'{"a":1}\'', () => {
    it('json on a dict produces compact JSON', async () => {
      const result = await run('[a: 1] -> json');
      expect(result).toBe('{"a":1}');
    });
  });

  describe('AC-9: Script returning closure causes runtime error', () => {
    it('throws RuntimeError when script result is a closure', async () => {
      await expect(run('|| { "fn" }')).rejects.toThrow(
        'closures cannot be returned from scripts'
      );
    });

    it('thrown error is RuntimeError', async () => {
      let caught: unknown;
      try {
        await run('|| { "fn" }');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
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
      await expect(run('[1, ||{ "fn" }, 3] -> json')).rejects.toThrow(
        RuntimeError
      );
    });
  });

  describe('AC-12: json(tuple(a:1)) throws RuntimeError', () => {
    it('json on tuple rejects', async () => {
      await expect(run('*[a: 1] -> json')).rejects.toThrow(RuntimeError);
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
