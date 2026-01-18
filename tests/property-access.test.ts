/**
 * Rill Runtime Tests: Property Access
 * Tests for extended property access features (05-property-access.md)
 */

import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

describe('Rill Runtime: Property Access', () => {
  describe('Bracket Indices', () => {
    it('accesses last element with [-1]', async () => {
      expect(await run('[1, 2, 3] -> $arr\n$arr[-1]')).toBe(3);
    });

    it('accesses second-to-last element with [-2]', async () => {
      expect(await run('[1, 2, 3, 4] -> $arr\n$arr[-2]')).toBe(3);
    });

    it('works with strings', async () => {
      expect(await run('"hello" -> $str\n$str[-1]')).toBe('o');
    });

    it('chains indices', async () => {
      expect(await run('[[1, 2], [3, 4], [5, 6]] -> $arr\n$arr[-1][0]')).toBe(
        5
      );
    });

    it('handles nested negative indices', async () => {
      expect(await run('[[1, 2], [3, 4]] -> $arr\n$arr[-1][-1]')).toBe(4);
    });

    it('accesses positive index', async () => {
      expect(await run('[10, 20, 30] -> $arr\n$arr[1]')).toBe(20);
    });
  });

  describe('Variable as Key', () => {
    it('accesses dict field via variable', async () => {
      const code = `
        "name" -> $key
        [name: "Alice", age: 30] -> $data
        $data.$key
      `;
      expect(await run(code)).toBe('Alice');
    });

    it('accesses list index via variable', async () => {
      const code = `
        1 -> $idx
        [10, 20, 30] -> $arr
        $arr.$idx
      `;
      expect(await run(code)).toBe(20);
    });

    it('chains variable access', async () => {
      const code = `
        "user" -> $field1
        "name" -> $field2
        [user: [name: "Bob"]] -> $data
        $data.$field1.$field2
      `;
      expect(await run(code)).toBe('Bob');
    });
  });

  describe('Computed Expression', () => {
    it('evaluates expression for index', async () => {
      const code = `
        1 -> $i
        [10, 20, 30] -> $arr
        $arr.($i + 1)
      `;
      expect(await run(code)).toBe(30);
    });

    it('evaluates expression for key', async () => {
      const code = `
        "user" -> $prefix
        [user_name: "Charlie"] -> $data
        $data.("{$prefix}_name")
      `;
      // Note: uses string interpolation for dynamic key
      expect(await run(code)).toBe('Charlie');
    });
  });

  describe('Alternatives', () => {
    it('returns first existing key', async () => {
      const code = `
        [name: "Dana"] -> $data
        $data.(nickname || name)
      `;
      expect(await run(code)).toBe('Dana');
    });

    it('returns first alternative when present', async () => {
      const code = `
        [nickname: "D", name: "Dana"] -> $data
        $data.(nickname || name)
      `;
      expect(await run(code)).toBe('D');
    });

    it('supports multiple alternatives', async () => {
      const code = `
        [id: 123] -> $data
        $data.(display_name || username || id)
      `;
      expect(await run(code)).toBe(123);
    });
  });

  describe('Default Values', () => {
    it('returns value when path exists', async () => {
      const code = `
        [name: "Eve"] -> $data
        $data.name ?? "Anonymous"
      `;
      expect(await run(code)).toBe('Eve');
    });

    it('returns default when path missing', async () => {
      const code = `
        [age: 25] -> $data
        $data.name ?? "Anonymous"
      `;
      expect(await run(code)).toBe('Anonymous');
    });

    it('returns default for null value', async () => {
      expect(await run('$missing ?? "fallback"')).toBe('fallback');
    });

    it('default can be a number', async () => {
      const code = `
        [name: "Frank"] -> $data
        $data.timeout ?? 30
      `;
      expect(await run(code)).toBe(30);
    });

    it('default with nested path', async () => {
      const code = `
        [user: []] -> $data
        $data.user.name ?? "Unknown"
      `;
      expect(await run(code)).toBe('Unknown');
    });

    it('chains with other operations', async () => {
      const code = `
        [items: []] -> $data
        ($data.items[-1] ?? 0) + 10
      `;
      expect(await run(code)).toBe(10);
    });
  });

  describe('Existence Checks', () => {
    it('returns true when field exists', async () => {
      const code = `
        [name: "Grace"] -> $data
        $data.?name
      `;
      expect(await run(code)).toBe(true);
    });

    it('returns false when field missing', async () => {
      const code = `
        [age: 28] -> $data
        $data.?name
      `;
      expect(await run(code)).toBe(false);
    });

    it('handles nested paths', async () => {
      const code = `
        [user: [profile: [avatar: "pic.jpg"]]] -> $data
        $data.user.profile.?avatar
      `;
      expect(await run(code)).toBe(true);
    });

    it('returns false for missing intermediate path', async () => {
      const code = `
        [user: []] -> $data
        $data.user.profile.?avatar
      `;
      expect(await run(code)).toBe(false);
    });

    it('returns false when optional key missing', async () => {
      const code = `
        [name: "Test"] -> $data
        $data.?missing
      `;
      expect(await run(code)).toBe(false);
    });

    it('returns true when optional key exists', async () => {
      const code = `
        [name: "Test", email: "t@t.com"] -> $data
        $data.?email
      `;
      expect(await run(code)).toBe(true);
    });
  });

  describe('Existence + Type Check', () => {
    it('returns true when exists and type matches', async () => {
      const code = `
        [age: 30] -> $data
        $data.?age&number
      `;
      expect(await run(code)).toBe(true);
    });

    it('returns false when exists but wrong type', async () => {
      const code = `
        [age: "thirty"] -> $data
        $data.?age&number
      `;
      expect(await run(code)).toBe(false);
    });

    it('returns false when field missing', async () => {
      const code = `
        [name: "Henry"] -> $data
        $data.?age&number
      `;
      expect(await run(code)).toBe(false);
    });

    it('checks for string type', async () => {
      const code = `
        [name: "Ivy"] -> $data
        $data.?name&string
      `;
      expect(await run(code)).toBe(true);
    });

    it('checks for bool type', async () => {
      const code = `
        [active: true] -> $data
        $data.?active&bool
      `;
      expect(await run(code)).toBe(true);
    });
  });

  describe('Combined Usage', () => {
    it('combines alternatives with default', async () => {
      const code = `
        [id: 1] -> $data
        $data.(nickname || name) ?? "Anonymous"
      `;
      expect(await run(code)).toBe('Anonymous');
    });

    it('uses existence check in conditional', async () => {
      const code = `
        [email: "j@example.com"] -> $data
        $data.?email ? "has email" ! "no email"
      `;
      expect(await run(code)).toBe('has email');
    });

    it('uses existence check with type in conditional', async () => {
      const code = `
        [count: "five"] -> $data
        $data.?count&number ? ($data.count * 2) ! 0
      `;
      expect(await run(code)).toBe(0);
    });

    it('negative index with default', async () => {
      const code = `
        [] -> $arr
        $arr[-1] ?? "empty"
      `;
      expect(await run(code)).toBe('empty');
    });
  });
});
