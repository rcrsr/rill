/**
 * Rill Runtime Tests: Hierarchical Dispatch
 * Tests for nested navigation through dicts and lists via list-path dispatch
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Hierarchical Dispatch', () => {
  describe('Dict Path Navigation', () => {
    it('returns nested value for dict path (AC-1)', async () => {
      // AC-1: Dict path returns nested value
      const result = await run('["name", "first"] -> [name: [first: "Alice"]]');
      expect(result).toBe('Alice');
    });

    it('returns deeply nested value through multiple dicts', async () => {
      const result = await run(
        '["user", "profile", "name"] -> [user: [profile: [name: "Bob"]]]'
      );
      expect(result).toBe('Bob');
    });
  });

  describe('List Path Navigation', () => {
    it('returns nested element for list path (AC-2)', async () => {
      // AC-2: List path returns nested element (navigate to first list, get second element)
      const result = await run('[0, 1] -> [[1, 2, 3], [4, 5, 6]]');
      expect(result).toBe(2);
    });

    it('returns deeply nested element through multiple lists', async () => {
      const result = await run(
        '[0, 1, 2] -> [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9]]]'
      );
      expect(result).toBe(6);
    });
  });

  describe('Mixed Path Navigation', () => {
    it('navigates dict then list then dict (AC-3)', async () => {
      // AC-3: Mixed path navigates dict and list
      const result = await run(
        '["users", 0, "name"] -> [users: [[name: "Alice"]]]'
      );
      expect(result).toBe('Alice');
    });

    it('navigates list then dict then list', async () => {
      const result = await run('[0, "items", 1] -> [[items: [10, 20, 30]]]');
      expect(result).toBe(20);
    });

    it('navigates complex nested structure', async () => {
      const result = await run(
        '["data", 0, "score", 1] -> [data: [[score: [85, 92, 78]]]]'
      );
      expect(result).toBe(92);
    });
  });

  describe('Intermediate Closure Auto-Invocation', () => {
    it('auto-invokes intermediate zero-param closure (AC-4)', async () => {
      // AC-4: Intermediate zero-param closure auto-invokes
      const result = await run('["get", "name"] -> [get: ||([name: "Alice"])]');
      expect(result).toBe('Alice');
    });

    it('auto-invokes multiple intermediate closures in path', async () => {
      const result = await run(
        '["fn1", "fn2", "value"] -> [fn1: ||([fn2: ||([value: "result"])])]'
      );
      expect(result).toBe('result');
    });

    it('auto-invokes closure that returns list for further navigation', async () => {
      const result = await run('["getter", 0] -> [getter: ||([10, 20, 30])]');
      expect(result).toBe(10);
    });
  });

  describe('Terminal Closure Receives Final Key', () => {
    it('terminal closure receives $ = final key (AC-5)', async () => {
      // AC-5: Terminal closure receives `$` = final key
      const result = await run(
        '["req", "draft"] -> [req: [draft: { "key={$}" }]]'
      );
      expect(result).toBe('key=draft');
    });

    it('terminal closure accesses final key in computation', async () => {
      const result = await run(
        '["config", "timeout"] -> [config: [timeout: { $ -> .upper }]]'
      );
      expect(result).toBe('TIMEOUT');
    });

    it('terminal closure with numeric index key', async () => {
      const result = await run(
        '[0, 1] -> [[{ "index={$}" }, { "index={$}" }]]'
      );
      expect(result).toBe('index=1');
    });
  });

  describe('Empty and Single-Element Paths', () => {
    it('returns target unchanged for empty path (AC-6)', async () => {
      // AC-6: Empty path returns target unchanged
      const result = await run('[] -> [a: 1]');
      expect(result).toEqual({ a: 1 });
    });

    it('returns list unchanged for empty path', async () => {
      const result = await run('[] -> [1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('single-element path equals scalar dispatch (AC-7)', async () => {
      // AC-7: Single-element path equals scalar dispatch
      const result = await run('["a"] -> [a: 1]');
      expect(result).toBe(1);
    });

    it('single-element numeric path equals list dispatch', async () => {
      const result = await run('[0] -> [10, 20, 30]');
      expect(result).toBe(10);
    });
  });

  describe('Negative Index Navigation', () => {
    it('negative index at terminal works (AC-8)', async () => {
      // AC-8: Negative index at terminal works
      const result = await run('[0, -1] -> [[1, 2, 3]]');
      expect(result).toBe(3);
    });

    it('negative index at intermediate position', async () => {
      const result = await run('[-1, 0] -> [[1, 2], [3, 4], [5, 6]]');
      expect(result).toBe(5);
    });

    it('multiple negative indices in path', async () => {
      const result = await run('[-1, -1] -> [[1, 2], [3, 4, 5]]');
      expect(result).toBe(5);
    });
  });

  describe('Path with Variable Context', () => {
    it('uses variable as path for navigation', async () => {
      const result = await run(`
        ["user", "name"] => $path
        $path -> [user: [name: "Alice"]]
      `);
      expect(result).toBe('Alice');
    });

    it('captures hierarchical dispatch result', async () => {
      const result = await run(`
        ["data", 0] -> [data: [42, 100]] => $val
        $val + 8
      `);
      expect(result).toBe(50);
    });
  });

  describe('Chaining After Hierarchical Dispatch', () => {
    it('chains method call after path navigation', async () => {
      const result = await run(
        '["user", "name"] -> [user: [name: "alice"]] -> .upper'
      );
      expect(result).toBe('ALICE');
    });

    it('chains multiple operations after nested dispatch', async () => {
      const result = await run(
        '[0, "value"] -> [[value: "hello"]] -> .upper -> .len'
      );
      expect(result).toBe(5);
    });

    it('chains hierarchical dispatch into another dispatch', async () => {
      const result = await run(
        '["key", 0] -> [key: ["x", "y"]] -> [x: 1, y: 2]'
      );
      expect(result).toBe(1);
    });
  });

  describe('Boundary Conditions', () => {
    it('returns default value on missing key (AC-16)', async () => {
      // AC-16: Default value on missing key
      const result = await run('["a", "missing"] -> [a: [x: 1]] ?? "default"');
      expect(result).toBe('default');
    });

    it('returns default value on empty list navigation (AC-17)', async () => {
      // AC-17: Default value on out-of-bounds index
      const result = await run('["users", 10] -> [users: []] ?? "unknown"');
      expect(result).toBe('unknown');
    });

    it('uses variable as path for navigation (AC-18)', async () => {
      // AC-18: Variable path works
      const result = await run(`
        ["a", "b"] => $path
        $path -> [a: [b: 1]]
      `);
      expect(result).toBe(1);
    });

    it('uses computed path element in navigation (AC-19)', async () => {
      // AC-19: Computed path element works
      const result = await run(`
        "draft" => $action
        [status: [draft: "pending", published: "live"]] => $handlers
        ["status", $action] -> $handlers
      `);
      expect(result).toBe('pending');
    });

    it('provides numeric terminal key to closure (AC-20)', async () => {
      // AC-20: Numeric terminal key in `$`
      const result = await run(
        '["handlers", 0] -> [handlers: [{ "idx={$}" }]]'
      );
      expect(result).toBe('idx=0');
    });

    it('navigates 3-level nested structure (AC-21)', async () => {
      // AC-21: 3-level nesting works
      const result = await run(
        '["nested", "deep", "value"] -> [nested: [deep: [value: 42]]]'
      );
      expect(result).toBe(42);
    });

    it('invokes closure at terminal for single-element path (AC-22)', async () => {
      // AC-22: Single-element path with closure
      const result = await run('["fn"] -> [fn: ||("value")]');
      expect(result).toBe('value');
    });
  });

  describe('Error Cases', () => {
    it('throws RUNTIME_TYPE_ERROR for string key on list (AC-9/EC-1)', async () => {
      // AC-9/EC-1: String key on list throws type error
      // Implementation uses unified error message at hierarchical dispatch level
      await expect(run('["0"] -> [1, 2, 3]')).rejects.toThrow(
        /cannot use string key with list value/
      );
    });

    it('throws RUNTIME_TYPE_ERROR for number index on dict (AC-10/EC-2)', async () => {
      // AC-10/EC-2: Number index on dict throws type error
      // Implementation uses unified error message at hierarchical dispatch level
      await expect(run('[0] -> [a: 1]')).rejects.toThrow(
        /cannot use number key with dict value/
      );
    });

    it('throws RUNTIME_TYPE_ERROR for parameterized intermediate closure (AC-11/EC-3/EC-8)', async () => {
      // AC-11/EC-3/EC-8: Parameterized closure at intermediate position throws
      await expect(
        run('["compute", 0] -> [compute: |x|([x])]')
      ).rejects.toThrow(
        /Cannot invoke parameterized closure at intermediate path position/
      );
    });

    it('throws RUNTIME_TYPE_ERROR for parameterized terminal closure (AC-12/EC-9)', async () => {
      // AC-12/EC-9: Parameterized closure at terminal position throws
      await expect(run('["fn"] -> [fn: |x|($x * 2)]')).rejects.toThrow(
        /Dispatch does not provide arguments for parameterized closure/
      );
    });

    it('throws RUNTIME_PROPERTY_NOT_FOUND for missing intermediate key (AC-13/EC-4/EC-7)', async () => {
      // AC-13/EC-4/EC-7: Missing key in dict at intermediate position
      await expect(run('["a", "b"] -> [a: [:]]')).rejects.toThrow(
        /Dict dispatch.*not found/i
      );
    });

    it('throws RUNTIME_PROPERTY_NOT_FOUND for out of bounds index (AC-14/EC-5)', async () => {
      // AC-14/EC-5: Out of bounds list index
      await expect(run('[0, 5] -> [[1, 2]]')).rejects.toThrow(
        /List dispatch.*not found/i
      );
    });

    it('throws RUNTIME_TYPE_ERROR for type mismatch mid-path (AC-15/EC-7)', async () => {
      // AC-15/EC-7: Number index on string mid-path
      // Implementation uses unified error message at hierarchical dispatch level
      await expect(run('["a", 0] -> [a: "text"]')).rejects.toThrow(
        /cannot use number key with string value/
      );
    });

    it('propagates closure body errors (EC-10)', async () => {
      // EC-10: Closure body error propagates to caller
      // Note: ||{ error "boom" } is zero-param closure with error in body
      // ||({ error "boom" }) would return block-closure as value
      await expect(
        run('["fn", "nested"] -> [fn: [nested: ||{ error "boom" }]]')
      ).rejects.toThrow(/boom/);
    });
  });
});
