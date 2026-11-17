/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Dynamic Existence Check
 * Tests for dynamic existence check patterns including type qualifiers,
 * variable keys, and computed keys
 */

import { describe, expect, it } from 'vitest';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Dynamic Existence Check', () => {
  describe('Type-Qualified Existence Check (.?field&type)', () => {
    it('AC-3: returns true when field exists and type matches', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?x&number
      `);
      expect(result).toBe(true);
    });

    it('returns true for string type match', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?name&string
      `);
      expect(result).toBe(true);
    });

    it('returns true for boolean type match', async () => {
      const result = await run(`
        dict[active: true] => $data
        $data.?active&bool
      `);
      expect(result).toBe(true);
    });

    it('returns true for list type match', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        $data.?items&list
      `);
      expect(result).toBe(true);
    });

    it('returns true for dict type match', async () => {
      const result = await run(`
        dict[user: dict[name: "bob"]] => $data
        $data.?user&dict
      `);
      expect(result).toBe(true);
    });

    it('AC-5: returns false when field exists but type does not match', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?x&string
      `);
      expect(result).toBe(false);
    });

    it('returns false when field does not exist (type-qualified)', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?y&number
      `);
      expect(result).toBe(false);
    });

    it('returns false for number field checked as boolean', async () => {
      const result = await run(`
        dict[count: 42] => $data
        $data.?count&bool
      `);
      expect(result).toBe(false);
    });

    it('returns false for string field checked as list', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        $data.?name&list
      `);
      expect(result).toBe(false);
    });
  });

  describe('Variable Field Name Existence Check', () => {
    it('AC-4: returns true when variable field name exists', async () => {
      const result = await run(`
        "x" => $f
        dict[x: 1] => $data
        $data.?$f
      `);
      expect(result).toBe(true);
    });

    it('returns false when variable field name does not exist', async () => {
      const result = await run(`
        "missing" => $f
        dict[x: 1] => $data
        $data.?$f
      `);
      expect(result).toBe(false);
    });

    it('works with multiple variable keys', async () => {
      const result = await run(`
        "name" => $key1
        "age" => $key2
        dict[name: "alice", age: 30] => $data
        ($data.?$key1 && $data.?$key2)
      `);
      expect(result).toBe(true);
    });

    it('can check different keys using same variable', async () => {
      const result = await run(`
        dict[name: "alice", age: 30] => $data
        "name" => $key
        $data.?$key => $hasName
        "age" => $key
        $data.?$key => $hasAge
        ($hasName && $hasAge)
      `);
      expect(result).toBe(true);
    });
  });

  describe('Computed Field Name Existence Check', () => {
    it('checks existence using computed expression', async () => {
      const result = await run(`
        dict[name: "alice", age: 30] => $data
        $data.?["name"]
      `);
      expect(result).toBe(true);
    });

    it('returns false for computed key that does not exist', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?["missing"]
      `);
      expect(result).toBe(false);
    });

    it('works with complex computed expression', async () => {
      const result = await run(`
        dict[name_first: "alice"] => $data
        "name" => $prefix
        $data.?["{$prefix}_first"]
      `);
      expect(result).toBe(true);
    });
  });

  describe('Type-Qualified Computed Existence Check', () => {
    it('AC-5: returns false when computed field exists but type does not match', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?["x"]&string
      `);
      expect(result).toBe(false);
    });

    it('returns true when computed field exists and type matches', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?["x"]&number
      `);
      expect(result).toBe(true);
    });

    it('IC-8: returns true for computed dict type match', async () => {
      const result = await run(`
        dict[x: dict[a: 1]] => $data
        $data.?["x"]&dict
      `);
      expect(result).toBe(true);
    });

    it('returns false when computed field does not exist', async () => {
      const result = await run(`
        dict[x: 1] => $data
        $data.?["y"]&number
      `);
      expect(result).toBe(false);
    });
  });

  describe('Variable Key Type-Qualified Existence Check', () => {
    it('returns true when variable key field exists with matching type', async () => {
      const result = await run(`
        "x" => $f
        dict[x: 1] => $data
        $data.?$f&number
      `);
      expect(result).toBe(true);
    });

    it('IC-8: returns true for variable key with string type match', async () => {
      const result = await run(`
        "x" => $f
        dict[x: "hello"] => $data
        $data.?$f&string
      `);
      expect(result).toBe(true);
    });

    it('returns false when variable key field exists with non-matching type', async () => {
      const result = await run(`
        "x" => $f
        dict[x: 1] => $data
        $data.?$f&string
      `);
      expect(result).toBe(false);
    });

    it('returns false when variable key field does not exist', async () => {
      const result = await run(`
        "missing" => $f
        dict[x: 1] => $data
        $data.?$f&number
      `);
      expect(result).toBe(false);
    });
  });

  describe('Error Contracts', () => {
    describe('EC-9: Variable field name undefined', () => {
      it('AC-9: throws RUNTIME_UNDEFINED_VARIABLE when variable is undefined', async () => {
        await expect(
          run(`
            dict[x: 1] => $data
            $data.?$missing
          `)
        ).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringContaining("Variable 'missing' is undefined"),
        });
      });

      it('throws when using undefined variable in type-qualified check', async () => {
        await expect(
          run(`
            dict[x: 1] => $data
            $data.?$undefined&number
          `)
        ).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringContaining("Variable 'undefined' is undefined"),
        });
      });
    });

    describe('A non-string selector on a dict halts #TYPE_MISMATCH', () => {
      const cases: ReadonlyArray<readonly [string, string, string]> = [
        ['number variable', '42 => $k\n$data.?$k', 'number'],
        ['bool variable', 'true => $k\n$data.?$k', 'bool'],
        ['list variable', 'list[1, 2, 3] => $k\n$data.?$k', 'list'],
        ['dict variable', 'dict[a: 1] => $k\n$data.?$k', 'dict'],
        ['number bracket', '$data.?[42]', 'number'],
        ['bool bracket', '$data.?[true]', 'bool'],
        ['list bracket', '$data.?[list[1, 2]]', 'list'],
        ['dict bracket', '$data.?[dict[a: 1]]', 'dict'],
        ['typed number bracket', '$data.?[42]&number', 'number'],
      ];

      for (const [label, body, actual] of cases) {
        rule(
          'selection.key-type',
          'existence.bracket',
          'existence.key-type'
        ).it(`halts for a ${label}`, async () => {
          await expectHalt(() => run(`dict[x: 1] => $data\n${body}`), {
            code: 'TYPE_MISMATCH',
            messagePattern: `Dict key must be string, got ${actual}`,
          });
        });
      }

      it('string bracket selectors probe present and absent keys', async () => {
        expect(await run('dict[x: 1] => $data\n$data.?["x"]')).toBe(true);
        expect(await run('dict[x: 1] => $data\n$data.?["y"]')).toBe(false);
      });
    });
  });

  describe('Boundary Conditions', () => {
    describe('AC-15: Existence check on empty dict', () => {
      it('returns false for variable key on empty dict', async () => {
        const result = await run(`
          dict[] => $empty
          "x" => $field
          $empty.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on empty dict', async () => {
        const result = await run(`
          dict[] => $empty
          $empty.?["x"]
        `);
        expect(result).toBe(false);
      });

      it('returns false for type-qualified check on empty dict', async () => {
        const result = await run(`
          dict[] => $empty
          "x" => $field
          $empty.?$field&number
        `);
        expect(result).toBe(false);
      });
    });

    describe('AC-16: Existence check on non-dict', () => {
      const cases: ReadonlyArray<[string, string, string]> = [
        ['string', '"string"', 'Cannot index string'],
        ['number', '42', 'Cannot index number'],
        ['boolean', 'true', 'Cannot index bool'],
        ['list', 'list[1, 2, 3]', 'List index must be number, got string'],
      ];
      for (const [label, literal, message] of cases) {
        it(`returns false for variable key on ${label}`, async () => {
          expect(
            await run(`
              ${literal} => $value
              "x" => $field
              $value.?$field
            `)
          ).toBe(false);
        });

        it(`halts for computed key on ${label}`, async () => {
          await expectHalt(() => run(`${literal} => $value\n$value.?["x"]`), {
            code: 'RILL_R002',
            messagePattern: message,
          });
        });
      }

      it('returns false for type-qualified check on non-dict', async () => {
        expect(
          await run(`
            42 => $num
            "x" => $field
            $num.?$field&number
          `)
        ).toBe(false);
      });

      it('halts for a variable key that is not a string or number', async () => {
        await expectHalt(
          () => run('list[1, 2] => $list\nlist[1] => $k\n$list.?$k'),
          {
            code: 'RILL_R002',
            messagePattern: 'List index must be number, got list',
          }
        );
      });

      it('returns false for an out-of-range list index', async () => {
        expect(await run('list[1, 2].?[5]')).toBe(false);
      });

      it('halts for a non-number selector on a list', async () => {
        await expectHalt(() => run('list[1, 2].?["a"]'), {
          code: 'RILL_R002',
          messagePattern: 'List index must be number, got string',
        });
        await expectHalt(() => run('list[1, 2].?[list[1]]'), {
          code: 'RILL_R002',
          messagePattern: 'List index must be number, got list',
        });
      });

      it('halts for a non-number selector on a tuple', async () => {
        await expectHalt(() => run('tuple[1].?[true]'), {
          code: 'RILL_R002',
          messagePattern: 'Tuple index must be number, got bool',
        });
      });

      it('halts for a list selector on an ordered value', async () => {
        await expectHalt(() => run('ordered[a: 1].?[list[1]]'), {
          code: 'RILL_R002',
          messagePattern: 'Ordered index must be string or number, got list',
        });
      });

      it('probes an ordered value with the keys its read accepts', async () => {
        expect(await run('ordered[a: 1].?["a"]')).toBe(true);
        expect(await run('ordered[a: 1].?["b"]')).toBe(false);
        expect(await run('ordered[a: 1].?[0]')).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string as field name', async () => {
      const result = await run(`
        dict["": "value"] => $data
        "" => $key
        $data.?$key
      `);
      expect(result).toBe(true);
    });

    it('handles computed empty string', async () => {
      const result = await run(`
        dict["": "value"] => $data
        $data.?[""]
      `);
      expect(result).toBe(true);
    });

    it('works in conditional branches', async () => {
      const result = await run(`
        dict[x: 1] => $data
        "x" => $key
        ($data.?$key&number) ? "number field exists" ! "not found"
      `);
      expect(result).toBe('number field exists');
    });

    it('works with pipe variable', async () => {
      const result = await run(`
        "name" => $key
        dict[name: "alice"] -> ($.?$key)
      `);
      expect(result).toBe(true);
    });

    it('works in nested access chains', async () => {
      const result = await run(`
        dict[user: dict[name: "alice"]] => $data
        "name" => $key
        $data.user.?$key
      `);
      expect(result).toBe(true);
    });
  });

  describe('Integration: Dynamic Dict Keys + Dynamic Existence Checks (Task 3.4)', () => {
    describe('Create dict with dynamic key, then check existence with dynamic key', () => {
      it('creates dict with variable key and checks existence with same variable (AC-1, AC-4)', async () => {
        const result = await run(`
          "done" => $k
          dict[_static: 0, $k: 1] => $dict
          $dict.?$k
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and checks existence with different variable containing same value', async () => {
        const result = await run(`
          "name" => $key1
          "name" => $key2
          dict[_static: 0, $key1: "alice"] => $dict
          $dict.?$key2
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and checks non-existence with variable containing different value', async () => {
        const result = await run(`
          "exists" => $key1
          "missing" => $key2
          dict[_static: 0, $key1: 1] => $dict
          $dict.?$key2
        `);
        expect(result).toBe(false);
      });

      it('creates dict with multiple variable keys and checks all exist', async () => {
        const result = await run(`
          "name" => $k1
          "age" => $k2
          dict[_static: 0, $k1: "alice", $k2: 30] => $dict
          ($dict.?$k1 && $dict.?$k2)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and verifies type-qualified existence', async () => {
        const result = await run(`
          "score" => $k
          dict[_static: 0, $k: 42] => $dict
          $dict.?$k&number
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and rejects mismatched type in existence check', async () => {
        const result = await run(`
          "score" => $k
          dict[_static: 0, $k: 42] => $dict
          $dict.?$k&string
        `);
        expect(result).toBe(false);
      });
    });

    describe('Create dict with computed key, then access via computed existence check', () => {
      it('creates dict with computed key and checks existence with same computed expression', async () => {
        const result = await run(`
          dict[_static: 0, ("a" -> .upper): 1] => $dict
          $dict.?["a" -> .upper]
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key and checks existence with equivalent computed expression', async () => {
        const result = await run(`
          "test" => $base
          dict[_static: 0, ($base -> .upper): 1] => $dict
          $dict.?["TEST"]
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed arithmetic key and checks existence with same computation', async () => {
        const result = await run(`
          2 => $base
          dict[_static: 0, (($base + 3) -> string): "five"] => $dict
          $dict.?[5 -> string]
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed conditional key and checks existence', async () => {
        const result = await run(`
          true => $flag
          dict[_static: 0, ($flag ? "yes" ! "no"): "value"] => $dict
          $dict.?["yes"]
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key and verifies type-qualified existence', async () => {
        const result = await run(`
          dict[_static: 0, ("KEY" -> .lower): 42] => $dict
          $dict.?["key"]&number
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key from method chain and checks existence', async () => {
        const result = await run(`
          "  key  " => $raw
          dict[_static: 0, ($raw -> .trim -> .upper): "cleaned"] => $dict
          $dict.?["KEY"]
        `);
        expect(result).toBe(true);
      });
    });

    describe('Nested dynamic access patterns', () => {
      it('creates nested dict with dynamic keys and checks nested existence', async () => {
        const result = await run(`
          "outer" => $k1
          "inner" => $k2
          dict[_static: 0, $k1: dict[_nested: 0, $k2: "value"]] => $dict
          $dict.$k1.?$k2
        `);
        expect(result).toBe(true);
      });

      it('creates nested dict with computed keys and checks nested existence', async () => {
        const result = await run(`
          dict[_static: 0, ("a" -> .upper): dict[_nested: 0, ("b" -> .upper): 1]] => $dict
          $dict["A"].?["B"]
        `);
        expect(result).toBe(true);
      });

      it('creates nested dict with mixed dynamic keys and checks existence at each level', async () => {
        const result = await run(`
          "level1" => $k1
          dict[_static: 0, $k1: dict[_nested: 0, ("level2" -> .upper): "value"]] => $dict
          $dict.$k1.?["LEVEL2"]
        `);
        expect(result).toBe(true);
      });

      it('creates deeply nested dict with dynamic keys and type-qualified check', async () => {
        const result = await run(`
          "user" => $k1
          "profile" => $k2
          "age" => $k3
          dict[_static: 0, $k1: dict[_nested: 0, $k2: dict[_deep: 0, $k3: 30]]] => $dict
          $dict.$k1.$k2.?$k3&number
        `);
        expect(result).toBe(true);
      });

      it('uses dynamic key to navigate and computed key to check existence', async () => {
        const result = await run(`
          "data" => $navKey
          dict[_static: 0, $navKey: dict[_nested: 0, ("field" -> .upper): 1]] => $dict
          $dict.$navKey.?["FIELD"]
        `);
        expect(result).toBe(true);
      });

      it('creates list of dicts with dynamic keys and checks existence in each', async () => {
        const result = await run(`
          "name" => $key
          list[dict[_static: 0, $key: "alice"], dict[_static: 0, $key: "bob"]] => $list
          ($list[0].?$key && $list[1].?$key)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with dynamic key storing dict with computed key', async () => {
        const result = await run(`
          "outer" => $varKey
          dict[_static: 0, $varKey: dict[_nested: 0, ("inner" -> .upper): 42]] => $dict
          $dict.$varKey.?["INNER"]&number
        `);
        expect(result).toBe(true);
      });

      it('chains multiple dynamic existence checks with logical operators', async () => {
        const result = await run(`
          "a" => $k1
          "b" => $k2
          "c" => $k3
          dict[_static: 0, $k1: 1, $k2: 2] => $dict
          ($dict.?$k1 && $dict.?$k2 && !$dict.?$k3)
        `);
        expect(result).toBe(true);
      });
    });

    describe('Integration error handling', () => {
      it('throws when the existence check uses an undefined variable key', async () => {
        await expectHalt(
          () =>
            run(`
              dict[_static: 0] => $dict
              $dict.?$undefined
            `),
          {
            code: 'RILL_R005',
            hostErrorId: 'RILL-R005',
            messagePattern: "Variable 'undefined' is undefined",
          }
        );
      });

      it('dict literal rejects a computed number key before the existence check runs', async () => {
        await expectHalt(
          () =>
            run(`
              dict[_static: 0, (42): 1] => $dict
              $dict.?[42]
            `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: 'Dict key evaluated to number, expected string',
          }
        );
      });

      it('dict literal rejects a number variable key before the existence check runs', async () => {
        await expectHalt(
          () =>
            run(`
              42 => $n
              dict[_static: 0, $n: 1] => $dict
              $dict.?$n
            `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: 'Dict key must be string, got number',
          }
        );
      });
    });
  });
});
