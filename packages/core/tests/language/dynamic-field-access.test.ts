/**
 * Rill Language Tests: Dynamic Field Access
 * Tests for variable keys (.$var), computed keys ([expr]),
 * the removed parenthesized selector forms, and chained dynamic access
 */

import { describe, expect, it } from 'vitest';

import { expectHalt, expectThrowMessage } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Dynamic Field Access', () => {
  describe('Variable Key (.$var)', () => {
    it('resolves string variable to access dict field', async () => {
      // AC-1: Variable key resolves string, accesses dict field
      const code = `
        "name" => $key
        dict[name: "alice", age: 30] => $data
        $data.$key
      `;
      expect(await run(code)).toBe('alice');
    });

    it('resolves number variable to access list index', async () => {
      // AC-2: Variable key resolves number, accesses list index
      const code = `
        1 => $idx
        list["a", "b", "c"] => $list
        $list.$idx
      `;
      expect(await run(code)).toBe('b');
    });

    it('resolves negative number variable to access list from end', async () => {
      // AC-15: Negative list index resolves from end (existing behavior)
      const code = `
        -1 => $idx
        list["a", "b", "c"] => $list
        $list.$idx
      `;
      expect(await run(code)).toBe('c');
    });

    it('resolves variable key in pipe chain', async () => {
      const code = `
        "name" => $key
        dict[name: "alice", age: 30] => $data
        $data.$key
      `;
      expect(await run(code)).toBe('alice');
    });

    it('resolves variable key with multiple fields', async () => {
      // Mixed-type list [30, 'alice'] (number + string) not allowed; verify each field separately
      const code1 = `
        "age" => $key1
        dict[name: "alice", age: 30] => $data
        $data.$key1
      `;
      expect(await run(code1)).toBe(30);
      const code2 = `
        "name" => $key2
        dict[name: "alice", age: 30] => $data
        $data.$key2
      `;
      expect(await run(code2)).toBe('alice');
    });
  });

  describe('Computed Key ([expr])', () => {
    it('evaluates expression returning string to access dict field', async () => {
      // AC-3: Computed expression returns string, accesses dict field
      const code = `
        "name" => $key1
        "age" => $key2
        dict[name: "alice", age: 30] => $data
        $data[true ? $key1 ! $key2]
      `;
      expect(await run(code)).toBe('alice');
    });

    it('evaluates expression returning number to access list index', async () => {
      // AC-4: Computed expression returns number, accesses list index
      const code = `
        0 => $i
        list["a", "b", "c"] => $list
        $list[$i + 1]
      `;
      expect(await run(code)).toBe('b');
    });

    it('evaluates computed expression resulting in single character key', async () => {
      // AC-18: Computed expression with edge case string result
      const code = `
        "abc" => $str
        dict[a: "single-char-key", name: "alice"] => $data
        $data[$str -> .replace("bc", "")]
      `;
      expect(await run(code)).toBe('single-char-key');
    });

    it('evaluates computed expression with arithmetic', async () => {
      const code = `
        2 => $base
        list["a", "b", "c", "d", "e"] => $list
        $list[$base * 2]
      `;
      expect(await run(code)).toBe('e'); // index 4
    });

    it('evaluates computed expression with method call', async () => {
      const code = `
        "  name  " => $key
        dict[name: "alice", age: 30] => $data
        $data[$key -> .trim]
      `;
      expect(await run(code)).toBe('alice');
    });
  });

  describe('Removed parenthesized selector forms', () => {
    for (const [label, code] of [
      ['.(expr)', 'dict[a: 1] => $d\n$d.("a")'],
      ['.?(expr)', 'dict[a: 1] => $d\n$d.?("a")'],
      ['.(a || b) alternatives', 'dict[a: 1] => $d\n$d.(a || b)'],
      ['.{...} block', 'dict[a: 1] => $d\n$d.{ "a" }'],
    ] as const) {
      rule('selection.no-paren').it(
        `rejects ${label} naming both replacements`,
        async () => {
          await expectThrowMessage(
            () => run(code),
            /Syntax removed[\s\S]*\$c\[expr\][\s\S]*\$c\.\?\[expr\]/
          );
        }
      );
    }

    it('reports the removed parenthesized selector as RILL-P012', async () => {
      await expect(run('dict[a: 1] => $d\n$d.("a")')).rejects.toMatchObject({
        errorId: 'RILL-P012',
      });
    });
  });

  describe('Chained Access', () => {
    it('chains variable key followed by literal field', async () => {
      // AC-7: Chained access: variable key followed by literal field
      const code = `
        "user" => $key
        dict[user: dict[name: "alice", age: 30], admin: dict[name: "bob"]] => $data
        $data.$key.name
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains computed key followed by variable key', async () => {
      // AC-8: Chained access: computed key followed by variable key
      const code = `
        0 => $idx
        "name" => $field
        list[dict[name: "alice"], dict[name: "bob"]] => $users
        $users[$idx + 0].$field
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains variable key followed by bracket access', async () => {
      const code = `
        "items" => $key
        dict[items: list[1, 2, 3], other: list[4, 5]] => $data
        $data.$key[1]
      `;
      expect(await run(code)).toBe(2);
    });

    it('chains computed key followed by literal field', async () => {
      const code = `
        "user" => $key
        dict[user: dict[name: "alice"]] => $data
        $data[$key].name
      `;
      expect(await run(code)).toBe('alice');
    });

    it('chains multiple dynamic accesses', async () => {
      const code = `
        0 => $i
        "name" => $field
        list[dict[name: "alice", age: 30]] => $users
        $users[$i].$field
      `;
      expect(await run(code)).toBe('alice');
    });
  });

  describe('Boundary Conditions', () => {
    it('returns null for any key access on empty dict with default value', async () => {
      // AC-14: Empty dict with any key access returns null (with default value support)
      const code = `
        dict[] => $empty
        $empty.anyfield ?? "default"
      `;
      expect(await run(code)).toBe('default');
    });

    it('handles variable key with null result and default', async () => {
      const code = `
        "missing" => $key
        dict[name: "alice"] => $data
        $data.$key ?? "not-found"
      `;
      expect(await run(code)).toBe('not-found');
    });

    it('handles computed key with null result and default', async () => {
      const code = `
        10 => $i
        list["a", "b", "c"] => $list
        $list[$i * 10] ?? "out-of-bounds"
      `;
      expect(await run(code)).toBe('out-of-bounds');
    });

    it('handles zero index via variable key', async () => {
      const code = `
        0 => $idx
        list["first", "second"] => $list
        $list.$idx
      `;
      expect(await run(code)).toBe('first');
    });

    it('handles zero index via computed key', async () => {
      const code = `
        1 => $n
        list["first", "second"] => $list
        $list[$n - 1]
      `;
      expect(await run(code)).toBe('first');
    });

    it('handles empty list with variable key index', async () => {
      const code = `
        0 => $idx
        list[] => $list
        $list.$idx ?? "empty"
      `;
      expect(await run(code)).toBe('empty');
    });

    it('handles variable key accessing dict with numeric string key', async () => {
      const code = `
        "field123" => $key
        dict[field123: "numeric-suffix-key"] => $data
        $data.$key
      `;
      expect(await run(code)).toBe('numeric-suffix-key');
    });

    it('handles computed expression with conditional result', async () => {
      const code = `
        "found" => $key1
        "missing" => $key2
        dict[found: "success"] => $data
        $data[true ? $key1 ! $key2]
      `;
      // Conditional expression returns string key
      expect(await run(code)).toBe('success');
    });
  });

  describe('Error Cases', () => {
    describe('Variable Key Errors', () => {
      it('throws RILL-R005 when variable key is undefined', async () => {
        // AC-9: Variable key undefined throws RILL-R005 [EC-1]
        const code = `
          dict[name: "alice", age: 30] => $data
          $data.$missingVar
        `;
        await expect(run(code)).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringMatching(/Variable 'missingVar' is undefined/),
        });
      });

      it('halts #TYPE_MISMATCH when variable key is boolean', async () => {
        // AC-10: Variable key is boolean throws RILL-R002 [EC-2]
        const code = `
          true => $key
          dict[name: "alice", age: 30] => $data
          $data.$key
        `;
        await expectHalt(() => run(code), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string, got bool/,
        });
      });

      it('halts #TYPE_MISMATCH when variable key is list', async () => {
        // EC-3: Variable value is list → RILL-R002
        const code = `
          list["name", "age"] => $key
          dict[name: "alice", age: 30] => $data
          $data.$key
        `;
        await expectHalt(() => run(code), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string, got list/,
        });
      });
    });

    describe('Computed Key Errors', () => {
      it('halts #TYPE_MISMATCH when computed expression returns list', async () => {
        // AC-11: Computed expression returns list throws RILL-R002
        const code = `
          list["name"] => $keys
          dict[name: "alice", age: 30] => $data
          $data[$keys]
        `;
        await expectHalt(() => run(code), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string, got list/,
        });
      });

      it('propagates error from computed expression', async () => {
        // AC-12: Computed expression error propagates
        const code = `
          dict[name: "alice"] => $data
          $data[$undefined + 1]
        `;
        await expect(run(code)).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringMatching(/Undefined variable: \$undefined/),
        });
      });

      it('halts #TYPE_MISMATCH when computed expression returns closure', async () => {
        // EC-4: Result is closure → RILL-R002
        const code = `
          |x|($x + 1) => $fn
          dict[name: "alice"] => $data
          $data[$fn]
        `;
        await expectHalt(() => run(code), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string, got closure/,
        });
      });

      it('halts #TYPE_MISMATCH when computed expression returns dict', async () => {
        // EC-5: Result is dict → RILL-R002
        const code = `
          dict[field: "name"] => $obj
          dict[name: "alice"] => $data
          $data[$obj]
        `;
        await expectHalt(() => run(code), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string, got dict/,
        });
      });
    });
  });
});
