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

  describe('Skipped Tests (Parser Limitations)', () => {
    it.skip('number literal keys - parser limitation', async () => {
      // SKIP: Parser requires identifier keys, not number literals
      // Expected: '1 -> [1: "one", 2: "two"]' returns "one"
      // Rationale: Parser throws "Expected key" for number literals
      // Limitation: Dict keys must be identifiers (strings) in rill syntax
    });

    it.skip('boolean literal keys - parser limitation', async () => {
      // SKIP: Parser requires identifier keys, not boolean literals
      // Expected: 'true -> [true: "yes", false: "no"]' returns "yes"
      // Rationale: Parser throws "Expected key" for boolean literals
      // Limitation: Dict keys must be identifiers (strings) in rill syntax
    });
  });
});
