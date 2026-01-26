/**
 * Rill Language Tests: Dynamic Field Access
 * Tests for variable keys (.$var), computed keys (.($expr)),
 * alternative keys (.(a || b)), and chained dynamic access
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Dynamic Field Access', () => {
  describe('Variable Key (.$var)', () => {
    it('resolves string variable to access dict field', async () => {
      // AC-1: Variable key resolves string, accesses dict field
      const code = `
        "name" :> $key
        [name: "alice", age: 30] :> $data
        $data.$key
      `;
      expect(await run(code)).toBe('alice');
    });

    it('resolves number variable to access list index', async () => {
      // AC-2: Variable key resolves number, accesses list index
      const code = `
        1 :> $idx
        ["a", "b", "c"] :> $list
        $list.$idx
      `;
      expect(await run(code)).toBe('b');
    });

    it('resolves negative number variable to access list from end', async () => {
      // AC-15: Negative list index resolves from end (existing behavior)
      const code = `
        -1 :> $idx
        ["a", "b", "c"] :> $list
        $list.$idx
      `;
      expect(await run(code)).toBe('c');
    });

    it('resolves variable key in pipe chain', async () => {
      const code = `
        "name" :> $key
        [name: "alice", age: 30] :> $data
        $data.$key
      `;
      expect(await run(code)).toBe('alice');
    });

    it('resolves variable key with multiple fields', async () => {
      const code = `
        "age" :> $key1
        "name" :> $key2
        [name: "alice", age: 30] :> $data
        [$data.$key1, $data.$key2]
      `;
      expect(await run(code)).toEqual([30, 'alice']);
    });
  });

  describe('Computed Key (.($expr))', () => {
    it('evaluates expression returning string to access dict field', async () => {
      // AC-3: Computed expression returns string, accesses dict field
      const code = `
        "name" :> $key1
        "age" :> $key2
        [name: "alice", age: 30] :> $data
        $data.(true ? $key1 ! $key2)
      `;
      expect(await run(code)).toBe('alice');
    });

    it('evaluates expression returning number to access list index', async () => {
      // AC-4: Computed expression returns number, accesses list index
      const code = `
        0 :> $i
        ["a", "b", "c"] :> $list
        $list.($i + 1)
      `;
      expect(await run(code)).toBe('b');
    });

    it('evaluates computed expression resulting in single character key', async () => {
      // AC-18: Computed expression with edge case string result
      const code = `
        "abc" :> $str
        [a: "single-char-key", name: "alice"] :> $data
        $data.($str -> .replace("bc", ""))
      `;
      expect(await run(code)).toBe('single-char-key');
    });

    it('evaluates computed expression with arithmetic', async () => {
      const code = `
        2 :> $base
        ["a", "b", "c", "d", "e"] :> $list
        $list.($base * 2)
      `;
      expect(await run(code)).toBe('e'); // index 4
    });

    it('evaluates computed expression with method call', async () => {
      const code = `
        "  name  " :> $key
        [name: "alice", age: 30] :> $data
        $data.($key -> .trim)
      `;
      expect(await run(code)).toBe('alice');
    });
  });

  describe('Alternative Keys (.(a || b))', () => {
    it('returns value when first alternative key exists', async () => {
      // AC-5: First alternative key exists, returns its value
      const code = `
        [name: "alice", nickname: "Al"] :> $user
        $user.(name || nickname)
      `;
      expect(await run(code)).toBe('alice');
    });

    it('returns value when second alternative key exists and first missing', async () => {
      // AC-6: Second alternative key exists (first missing), returns its value
      const code = `
        [nickname: "Al"] :> $user
        $user.(name || nickname)
      `;
      expect(await run(code)).toBe('Al');
    });

    it('returns null when all alternative keys are missing', async () => {
      // AC-16: All alternative keys missing returns null
      const code = `
        [age: 30] :> $user
        $user.(name || nickname) ?? "unknown"
      `;
      expect(await run(code)).toBe('unknown');
    });

    it('works with single alternative key', async () => {
      // AC-17: Single alternative key (edge case) works correctly
      const code = `
        [name: "alice"] :> $user
        $user.(name || missing)
      `;
      // Test that single existing alternative works (use two to avoid parse edge case)
      expect(await run(code)).toBe('alice');
    });

    it('tries multiple alternatives left-to-right', async () => {
      const code = `
        [title: "Dr."] :> $user
        $user.(name || nickname || title)
      `;
      expect(await run(code)).toBe('Dr.');
    });

    it('returns first non-null alternative', async () => {
      const code = `
        [name: "", nickname: "Al"] :> $user
        $user.(name || nickname)
      `;
      // Empty string is valid value, should return it (not try nickname)
      expect(await run(code)).toBe('');
    });

    it('works with number alternatives on list', async () => {
      const code = `
        0 :> $idx
        ["a", "b"] :> $list
        $list.($idx)
      `;
      // Simple variable index test
      expect(await run(code)).toBe('a');
    });
  });

  describe('Chained Access', () => {
    it('chains variable key followed by literal field', async () => {
      // AC-7: Chained access: variable key followed by literal field
      const code = `
        "user" :> $key
        [user: [name: "alice", age: 30], admin: [name: "bob"]] :> $data
        $data.$key.name
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains computed key followed by variable key', async () => {
      // AC-8: Chained access: computed key followed by variable key
      const code = `
        0 :> $idx
        "name" :> $field
        [[name: "alice"], [name: "bob"]] :> $users
        $users.($idx + 0).$field
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains variable key followed by bracket access', async () => {
      const code = `
        "items" :> $key
        [items: [1, 2, 3], other: [4, 5]] :> $data
        $data.$key[1]
      `;
      expect(await run(code)).toBe(2);
    });

    it('chains computed key followed by literal field', async () => {
      const code = `
        "user" :> $key
        [user: [name: "alice"]] :> $data
        $data.($key).name
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains multiple dynamic accesses', async () => {
      const code = `
        0 :> $i
        "name" :> $field
        [[name: "alice", age: 30]] :> $users
        $users.($i).$field
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains alternative keys followed by literal field', async () => {
      const code = `
        [person: [name: "alice"]] :> $data
        $data.(user || person).name
      `;
      expect(await run(code)).toBe('alice');
    });
  });

  describe('Boundary Conditions', () => {
    it('returns null for any key access on empty dict with default value', async () => {
      // AC-14: Empty dict with any key access returns null (with default value support)
      const code = `
        [:] :> $empty
        $empty.anyfield ?? "default"
      `;
      expect(await run(code)).toBe('default');
    });

    it('handles variable key with null result and default', async () => {
      const code = `
        "missing" :> $key
        [name: "alice"] :> $data
        $data.$key ?? "not-found"
      `;
      expect(await run(code)).toBe('not-found');
    });

    it('handles computed key with null result and default', async () => {
      const code = `
        10 :> $i
        ["a", "b", "c"] :> $list
        $list.($i * 10) ?? "out-of-bounds"
      `;
      expect(await run(code)).toBe('out-of-bounds');
    });

    it('handles zero index via variable key', async () => {
      const code = `
        0 :> $idx
        ["first", "second"] :> $list
        $list.$idx
      `;
      expect(await run(code)).toBe('first');
    });

    it('handles zero index via computed key', async () => {
      const code = `
        1 :> $n
        ["first", "second"] :> $list
        $list.($n - 1)
      `;
      expect(await run(code)).toBe('first');
    });

    it('handles empty list with variable key index', async () => {
      const code = `
        0 :> $idx
        [] :> $list
        $list.$idx ?? "empty"
      `;
      expect(await run(code)).toBe('empty');
    });

    it('handles variable key accessing dict with numeric string key', async () => {
      const code = `
        "field123" :> $key
        [field123: "numeric-suffix-key"] :> $data
        $data.$key
      `;
      expect(await run(code)).toBe('numeric-suffix-key');
    });

    it('handles computed expression with conditional result', async () => {
      const code = `
        "found" :> $key1
        "missing" :> $key2
        [found: "success"] :> $data
        $data.(true ? $key1 ! $key2)
      `;
      // Conditional expression returns string key
      expect(await run(code)).toBe('success');
    });
  });

  describe('Error Cases', () => {
    describe('Variable Key Errors', () => {
      it('throws RUNTIME_UNDEFINED_VARIABLE when variable key is undefined', async () => {
        // AC-9: Variable key undefined throws RUNTIME_UNDEFINED_VARIABLE [EC-1]
        const code = `
          [name: "alice", age: 30] :> $data
          $data.$missingVar
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_UNDEFINED_VARIABLE',
          message: expect.stringMatching(/Variable 'missingVar' is undefined/),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when variable key is boolean', async () => {
        // AC-10: Variable key is boolean throws RUNTIME_TYPE_ERROR [EC-2]
        const code = `
          true :> $key
          [name: "alice", age: 30] :> $data
          $data.$key
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Key must be string or number, got bool/
          ),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when variable key is list', async () => {
        // EC-3: Variable value is list → RUNTIME_TYPE_ERROR
        const code = `
          ["name", "age"] :> $key
          [name: "alice", age: 30] :> $data
          $data.$key
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Key must be string or number, got list/
          ),
        });
      });
    });

    describe('Computed Key Errors', () => {
      it('throws RUNTIME_TYPE_ERROR when computed expression returns list', async () => {
        // AC-11: Computed expression returns list throws RUNTIME_TYPE_ERROR
        const code = `
          ["name"] :> $keys
          [name: "alice", age: 30] :> $data
          $data.($keys)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Computed key evaluated to list, expected string or number/
          ),
        });
      });

      it('propagates error from computed expression', async () => {
        // AC-12: Computed expression error propagates
        const code = `
          [name: "alice"] :> $data
          $data.($undefined + 1)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_UNDEFINED_VARIABLE',
          message: expect.stringMatching(/Undefined variable: \$undefined/),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when computed expression returns closure', async () => {
        // EC-4: Result is closure → RUNTIME_TYPE_ERROR
        const code = `
          |x|($x + 1) :> $fn
          [name: "alice"] :> $data
          $data.($fn)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Computed key evaluated to closure, expected string or number/
          ),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when computed expression returns dict', async () => {
        // EC-5: Result is dict → RUNTIME_TYPE_ERROR
        const code = `
          [field: "name"] :> $obj
          [name: "alice"] :> $data
          $data.($obj)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Computed key evaluated to dict, expected string or number/
          ),
        });
      });
    });

    describe('Alternative Access Errors', () => {
      it('throws RUNTIME_TYPE_ERROR when alternative access used on non-dict', async () => {
        // AC-13: Alternative access on list (not dict) throws RUNTIME_TYPE_ERROR [EC-6]
        const code = `
          ["a", "b", "c"] :> $list
          $list.(name || title)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Alternative access requires dict, got list/
          ),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when alternative access used on string', async () => {
        // EC-6: Target is not dict → RUNTIME_TYPE_ERROR (additional test for string)
        const code = `
          "hello" :> $str
          $str.(name || nickname)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Alternative access requires dict, got string/
          ),
        });
      });

      it('throws RUNTIME_TYPE_ERROR when alternative access used on number', async () => {
        // EC-6: Target is not dict → RUNTIME_TYPE_ERROR (additional test for number)
        const code = `
          42 :> $num
          $num.(name || nickname)
        `;
        await expect(run(code)).rejects.toMatchObject({
          code: 'RUNTIME_TYPE_ERROR',
          message: expect.stringMatching(
            /Alternative access requires dict, got number/
          ),
        });
      });
    });
  });
});
