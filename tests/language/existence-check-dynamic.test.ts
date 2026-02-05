/**
 * Rill Language Tests: Dynamic Existence Check
 * Tests for dynamic existence check patterns including type qualifiers,
 * variable keys, and computed keys
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Dynamic Existence Check', () => {
  describe('Type-Qualified Existence Check (.?field&type)', () => {
    it('AC-3: returns true when field exists and type matches', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?x&number
      `);
      expect(result).toBe(true);
    });

    it('returns true for string type match', async () => {
      const result = await run(`
        [name: "alice"] :> $data
        $data.?name&string
      `);
      expect(result).toBe(true);
    });

    it('returns true for boolean type match', async () => {
      const result = await run(`
        [active: true] :> $data
        $data.?active&bool
      `);
      expect(result).toBe(true);
    });

    it('returns true for list type match', async () => {
      const result = await run(`
        [items: [1, 2, 3]] :> $data
        $data.?items&list
      `);
      expect(result).toBe(true);
    });

    it('returns true for dict type match', async () => {
      const result = await run(`
        [user: [name: "bob"]] :> $data
        $data.?user&dict
      `);
      expect(result).toBe(true);
    });

    it('AC-5: returns false when field exists but type does not match', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?x&string
      `);
      expect(result).toBe(false);
    });

    it('returns false when field does not exist (type-qualified)', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?y&number
      `);
      expect(result).toBe(false);
    });

    it('returns false for number field checked as boolean', async () => {
      const result = await run(`
        [count: 42] :> $data
        $data.?count&bool
      `);
      expect(result).toBe(false);
    });

    it('returns false for string field checked as list', async () => {
      const result = await run(`
        [name: "test"] :> $data
        $data.?name&list
      `);
      expect(result).toBe(false);
    });
  });

  describe('Variable Field Name Existence Check', () => {
    it('AC-4: returns true when variable field name exists', async () => {
      const result = await run(`
        "x" :> $f
        [x: 1] :> $data
        $data.?$f
      `);
      expect(result).toBe(true);
    });

    it('returns false when variable field name does not exist', async () => {
      const result = await run(`
        "missing" :> $f
        [x: 1] :> $data
        $data.?$f
      `);
      expect(result).toBe(false);
    });

    it('works with multiple variable keys', async () => {
      const result = await run(`
        "name" :> $key1
        "age" :> $key2
        [name: "alice", age: 30] :> $data
        ($data.?$key1 && $data.?$key2)
      `);
      expect(result).toBe(true);
    });

    it('can check different keys using same variable', async () => {
      const result = await run(`
        [name: "alice", age: 30] :> $data
        "name" :> $key
        $data.?$key :> $hasName
        "age" :> $key
        $data.?$key :> $hasAge
        ($hasName && $hasAge)
      `);
      expect(result).toBe(true);
    });
  });

  describe('Computed Field Name Existence Check', () => {
    it('checks existence using computed expression', async () => {
      const result = await run(`
        [name: "alice", age: 30] :> $data
        $data.?("name")
      `);
      expect(result).toBe(true);
    });

    it('returns false for computed key that does not exist', async () => {
      const result = await run(`
        [name: "alice"] :> $data
        $data.?("missing")
      `);
      expect(result).toBe(false);
    });

    it('works with complex computed expression', async () => {
      const result = await run(`
        [name_first: "alice"] :> $data
        "name" :> $prefix
        $data.?("{$prefix}_first")
      `);
      expect(result).toBe(true);
    });
  });

  describe('Type-Qualified Computed Existence Check', () => {
    it('AC-5: returns false when computed field exists but type does not match', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?("x")&string
      `);
      expect(result).toBe(false);
    });

    it('returns true when computed field exists and type matches', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?("x")&number
      `);
      expect(result).toBe(true);
    });

    it('IC-8: returns true for computed dict type match', async () => {
      const result = await run(`
        [x: [a: 1]] :> $data
        $data.?("x")&dict
      `);
      expect(result).toBe(true);
    });

    it('returns false when computed field does not exist', async () => {
      const result = await run(`
        [x: 1] :> $data
        $data.?("y")&number
      `);
      expect(result).toBe(false);
    });
  });

  describe('Variable Key Type-Qualified Existence Check', () => {
    it('returns true when variable key field exists with matching type', async () => {
      const result = await run(`
        "x" :> $f
        [x: 1] :> $data
        $data.?$f&number
      `);
      expect(result).toBe(true);
    });

    it('IC-8: returns true for variable key with string type match', async () => {
      const result = await run(`
        "x" :> $f
        [x: "hello"] :> $data
        $data.?$f&string
      `);
      expect(result).toBe(true);
    });

    it('returns false when variable key field exists with non-matching type', async () => {
      const result = await run(`
        "x" :> $f
        [x: 1] :> $data
        $data.?$f&string
      `);
      expect(result).toBe(false);
    });

    it('returns false when variable key field does not exist', async () => {
      const result = await run(`
        "missing" :> $f
        [x: 1] :> $data
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
            [x: 1] :> $data
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
            [x: 1] :> $data
            $data.?$undefined&number
          `)
        ).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringContaining("Variable 'undefined' is undefined"),
        });
      });
    });

    describe('EC-10: Variable field name non-string', () => {
      it('AC-10: throws RUNTIME_TYPE_ERROR when variable contains number', async () => {
        await expect(
          run(`
            42 :> $n
            [x: 1] :> $data
            $data.?$n
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key must be string, got number'
          ),
        });
      });

      it('throws when variable contains boolean', async () => {
        await expect(
          run(`
            true :> $b
            [x: 1] :> $data
            $data.?$b
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key must be string, got bool'
          ),
        });
      });

      it('throws when variable contains list', async () => {
        await expect(
          run(`
            [1, 2, 3] :> $list
            [x: 1] :> $data
            $data.?$list
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key must be string, got list'
          ),
        });
      });

      it('throws when variable contains dict', async () => {
        await expect(
          run(`
            [a: 1] :> $dict
            [x: 1] :> $data
            $data.?$dict
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key must be string, got dict'
          ),
        });
      });
    });

    describe('EC-11: Computed key non-string', () => {
      it('throws RUNTIME_TYPE_ERROR when computed expression evaluates to number', async () => {
        await expect(
          run(`
            [x: 1] :> $data
            $data.?(42)
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key evaluated to number, expected string'
          ),
        });
      });

      it('throws when computed expression evaluates to boolean', async () => {
        await expect(
          run(`
            [x: 1] :> $data
            $data.?(true)
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key evaluated to bool, expected string'
          ),
        });
      });

      it('throws when computed expression evaluates to list', async () => {
        await expect(
          run(`
            [x: 1] :> $data
            $data.?([1, 2])
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key evaluated to list, expected string'
          ),
        });
      });

      it('throws when computed expression evaluates to dict', async () => {
        await expect(
          run(`
            [x: 1] :> $data
            $data.?([a: 1])
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key evaluated to dict, expected string'
          ),
        });
      });

      it('throws in type-qualified check when key is non-string', async () => {
        await expect(
          run(`
            [x: 1] :> $data
            $data.?(42)&number
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringContaining(
            'Existence check key evaluated to number, expected string'
          ),
        });
      });
    });
  });

  describe('Boundary Conditions', () => {
    describe('AC-15: Existence check on empty dict', () => {
      it('returns false for variable key on empty dict', async () => {
        const result = await run(`
          [] :> $empty
          "x" :> $field
          $empty.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on empty dict', async () => {
        const result = await run(`
          [] :> $empty
          $empty.?("x")
        `);
        expect(result).toBe(false);
      });

      it('returns false for type-qualified check on empty dict', async () => {
        const result = await run(`
          [] :> $empty
          "x" :> $field
          $empty.?$field&number
        `);
        expect(result).toBe(false);
      });
    });

    describe('AC-16: Existence check on non-dict', () => {
      it('returns false for variable key on string', async () => {
        const result = await run(`
          "string" :> $str
          "x" :> $field
          $str.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on string', async () => {
        const result = await run(`
          "string" :> $str
          $str.?("x")
        `);
        expect(result).toBe(false);
      });

      it('returns false for variable key on number', async () => {
        const result = await run(`
          42 :> $num
          "x" :> $field
          $num.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on number', async () => {
        const result = await run(`
          42 :> $num
          $num.?("x")
        `);
        expect(result).toBe(false);
      });

      it('returns false for variable key on boolean', async () => {
        const result = await run(`
          true :> $bool
          "x" :> $field
          $bool.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on boolean', async () => {
        const result = await run(`
          false :> $bool
          $bool.?("x")
        `);
        expect(result).toBe(false);
      });

      it('returns false for variable key on list', async () => {
        const result = await run(`
          [1, 2, 3] :> $list
          "x" :> $field
          $list.?$field
        `);
        expect(result).toBe(false);
      });

      it('returns false for computed key on list', async () => {
        const result = await run(`
          [1, 2, 3] :> $list
          $list.?("x")
        `);
        expect(result).toBe(false);
      });

      it('returns false for type-qualified check on non-dict', async () => {
        const result = await run(`
          42 :> $num
          "x" :> $field
          $num.?$field&number
        `);
        expect(result).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string as field name', async () => {
      const result = await run(`
        ["": "value"] :> $data
        "" :> $key
        $data.?$key
      `);
      expect(result).toBe(true);
    });

    it('handles computed empty string', async () => {
      const result = await run(`
        ["": "value"] :> $data
        $data.?("")
      `);
      expect(result).toBe(true);
    });

    it('works in conditional branches', async () => {
      const result = await run(`
        [x: 1] :> $data
        "x" :> $key
        ($data.?$key&number) ? "number field exists" ! "not found"
      `);
      expect(result).toBe('number field exists');
    });

    it('works with pipe variable', async () => {
      const result = await run(`
        "name" :> $key
        [name: "alice"] -> ($.?$key)
      `);
      expect(result).toBe(true);
    });

    it('works in nested access chains', async () => {
      const result = await run(`
        [user: [name: "alice"]] :> $data
        "name" :> $key
        $data.user.?$key
      `);
      expect(result).toBe(true);
    });
  });

  describe('Integration: Dynamic Dict Keys + Dynamic Existence Checks (Task 3.4)', () => {
    describe('Create dict with dynamic key, then check existence with dynamic key', () => {
      it('creates dict with variable key and checks existence with same variable (AC-1, AC-4)', async () => {
        const result = await run(`
          "done" :> $k
          [_static: 0, $k: 1] :> $dict
          $dict.?$k
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and checks existence with different variable containing same value', async () => {
        const result = await run(`
          "name" :> $key1
          "name" :> $key2
          [_static: 0, $key1: "alice"] :> $dict
          $dict.?$key2
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and checks non-existence with variable containing different value', async () => {
        const result = await run(`
          "exists" :> $key1
          "missing" :> $key2
          [_static: 0, $key1: 1] :> $dict
          $dict.?$key2
        `);
        expect(result).toBe(false);
      });

      it('creates dict with multiple variable keys and checks all exist', async () => {
        const result = await run(`
          "name" :> $k1
          "age" :> $k2
          [_static: 0, $k1: "alice", $k2: 30] :> $dict
          ($dict.?$k1 && $dict.?$k2)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and verifies type-qualified existence', async () => {
        const result = await run(`
          "score" :> $k
          [_static: 0, $k: 42] :> $dict
          $dict.?$k&number
        `);
        expect(result).toBe(true);
      });

      it('creates dict with variable key and rejects mismatched type in existence check', async () => {
        const result = await run(`
          "score" :> $k
          [_static: 0, $k: 42] :> $dict
          $dict.?$k&string
        `);
        expect(result).toBe(false);
      });
    });

    describe('Create dict with computed key, then access via computed existence check', () => {
      it('creates dict with computed key and checks existence with same computed expression', async () => {
        const result = await run(`
          [_static: 0, ("a" -> .upper): 1] :> $dict
          $dict.?("a" -> .upper)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key and checks existence with equivalent computed expression', async () => {
        const result = await run(`
          "test" :> $base
          [_static: 0, ($base -> .upper): 1] :> $dict
          $dict.?("TEST")
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed arithmetic key and checks existence with same computation', async () => {
        const result = await run(`
          2 :> $base
          [_static: 0, (($base + 3) -> .str): "five"] :> $dict
          $dict.?(5 -> .str)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed conditional key and checks existence', async () => {
        const result = await run(`
          true :> $flag
          [_static: 0, ($flag ? "yes" ! "no"): "value"] :> $dict
          $dict.?("yes")
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key and verifies type-qualified existence', async () => {
        const result = await run(`
          [_static: 0, ("KEY" -> .lower): 42] :> $dict
          $dict.?("key")&number
        `);
        expect(result).toBe(true);
      });

      it('creates dict with computed key from method chain and checks existence', async () => {
        const result = await run(`
          "  key  " :> $raw
          [_static: 0, ($raw -> .trim -> .upper): "cleaned"] :> $dict
          $dict.?("KEY")
        `);
        expect(result).toBe(true);
      });
    });

    describe('Nested dynamic access patterns', () => {
      it('creates nested dict with dynamic keys and checks nested existence', async () => {
        const result = await run(`
          "outer" :> $k1
          "inner" :> $k2
          [_static: 0, $k1: [_nested: 0, $k2: "value"]] :> $dict
          $dict.$k1.?$k2
        `);
        expect(result).toBe(true);
      });

      it('creates nested dict with computed keys and checks nested existence', async () => {
        const result = await run(`
          [_static: 0, ("a" -> .upper): [_nested: 0, ("b" -> .upper): 1]] :> $dict
          $dict.("A").?("B")
        `);
        expect(result).toBe(true);
      });

      it('creates nested dict with mixed dynamic keys and checks existence at each level', async () => {
        const result = await run(`
          "level1" :> $k1
          [_static: 0, $k1: [_nested: 0, ("level2" -> .upper): "value"]] :> $dict
          $dict.$k1.?("LEVEL2")
        `);
        expect(result).toBe(true);
      });

      it('creates deeply nested dict with dynamic keys and type-qualified check', async () => {
        const result = await run(`
          "user" :> $k1
          "profile" :> $k2
          "age" :> $k3
          [_static: 0, $k1: [_nested: 0, $k2: [_deep: 0, $k3: 30]]] :> $dict
          $dict.$k1.$k2.?$k3&number
        `);
        expect(result).toBe(true);
      });

      it('uses dynamic key to navigate and computed key to check existence', async () => {
        const result = await run(`
          "data" :> $navKey
          [_static: 0, $navKey: [_nested: 0, ("field" -> .upper): 1]] :> $dict
          $dict.$navKey.?("FIELD")
        `);
        expect(result).toBe(true);
      });

      it('creates list of dicts with dynamic keys and checks existence in each', async () => {
        const result = await run(`
          "name" :> $key
          [[_static: 0, $key: "alice"], [_static: 0, $key: "bob"]] :> $list
          ($list[0].?$key && $list[1].?$key)
        `);
        expect(result).toBe(true);
      });

      it('creates dict with dynamic key storing dict with computed key', async () => {
        const result = await run(`
          "outer" :> $varKey
          [_static: 0, $varKey: [_nested: 0, ("inner" -> .upper): 42]] :> $dict
          $dict.$varKey.?("INNER")&number
        `);
        expect(result).toBe(true);
      });

      it('chains multiple dynamic existence checks with logical operators', async () => {
        const result = await run(`
          "a" :> $k1
          "b" :> $k2
          "c" :> $k3
          [_static: 0, $k1: 1, $k2: 2] :> $dict
          ($dict.?$k1 && $dict.?$k2 && !$dict.?$k3)
        `);
        expect(result).toBe(true);
      });
    });

    describe('Integration error handling', () => {
      it('throws when variable used in dict key and existence check is undefined', async () => {
        await expect(
          run(`
            [_static: 0, $undefined: 1] :> $dict
            $dict.?$undefined
          `)
        ).rejects.toMatchObject({
          errorId: 'RILL-R005',
          message: expect.stringContaining("Variable 'undefined' is undefined"),
        });
      });

      it('throws when computed key expression in dict and existence check evaluates to non-string', async () => {
        await expect(
          run(`
            [_static: 0, (42): 1] :> $dict
            $dict.?(42)
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
        });
      });

      it('throws when variable contains non-string in both dict key and existence check', async () => {
        await expect(
          run(`
            42 :> $n
            [_static: 0, $n: 1] :> $dict
            $dict.?$n
          `)
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
        });
      });
    });
  });
});
