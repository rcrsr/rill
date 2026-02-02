/**
 * Rill Language Tests: Default Value Operator (??)
 * Tests for the ?? operator that provides fallback values for missing fields
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Default Value Operator (??)', () => {
  describe('Variable Access Chains', () => {
    it('returns field value when present', async () => {
      const result = await run(`
        [status: "active"] :> $data
        $data.status ?? "unknown"
      `);
      expect(result).toBe('active');
    });

    it('returns default when field missing', async () => {
      const result = await run(`
        [name: "test"] :> $data
        $data.status ?? "unknown"
      `);
      expect(result).toBe('unknown');
    });

    it('works with nested field access', async () => {
      const result = await run(`
        [user: [name: "alice"]] :> $data
        $data.user.age ?? 0
      `);
      expect(result).toBe(0);
    });

    it('works with pipe variable', async () => {
      const result = await run(`
        [name: "test"] -> ($.status ?? "default")
      `);
      expect(result).toBe('default');
    });

    it('works with variable key access', async () => {
      const result = await run(`
        [name: "test"] :> $data
        "missing" :> $key
        $data.$key ?? "not-found"
      `);
      expect(result).toBe('not-found');
    });

    it('works with computed key access', async () => {
      const result = await run(`
        [field1: "a", field2: "b"] :> $data
        3 :> $n
        $data.("field{$n}") ?? "missing"
      `);
      expect(result).toBe('missing');
    });
  });

  describe('Function Call Results', () => {
    it('works when result stored in variable first', async () => {
      const result = await run(
        `
        get_data() :> $data
        $data.status ?? "unknown"
      `,
        {
          functions: {
            get_data: {
              params: [],
              fn: () => ({ name: 'test' }), // no status field
            },
          },
        }
      );
      expect(result).toBe('unknown');
    });

    it('works with existence check pattern', async () => {
      const result = await run(
        `
        get_data() :> $data
        $data.?status ? $data.status ! "unknown"
      `,
        {
          functions: {
            get_data: {
              params: [],
              fn: () => ({ name: 'test' }),
            },
          },
        }
      );
      expect(result).toBe('unknown');
    });

    it('returns value when field exists using variable pattern', async () => {
      const result = await run(
        `
        get_data() :> $data
        $data.status ?? "unknown"
      `,
        {
          functions: {
            get_data: {
              params: [],
              fn: () => ({ status: 'active', name: 'test' }),
            },
          },
        }
      );
      expect(result).toBe('active');
    });
  });

  describe('Closure Pattern for Safe Access', () => {
    it('closure can wrap function call with default', async () => {
      const result = await run(
        `
        |path| {
          get_frontmatter($path) :> $fm
          $fm.status ?? ""
        } :> $get_status

        $get_status("test.md")
      `,
        {
          functions: {
            get_frontmatter: {
              params: [{ name: 'path', type: 'string' }],
              fn: () => ({ title: 'Test' }), // no status
            },
          },
        }
      );
      expect(result).toBe('');
    });

    it('closure returns actual value when present', async () => {
      const result = await run(
        `
        |path| {
          get_frontmatter($path) :> $fm
          $fm.status ?? ""
        } :> $get_status

        $get_status("test.md")
      `,
        {
          functions: {
            get_frontmatter: {
              params: [{ name: 'path', type: 'string' }],
              fn: () => ({ status: 'draft', title: 'Test' }),
            },
          },
        }
      );
      expect(result).toBe('draft');
    });
  });

  describe('Default Value Expressions', () => {
    it('default can be a literal', async () => {
      const result = await run(`
        [a: 1] :> $data
        $data.b ?? 42
      `);
      expect(result).toBe(42);
    });

    it('default can be an expression', async () => {
      const result = await run(`
        [a: 1] :> $data
        $data.b ?? (10 + 5)
      `);
      expect(result).toBe(15);
    });

    it('default can reference variables', async () => {
      const result = await run(`
        "fallback" :> $default
        [a: 1] :> $data
        $data.b ?? $default
      `);
      expect(result).toBe('fallback');
    });

    it('default can be a string', async () => {
      const result = await run(`
        [a: 1] :> $data
        $data.b ?? "not found"
      `);
      expect(result).toBe('not found');
    });

    it('default can be a list', async () => {
      const result = await run(`
        [a: 1] :> $data
        $data.b ?? [1, 2, 3]
      `);
      expect(result).toEqual([1, 2, 3]);
    });

    it('default can be a dict', async () => {
      const result = await run(`
        [a: 1] :> $data
        $data.b ?? [x: 1, y: 2]
      `);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('Chaining After Default', () => {
    it('can chain methods after default value', async () => {
      const result = await run(`
        [name: "test"] :> $data
        ($data.status ?? "unknown") -> .upper
      `);
      expect(result).toBe('UNKNOWN');
    });

    it('can pipe default result further', async () => {
      const result = await run(`
        [name: "test"] :> $data
        $data.count ?? 0 -> ($ + 10)
      `);
      expect(result).toBe(10);
    });
  });

  describe('Parser Limitation: Direct Function Call Member Access', () => {
    // This documents the current parser limitation where ?? cannot follow
    // member access on a function call result directly.
    // The workaround is to store in a variable first.

    it('LIMITATION: ?? after func().field is a parse error', async () => {
      // This pattern does NOT work:
      // get_data().status ?? "default"
      //
      // Workaround: store result first
      // get_data() :> $d
      // $d.status ?? "default"

      await expect(
        run(`get_data().status ?? "default"`, {
          functions: {
            get_data: {
              params: [],
              fn: () => ({ name: 'test' }),
            },
          },
        })
      ).rejects.toThrow(/Unexpected token.*\?\?/);
    });
  });
});
