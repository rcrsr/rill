/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Dict Dispatch
 * Tests for dict literal as dispatch table when piped
 */

import { describe, expect, it } from 'vitest';

import { ParseError } from '@rcrsr/rill';

import { expectHalt, expectThrowMessage } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Dict Dispatch', () => {
  describe('Basic Key Matching', () => {
    it('returns matched value for exact key', async () => {
      // AC-25: Key match returns associated value
      const result = await run('"a" -> dict[a: 1, b: 2]');
      expect(result).toBe(1);
    });

    it('returns matched value for second key', async () => {
      const result = await run('"b" -> dict[a: 1, b: 2]');
      expect(result).toBe(2);
    });

    it('returns matched value for different string keys', async () => {
      const result = await run(
        '"apple" -> dict[apple: "fruit", carrot: "vegetable"]'
      );
      expect(result).toBe('fruit');
    });
  });

  describe('Error Cases', () => {
    it('throws RUNTIME_PROPERTY_NOT_FOUND when no match and no default', async () => {
      // AC-30: No match, no default
      // EC-12: RUNTIME_PROPERTY_NOT_FOUND error
      await expect(run('"z" -> dict[a: 1, b: 2]')).rejects.toThrow(
        /Undefined dict key/
      );
    });

    it('throws with descriptive message for missing key', async () => {
      await expect(run('"missing" -> dict[a: 1, b: 2]')).rejects.toThrow(
        /missing/i
      );
    });
  });

  describe('Closure Auto-Invocation', () => {
    it('auto-invokes closure value with piped key as $', async () => {
      // AC-27: Auto-invoke closure, $ is piped key
      const result = await run('"x" -> dict[x: fn { $ -> .upper }]');
      expect(result).toBe('X');
    });

    it('auto-invokes closure with transform logic', async () => {
      const result = await run('"hello" -> dict[hello: fn { "{$}!" }]');
      expect(result).toBe('hello!');
    });

    it('auto-invokes closure that accesses dict', async () => {
      const result = await run(`
        dict[name: "test"] => $d
        "key" -> dict[key: fn() { $d.name }]
      `);
      expect(result).toBe('test');
    });
  });

  describe('Chaining After Dispatch', () => {
    it('chains method call after dispatch', async () => {
      // AC-29: Chains with next operation
      const result = await run(
        '"done" -> dict[draft: "start", done: "end"] -> .upper'
      );
      expect(result).toBe('END');
    });

    it('chains multiple operations after dispatch', async () => {
      const result = await run(
        '"a" -> dict[a: "hello", b: "world"] -> .upper -> .len'
      );
      expect(result).toBe(5);
    });

    it('chains dispatch results into another dispatch', async () => {
      const result = await run(
        '"a" -> dict[a: "x", b: "y"] -> dict[x: 1, y: 2]'
      );
      expect(result).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('returns value from single-key dict', async () => {
      // AC-32: Single-key dict
      const result = await run('"a" -> dict[a: 1]');
      expect(result).toBe(1);
    });

    it('throws RUNTIME_PROPERTY_NOT_FOUND for empty dict (AC-33)', async () => {
      // AC-33: Dict with no matching keys
      // Should throw because there are no keys to match against
      await expect(run('"a" -> dict[b: 1]')).rejects.toThrow(
        /Undefined dict key/
      );
    });

    rule('dict.key-duplicate').it(
      'rejects a dict literal that spells a key twice',
      async () => {
        await expectThrowMessage(
          () => run('"a" -> dict[a: 1, a: 2]'),
          /Duplicate key 'a' in dict/,
          ParseError
        );
      }
    );

    it('preserves dict construction without pipe', async () => {
      // AC-35: Construction preserved (not dispatch)
      const result = await run(`
        dict[a: 1] => $d
        $d.a
      `);
      expect(result).toBe(1);
    });

    it('dispatches with complex value types', async () => {
      const result = await run(
        '"a" -> dict[a: list[1, 2, 3], b: list[4, 5]] -> slice<0:2>'
      );
      expect(result).toEqual([1, 2]);
    });

    it('dispatches to dict values', async () => {
      const result = await run(
        '"key" -> dict[key: dict[name: "test"]] -> .name'
      );
      expect(result).toBe('test');
    });
  });

  describe('Variable Context', () => {
    it('uses variable as dispatch key', async () => {
      const result = await run(`
        "b" => $key
        $key -> dict[a: 1, b: 2]
      `);
      expect(result).toBe(2);
    });

    it('captures dispatch result', async () => {
      const result = await run(`
        "a" -> dict[a: 10, b: 20] => $val
        $val + 5
      `);
      expect(result).toBe(15);
    });

    it('chains variable and dispatch', async () => {
      const result = await run(`
        "key" => $k
        $k -> dict[key: "found", other: "not"] => $r
        $r
      `);
      expect(result).toBe('found');
    });
  });

  describe('Default Operator', () => {
    it('returns default when no match (AC-26)', async () => {
      // AC-26: Dict Dispatch Success - Default Operator
      const result = await run('"c" -> dict[a: 1, b: 2] ?? 0');
      expect(result).toBe(0);
    });

    it('returns matched value when key exists (match takes precedence)', async () => {
      const result = await run('"a" -> dict[a: 1, b: 2] ?? 0');
      expect(result).toBe(1);
    });

    it('returns default with string value', async () => {
      const result = await run('"z" -> dict[a: "x", b: "y"] ?? "default"');
      expect(result).toBe('default');
    });

    it('returns default with expression', async () => {
      const result = await run('"missing" -> dict[a: 1] ?? (2 + 3)');
      expect(result).toBe(5);
    });

    it('chains after dispatch with default', async () => {
      const result = await run(
        '"c" -> dict[a: "hi", b: "bye"] ?? "hello" -> .upper'
      );
      expect(result).toBe('HELLO');
    });
  });

  describe('Multi-Key Dispatch', () => {
    it('returns value for multi-key match with first element (AC-28)', async () => {
      // AC-28: Multi-key dispatch - key "a" matches ["a", "b"]
      const result = await run('"a" -> dict[list["a", "b"]: "found"]');
      expect(result).toBe('found');
    });

    it('returns value for multi-key match with second element (AC-28)', async () => {
      const result = await run('"b" -> dict[list["a", "b"]: "found"]');
      expect(result).toBe('found');
    });

    it('returns value for multi-key match with middle element', async () => {
      const result = await run('"b" -> dict[list["a", "b", "c"]: "middle"]');
      expect(result).toBe('middle');
    });

    it('throws when no match in multi-key', async () => {
      await expect(run('"z" -> dict[list["a", "b"]: "found"]')).rejects.toThrow(
        /Undefined dict key/
      );
    });

    it('returns default when no match in multi-key', async () => {
      const result = await run(
        '"z" -> dict[list["a", "b"]: "found"] ?? "default"'
      );
      expect(result).toBe('default');
    });

    it('handles multiple multi-key entries', async () => {
      const result = await run(
        '"POST" -> dict[list["GET", "HEAD"]: "safe", list["POST", "PUT"]: "unsafe"]'
      );
      expect(result).toBe('unsafe');
    });

    it('matches first multi-key entry', async () => {
      const result = await run(
        '"GET" -> dict[list["GET", "HEAD"]: "safe", list["POST", "PUT"]: "unsafe"]'
      );
      expect(result).toBe('safe');
    });

    it('handles mixed single and multi-key entries', async () => {
      const result = await run(
        '"b" -> dict[a: "single", list["b", "c"]: "multi"]'
      );
      expect(result).toBe('multi');
    });

    it('matches single key before multi-key', async () => {
      const result = await run(
        '"a" -> dict[a: "single", list["b", "c"]: "multi"]'
      );
      expect(result).toBe('single');
    });

    it('auto-invokes closure in multi-key dispatch', async () => {
      const result = await run(
        '"x" -> dict[list["x", "y"]: fn { $ -> .upper }]'
      );
      expect(result).toBe('X');
    });
  });

  describe('Number and Boolean Literal Keys', () => {
    // A number or bool key is stored as the string of its source spelling.
    rule('dict.key-string').it(
      'dispatches the string spelling of a number literal key',
      async () => {
        expect(await run('"1" -> dict[1: "one", 2: "two"]')).toBe('one');
      }
    );

    rule('dict.key-string').it(
      'dispatches the string spelling of a second number literal key',
      async () => {
        expect(await run('"2" -> dict[1: "one", 2: "two"]')).toBe('two');
      }
    );

    rule('dict.key-string').it(
      'dispatches the string spelling of a negative number literal key',
      async () => {
        expect(await run('"-1" -> dict[-1: "negative", 1: "positive"]')).toBe(
          'negative'
        );
      }
    );

    rule('dict.key-string').it(
      'dispatches the string spelling of a decimal number literal key',
      async () => {
        expect(await run('"3.14" -> dict[3.14: "pi", 2.71: "e"]')).toBe('pi');
      }
    );

    rule('dict.key-string').it(
      'dispatches the string spelling of a boolean literal key',
      async () => {
        expect(await run('"true" -> dict[true: "yes", false: "no"]')).toBe(
          'yes'
        );
        expect(await run('"false" -> dict[true: "yes", false: "no"]')).toBe(
          'no'
        );
      }
    );

    it('throws when the string spelling is not a key', async () => {
      await expect(run('"3" -> dict[1: "one", 2: "two"]')).rejects.toThrow(
        /Undefined dict key/
      );
    });

    rule('selection.key-type').it(
      'halts when a number input meets a number-spelled key',
      async () => {
        await expectHalt(() => run('1 -> dict[1: "one", 2: "two"]'), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string/,
        });
      }
    );

    rule('selection.key-type').it(
      'halts when a boolean input meets a boolean-spelled key',
      async () => {
        await expectHalt(() => run('true -> dict[true: "yes"]'), {
          code: 'TYPE_MISMATCH',
          messagePattern: /Dict key must be string/,
        });
      }
    );

    it('uses default with number literal keys', async () => {
      const result = await run('"3" -> dict[1: "one", 2: "two"] ?? "other"');
      expect(result).toBe('other');
    });

    it('uses default with boolean literal keys', async () => {
      const result = await run('"false" -> dict[true: "yes"] ?? "no"');
      expect(result).toBe('no');
    });
  });

  describe('Type Discrimination', () => {
    it('distinguishes a number-spelled key from an identifier key', async () => {
      const result = await run('"1" -> dict[1: "number", one: "identifier"]');
      expect(result).toBe('number');
    });

    it('halts on a number input against a number-spelled key', async () => {
      await expectHalt(() => run('1 -> dict[1: "n"]'), {
        code: 'TYPE_MISMATCH',
        messagePattern: /Dict key must be string/,
      });
    });

    it('distinguishes a boolean-spelled key from an identifier key', async () => {
      const result = await run(
        '"true" -> dict[true: "bool", truthy: "identifier"]'
      );
      expect(result).toBe('bool');
    });

    it('distinguishes identifier from boolean key', async () => {
      const result = await run('"truthy" -> dict[true: "b", truthy: "s"]');
      expect(result).toBe('s');
    });

    it('halts on a number input against identifier keys', async () => {
      await expectHalt(() => run('1 -> dict[one: "s", two: "s"]'), {
        code: 'TYPE_MISMATCH',
        messagePattern: /Dict key must be string/,
      });
    });

    it('throws when string does not match number keys', async () => {
      await expect(run('"3" -> dict[1: "n", 2: "n"]')).rejects.toThrow(
        /Undefined dict key/
      );
    });
  });

  describe('Boundary Conditions', () => {
    it('works with empty dict (AC-12)', async () => {
      // AC-12: Empty dict should work (though no keys to match)
      await expect(run('"a" -> dict[]')).rejects.toThrow(/Undefined dict key/);
    });

    it('works with single-entry number key dict', async () => {
      const result = await run('"42" -> dict[42: "answer"]');
      expect(result).toBe('answer');
    });

    it('works with single-entry boolean key dict', async () => {
      const result = await run('"true" -> dict[true: "yes"]');
      expect(result).toBe('yes');
    });

    it('works with single-entry identifier key dict (AC-13)', async () => {
      const result = await run('"key" -> dict[key: "value"]');
      expect(result).toBe('value');
    });

    rule('dict.key-duplicate').it(
      'rejects a number key spelled twice with RILL-P027',
      async () => {
        await expectThrowMessage(
          () => run('"1" -> dict[1: "a", 1: "b"]'),
          /Duplicate key '1' in dict/,
          ParseError
        );
      }
    );

    rule('dict.key-duplicate').it(
      'rejects a boolean key spelled twice with RILL-P027',
      async () => {
        await expectThrowMessage(
          () => run('"true" -> dict[true: "a", true: "b"]'),
          /Duplicate key 'true' in dict/,
          ParseError
        );
      }
    );
  });

  describe('Error Contracts', () => {
    it('throws RUNTIME_PROPERTY_NOT_FOUND when no match and no default (EC-4)', async () => {
      // EC-4: No matching key, no default → RuntimeError
      await expectHalt(() => run('"z" -> dict[a: 1, b: 2]'), {
        code: 'RILL_R009',
        hostErrorId: 'RILL-R009',
        messagePattern: /Undefined dict key: z/,
      });
    });
  });

  describe('Multi-Key Dict Error Cases', () => {
    it('throws RUNTIME_TYPE_ERROR for empty multi-key list (AC-13, EC-4)', async () => {
      // AC-13: Empty multi-key -> error message contains "Multi-key dict entry requires non-empty list"
      // EC-4: Runtime error for empty key tuple
      // Empty list [] as dict key is treated as multi-key, evaluates at runtime
      await expectHalt(() => run('dict[list[]: 1]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /Multi-key dict entry requires non-empty list/i,
      });
    });

    it('halts with RILL-R002 when multi-key contains a list', async () => {
      // The list element is not a string, so key validation rejects it.
      await expectHalt(() => run('dict[list[list[1, 2], "valid"]: "value"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got list; quote the key',
      });
    });

    it('halts with RILL-R002 when multi-key contains a dict', async () => {
      // Dict key validation rejects the dict element.
      await expectHalt(() => run('dict[list[dict[a: 1], "valid"]: "value"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got dict; quote the key',
      });
    });

    it('halts with RILL-R002 when multi-key contains a closure', async () => {
      // Dict key validation rejects the closure element.
      await expectHalt(() => run('dict[list[fn() {1}, "valid"]: "value"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got fn; quote the key',
      });
    });

    it('halts when no key in a multi-key list is a string', async () => {
      // All elements are lists (arrays), so first one triggers the error
      await expectHalt(
        () => run('dict[list[list[1, 2], list[3, 4]]: "value"]'),
        {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern:
            'Multi-key dict entry keys must be string, got list; quote the key',
        }
      );
    });
  });

  describe('Multi-Key Dict Literals', () => {
    it('expands multi-key to multiple entries with same value (AC-6)', async () => {
      // AC-6: Basic multi-key - [["a", "b"]: 1] yields [a: 1, b: 1]
      const result = await run(`
        dict[list["a", "b"]: 1] => $dict
        list[$dict.a, $dict.b]
      `);
      expect(result).toEqual([1, 1]);
    });

    it('mixes multi-key entries with single-key entries (AC-8)', async () => {
      // AC-8: Mixed entries - [a: 0, ["b", "c"]: 1] yields [a: 0, b: 1, c: 1]
      const result = await run(`
        dict[a: 0, list["b", "c"]: 1] => $dict
        list[$dict.a, $dict.b, $dict.c]
      `);
      expect(result).toEqual([0, 1, 1]);
    });

    it('applies last-write-wins when multi-key overwrites existing key (AC-9)', async () => {
      // AC-9: Last-write-wins - [a: 0, ["a", "b"]: 1] yields [a: 1, b: 1]
      const result = await run(`
        dict[a: 0, list["a", "b"]: 1] => $dict
        list[$dict.a, $dict.b]
      `);
      expect(result).toEqual([1, 1]);
    });

    it('applies last-write-wins with multiple overwrites (AC-17)', async () => {
      // AC-17: Duplicate keys follow last-write-wins per entry order
      const result = await run(`
        dict[a: 0, list["a", "b"]: 1, list["a", "c"]: 2] => $dict
        list[$dict.a, $dict.b, $dict.c]
      `);
      expect(result).toEqual([2, 1, 2]);
    });

    it('expands multi-key with three elements', async () => {
      const result = await run(`
        dict[list["a", "b", "c"]: 5] => $dict
        list[$dict.a, $dict.b, $dict.c]
      `);
      expect(result).toEqual([5, 5, 5]);
    });

    it('handles multiple multi-key entries', async () => {
      const result = await run(`
        dict[list["a", "b"]: 1, list["c", "d"]: 2] => $dict
        list[$dict.a, $dict.b, $dict.c, $dict.d]
      `);
      expect(result).toEqual([1, 1, 2, 2]);
    });

    it('expands multi-key with string keys that spell numbers and booleans', async () => {
      const result = await run(`
        dict[list["true", "false"]: "bool", list["1", "2"]: "num"] => $dict
        list["true" -> $dict, "false" -> $dict, "1" -> $dict, "2" -> $dict]
      `);
      expect(result).toEqual(['bool', 'bool', 'num', 'num']);
    });

    it('halts when a multi-key element is a number', async () => {
      await expectHalt(() => run('dict[list[0.50, 2]: "a"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts when a multi-key element is a bool', async () => {
      await expectHalt(() => run('dict[list["a", true]: "x"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got bool; quote the key',
      });
    });

    it('halts when an ordered multi-key element is a number', async () => {
      await expectHalt(() => run('ordered[list[1, 2]: "a"]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts for a non-string element after a matching string element', async () => {
      await expectHalt(() => run('"a" -> dict[list["a", 1]: "x"]'), {
        code: 'RILL_R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts for a non-string element when the input matches no entry', async () => {
      await expectHalt(() => run('"b" -> dict[list["a", 1]: "x"]'), {
        code: 'RILL_R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts for a malformed entry after a matching spelled entry', async () => {
      await expectHalt(() => run('"a" -> dict[a: 1, list[1]: "x"]'), {
        code: 'RILL_R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts for a malformed entry whatever the input type', async () => {
      await expectHalt(() => run('1 -> dict[list[1, 2]: "x"]'), {
        code: 'RILL_R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('halts for an empty multi-key list in a dispatch table', async () => {
      await expectHalt(() => run('"a" -> dict[a: 1, list[]: "x"]'), {
        code: 'RILL_R002',
        messagePattern: 'Multi-key dict entry requires non-empty list',
      });
    });

    it('halts when a dispatch table multi-key element is a number', async () => {
      await expectHalt(() => run('"1" -> dict[list[1, 2]: "a"]'), {
        code: 'RILL_R002',
        messagePattern:
          'Multi-key dict entry keys must be string, got number; quote the key',
      });
    });

    it('expands multi-key with complex values', async () => {
      const result = await run(`
        dict[list["x", "y"]: list[1, 2, 3]] => $dict
        list[$dict.x, $dict.y]
      `);
      expect(result).toEqual([
        [1, 2, 3],
        [1, 2, 3],
      ]);
    });

    it('preserves value reference for multi-key entries', async () => {
      const result = await run(`
        dict[list["a", "b"]: dict[name: "test"]] => $dict
        $dict.a.name == $dict.b.name
      `);
      expect(result).toBe(true);
    });
  });
});
