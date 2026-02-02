/**
 * Rill Runtime Tests: Dict Dispatch
 * Tests for dict literal as dispatch table when piped
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Dict Dispatch', () => {
  describe('Basic Key Matching', () => {
    it('returns matched value for exact key', async () => {
      // AC-25: Key match returns associated value
      const result = await run('"a" -> [a: 1, b: 2]');
      expect(result).toBe(1);
    });

    it('returns matched value for second key', async () => {
      const result = await run('"b" -> [a: 1, b: 2]');
      expect(result).toBe(2);
    });

    it('returns matched value for different string keys', async () => {
      const result = await run(
        '"apple" -> [apple: "fruit", carrot: "vegetable"]'
      );
      expect(result).toBe('fruit');
    });
  });

  describe('Error Cases', () => {
    it('throws RUNTIME_PROPERTY_NOT_FOUND when no match and no default', async () => {
      // AC-30: No match, no default
      // EC-12: RUNTIME_PROPERTY_NOT_FOUND error
      await expect(run('"z" -> [a: 1, b: 2]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('throws with descriptive message for missing key', async () => {
      await expect(run('"missing" -> [a: 1, b: 2]')).rejects.toThrow(
        /missing/i
      );
    });
  });

  describe('Closure Auto-Invocation', () => {
    it('auto-invokes closure value with piped key as $', async () => {
      // AC-27: Auto-invoke closure, $ is piped key
      const result = await run('"x" -> [x: ||{ $ -> .upper }]');
      expect(result).toBe('X');
    });

    it('auto-invokes closure with transform logic', async () => {
      const result = await run('"hello" -> [hello: ||{ "{$}!" }]');
      expect(result).toBe('hello!');
    });

    it('auto-invokes closure that accesses dict', async () => {
      const result = await run(`
        [name: "test"] :> $d
        "key" -> [key: ||{ $d.name }]
      `);
      expect(result).toBe('test');
    });
  });

  describe('Chaining After Dispatch', () => {
    it('chains method call after dispatch', async () => {
      // AC-29: Chains with next operation
      const result = await run(
        '"done" -> [draft: "start", done: "end"] -> .upper'
      );
      expect(result).toBe('END');
    });

    it('chains multiple operations after dispatch', async () => {
      const result = await run(
        '"a" -> [a: "hello", b: "world"] -> .upper -> .len'
      );
      expect(result).toBe(5);
    });

    it('chains dispatch results into another dispatch', async () => {
      const result = await run('"a" -> [a: "x", b: "y"] -> [x: 1, y: 2]');
      expect(result).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('returns value from single-key dict', async () => {
      // AC-32: Single-key dict
      const result = await run('"a" -> [a: 1]');
      expect(result).toBe(1);
    });

    it('throws RUNTIME_PROPERTY_NOT_FOUND for empty dict (AC-33)', async () => {
      // AC-33: Dict with no matching keys
      // Should throw because there are no keys to match against
      await expect(run('"a" -> [b: 1]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('returns first match when duplicate keys', async () => {
      // AC-34: First match wins
      const result = await run('"a" -> [a: 1, a: 2]');
      expect(result).toBe(1);
    });

    it('preserves dict construction without pipe', async () => {
      // AC-35: Construction preserved (not dispatch)
      const result = await run(`
        [a: 1] :> $d
        $d.a
      `);
      expect(result).toBe(1);
    });

    it('dispatches with complex value types', async () => {
      const result = await run('"a" -> [a: [1, 2, 3], b: [4, 5]] -> /<0:2>');
      expect(result).toEqual([1, 2]);
    });

    it('dispatches to dict values', async () => {
      const result = await run('"key" -> [key: [name: "test"]] -> .name');
      expect(result).toBe('test');
    });
  });

  describe('Variable Context', () => {
    it('uses variable as dispatch key', async () => {
      const result = await run(`
        "b" :> $key
        $key -> [a: 1, b: 2]
      `);
      expect(result).toBe(2);
    });

    it('captures dispatch result', async () => {
      const result = await run(`
        "a" -> [a: 10, b: 20] :> $val
        $val + 5
      `);
      expect(result).toBe(15);
    });

    it('chains variable and dispatch', async () => {
      const result = await run(`
        "key" :> $k
        $k -> [key: "found", other: "not"] :> $r
        $r
      `);
      expect(result).toBe('found');
    });
  });

  describe('Default Operator', () => {
    it('returns default when no match (AC-26)', async () => {
      // AC-26: Dict Dispatch Success - Default Operator
      const result = await run('"c" -> [a: 1, b: 2] ?? 0');
      expect(result).toBe(0);
    });

    it('returns matched value when key exists (match takes precedence)', async () => {
      const result = await run('"a" -> [a: 1, b: 2] ?? 0');
      expect(result).toBe(1);
    });

    it('returns default with string value', async () => {
      const result = await run('"z" -> [a: "x", b: "y"] ?? "default"');
      expect(result).toBe('default');
    });

    it('returns default with expression', async () => {
      const result = await run('"missing" -> [a: 1] ?? (2 + 3)');
      expect(result).toBe(5);
    });

    it('chains after dispatch with default', async () => {
      const result = await run(
        '"c" -> [a: "hi", b: "bye"] ?? "hello" -> .upper'
      );
      expect(result).toBe('HELLO');
    });
  });

  describe('Multi-Key Dispatch', () => {
    it('returns value for multi-key match with first element (AC-28)', async () => {
      // AC-28: Multi-key dispatch - key "a" matches ["a", "b"]
      const result = await run('"a" -> [["a", "b"]: "found"]');
      expect(result).toBe('found');
    });

    it('returns value for multi-key match with second element (AC-28)', async () => {
      const result = await run('"b" -> [["a", "b"]: "found"]');
      expect(result).toBe('found');
    });

    it('returns value for multi-key match with middle element', async () => {
      const result = await run('"b" -> [["a", "b", "c"]: "middle"]');
      expect(result).toBe('middle');
    });

    it('throws when no match in multi-key', async () => {
      await expect(run('"z" -> [["a", "b"]: "found"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('returns default when no match in multi-key', async () => {
      const result = await run('"z" -> [["a", "b"]: "found"] ?? "default"');
      expect(result).toBe('default');
    });

    it('handles multiple multi-key entries', async () => {
      const result = await run(
        '"POST" -> [["GET", "HEAD"]: "safe", ["POST", "PUT"]: "unsafe"]'
      );
      expect(result).toBe('unsafe');
    });

    it('matches first multi-key entry', async () => {
      const result = await run(
        '"GET" -> [["GET", "HEAD"]: "safe", ["POST", "PUT"]: "unsafe"]'
      );
      expect(result).toBe('safe');
    });

    it('handles mixed single and multi-key entries', async () => {
      const result = await run('"b" -> [a: "single", ["b", "c"]: "multi"]');
      expect(result).toBe('multi');
    });

    it('matches single key before multi-key', async () => {
      const result = await run('"a" -> [a: "single", ["b", "c"]: "multi"]');
      expect(result).toBe('single');
    });

    it('auto-invokes closure in multi-key dispatch', async () => {
      const result = await run('"x" -> [["x", "y"]: ||{ $ -> .upper }]');
      expect(result).toBe('X');
    });
  });

  describe('Number and Boolean Literal Keys', () => {
    it('dispatches with number literal key (AC-3)', async () => {
      const result = await run('1 -> [1: "one", 2: "two"]');
      expect(result).toBe('one');
    });

    it('dispatches with second number literal key', async () => {
      const result = await run('2 -> [1: "one", 2: "two"]');
      expect(result).toBe('two');
    });

    it('dispatches with negative number literal key (AC-9)', async () => {
      const result = await run('(-1) -> [-1: "negative", 1: "positive"]');
      expect(result).toBe('negative');
    });

    it('dispatches with decimal number literal key (AC-10)', async () => {
      const result = await run('3.14 -> [3.14: "pi", 2.71: "e"]');
      expect(result).toBe('pi');
    });

    it('dispatches with boolean literal key true (AC-4)', async () => {
      const result = await run('true -> [true: "yes", false: "no"]');
      expect(result).toBe('yes');
    });

    it('dispatches with boolean literal key false (AC-4)', async () => {
      const result = await run('false -> [true: "yes", false: "no"]');
      expect(result).toBe('no');
    });

    it('throws when number key not found', async () => {
      await expect(run('3 -> [1: "one", 2: "two"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('throws when boolean key not found', async () => {
      await expect(run('true -> [false: "no"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('uses default with number literal keys', async () => {
      const result = await run('3 -> [1: "one", 2: "two"] ?? "other"');
      expect(result).toBe('other');
    });

    it('uses default with boolean literal keys', async () => {
      const result = await run('false -> [true: "yes"] ?? "no"');
      expect(result).toBe('no');
    });
  });

  describe('Type Discrimination', () => {
    it('distinguishes number from string identifier key (AC-11, AC-14)', async () => {
      // AC-14: Number 1 matches number key 1, not identifier key "one"
      const result = await run('1 -> [1: "number", one: "identifier"]');
      expect(result).toBe('number');
    });

    it('distinguishes string from number key (AC-11, AC-15)', async () => {
      // AC-15: String "1" does not match number 1
      await expect(run('"1" -> [1: "n"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('distinguishes boolean from string identifier key (AC-16)', async () => {
      // AC-16: Boolean true matches boolean key, not identifier "true"
      const result = await run('true -> [true: "bool", truthy: "identifier"]');
      expect(result).toBe('bool');
    });

    it('distinguishes identifier from boolean key', async () => {
      const result = await run('"truthy" -> [true: "b", truthy: "s"]');
      expect(result).toBe('s');
    });

    it('throws when number does not match identifier keys', async () => {
      await expect(run('1 -> [one: "s", two: "s"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('throws when string does not match number keys', async () => {
      await expect(run('"1" -> [1: "n", 2: "n"]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });
  });

  describe('Boundary Conditions', () => {
    it('works with empty dict (AC-12)', async () => {
      // AC-12: Empty dict should work (though no keys to match)
      await expect(run('"a" -> [:]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('works with single-entry number key dict (AC-13)', async () => {
      // AC-13: Single-entry dicts work for all key types
      const result = await run('42 -> [42: "answer"]');
      expect(result).toBe('answer');
    });

    it('works with single-entry boolean key dict (AC-13)', async () => {
      const result = await run('true -> [true: "yes"]');
      expect(result).toBe('yes');
    });

    it('works with single-entry identifier key dict (AC-13)', async () => {
      const result = await run('"key" -> [key: "value"]');
      expect(result).toBe('value');
    });

    it('duplicate number keys return first match (AC-6)', async () => {
      // AC-6: Duplicate keys produce first match (existing behavior)
      const result = await run('1 -> [1: "a", 1: "b"]');
      expect(result).toBe('a');
    });

    it('duplicate boolean keys return first match', async () => {
      const result = await run('true -> [true: "a", true: "b"]');
      expect(result).toBe('a');
    });
  });

  describe('Error Contracts', () => {
    it('throws RUNTIME_PROPERTY_NOT_FOUND when no match and no default (EC-4)', async () => {
      // EC-4: No matching key, no default → RuntimeError
      await expect(run('"z" -> [a: 1, b: 2]')).rejects.toThrow(
        /Dict dispatch.*key 'z' not found/i
      );
    });

    it('throws RUNTIME_TYPE_ERROR for tuple key in dict literal (EC-5)', async () => {
      // EC-5: Tuple key in dict literal → RuntimeError
      // AC-7: [[1,2]: "list key"] throws RUNTIME_TYPE_ERROR
      // Note: Multi-key syntax uses list literal [1, 2] in dict, which becomes a tuple
      await expect(run('[[1, 2]: "tuple"]')).rejects.toThrow(
        /Dict literal keys must be identifiers, not lists/i
      );
    });

    it('throws RUNTIME_TYPE_ERROR for reserved method name "keys" as dict key (EC-6)', async () => {
      // EC-6: Reserved method name as key → RuntimeError
      await expect(run('[keys: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'keys' as dict key/i
      );
    });

    it('throws RUNTIME_TYPE_ERROR for reserved method name "values" as dict key', async () => {
      await expect(run('[values: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'values' as dict key/i
      );
    });

    it('throws RUNTIME_TYPE_ERROR for reserved method name "entries" as dict key', async () => {
      await expect(run('[entries: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'entries' as dict key/i
      );
    });
  });
});
