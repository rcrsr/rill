/**
 * Rill Language Tests: Default Value Operator (??)
 * Tests for the ?? operator that provides fallback values for missing fields
 */

import { describe, expect, it } from 'vitest';
import { isInvalid, isTuple } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

describe('Default Value Operator (??)', () => {
  describe('Variable Access Chains', () => {
    it('returns field value when present', async () => {
      const result = await run(`
        dict[status: "active"] => $data
        $data.status ?? "unknown"
      `);
      expect(result).toBe('active');
    });

    it('returns default when field missing', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        $data.status ?? "unknown"
      `);
      expect(result).toBe('unknown');
    });

    it('works with nested field access', async () => {
      const result = await run(`
        dict[user: dict[name: "alice"]] => $data
        $data.user.age ?? 0
      `);
      expect(result).toBe(0);
    });

    it('works with pipe variable', async () => {
      const result = await run(`
        dict[name: "test"] -> ($.status ?? "default")
      `);
      expect(result).toBe('default');
    });

    it('works with variable key access', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        "missing" => $key
        $data.$key ?? "not-found"
      `);
      expect(result).toBe('not-found');
    });

    it('works with computed key access', async () => {
      const result = await run(`
        dict[field1: "a", field2: "b"] => $data
        3 => $n
        $data.("field{$n}") ?? "missing"
      `);
      expect(result).toBe('missing');
    });
  });

  describe('Function Call Results', () => {
    it('works when result stored in variable first', async () => {
      const result = await run(
        `
        get_data() => $data
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
        get_data() => $data
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
        get_data() => $data
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
          get_frontmatter($path) => $fm
          $fm.status ?? ""
        } => $get_status

        $get_status("test.md")
      `,
        {
          functions: {
            get_frontmatter: {
              params: [
                {
                  name: 'path',
                  type: { kind: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
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
          get_frontmatter($path) => $fm
          $fm.status ?? ""
        } => $get_status

        $get_status("test.md")
      `,
        {
          functions: {
            get_frontmatter: {
              params: [
                {
                  name: 'path',
                  type: { kind: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
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
        dict[a: 1] => $data
        $data.b ?? 42
      `);
      expect(result).toBe(42);
    });

    it('default can be an expression', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? (10 + 5)
      `);
      expect(result).toBe(15);
    });

    it('default can reference variables', async () => {
      const result = await run(`
        "fallback" => $default
        dict[a: 1] => $data
        $data.b ?? $default
      `);
      expect(result).toBe('fallback');
    });

    it('default can be a string', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? "not found"
      `);
      expect(result).toBe('not found');
    });

    it('default can be a list', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? list[1, 2, 3]
      `);
      expect(result).toEqual([1, 2, 3]);
    });

    it('default can be a dict', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? dict[x: 1, y: 2]
      `);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('Chaining After Default', () => {
    it('can chain methods after default value', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        ($data.status ?? "unknown") -> .upper
      `);
      expect(result).toBe('UNKNOWN');
    });

    it('can pipe default result further', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        $data.count ?? 0 -> ($ + 10)
      `);
      expect(result).toBe(10);
    });
  });

  describe('Postfix Expression Default Values', () => {
    it('returns field value when present on function call result', async () => {
      const result = await run(`get_data().status ?? "default"`, {
        functions: {
          get_data: {
            params: [],
            fn: () => ({ status: 'active', name: 'test' }),
          },
        },
      });
      expect(result).toBe('active');
    });

    it('returns default when field missing on function call result', async () => {
      const result = await run(`get_data().status ?? "default"`, {
        functions: {
          get_data: {
            params: [],
            fn: () => ({ name: 'test' }), // no status field
          },
        },
      });
      expect(result).toBe('default');
    });

    it('works with chained method calls before default', async () => {
      const result = await run(`api().result.nested ?? 0`, {
        functions: {
          api: {
            params: [],
            fn: () => ({ result: {} }), // nested missing
          },
        },
      });
      expect(result).toBe(0);
    });

    it('works with dict as default value', async () => {
      const result = await run(`func().field ?? dict[a: 1]`, {
        functions: {
          func: {
            params: [],
            fn: () => ({}), // field missing
          },
        },
      });
      expect(result).toEqual({ a: 1 });
    });

    it('works with empty string as default', async () => {
      const result = await run(`func().x ?? ""`, {
        functions: {
          func: {
            params: [],
            fn: () => ({}),
          },
        },
      });
      expect(result).toBe('');
    });

    it('handles deeply nested access chains', async () => {
      const result = await run(`a().b().c().d ?? 0`, {
        functions: {
          a: {
            params: [],
            fn: () => ({
              b: () => ({
                c: () => ({}), // d missing
              }),
            }),
          },
        },
      });
      expect(result).toBe(0);
    });

    it('evaluates complex expressions as default', async () => {
      const result = await run(`f().x ?? (1 + 2 * 3)`, {
        functions: {
          f: {
            params: [],
            fn: () => ({}),
          },
        },
      });
      expect(result).toBe(7);
    });
  });

  describe('Error Cases', () => {
    it('throws on ?? without left operand', async () => {
      await expect(run('?? "orphan"')).rejects.toThrow();
    });

    // Error-handling phase 1 (task 1.4) removes the .?/?? mutual-exclusion.
    // Composing existence check with default value is now permitted; the
    // vacant-then-default semantics are owned by FR-ERR-4 in phase 2.
  });

  describe('Pipe Target Default (-> .field ?? default / -> .method ?? default)', () => {
    it('returns fallback for a vacant field reached via -> .field', async () => {
      const result = await run(`
        dict[other: 1] => $d
        $d -> .name ?? "none"
      `);
      expect(result).toBe('none');
    });

    it('returns the field value when present via -> .field', async () => {
      const result = await run(`
        dict[name: "alice"] => $d
        $d -> .name ?? "none"
      `);
      expect(result).toBe('alice');
    });

    it('parses -> .method() ?? default and returns the method result', async () => {
      const result = await run(`
        "  hi  " -> .trim() ?? "none"
      `);
      expect(result).toBe('hi');
    });

    it('parses chained -> .method -> .method ?? default', async () => {
      const result = await run(`
        "hi" -> .upper -> .trim ?? "none"
      `);
      expect(result).toBe('HI');
    });

    it('returns the deep value for a multi-method dot chain via -> .a.b', async () => {
      const result = await run(`
        dict[a: dict[b: 5]] -> .a.b ?? "x"
      `);
      expect(result).toBe(5);
    });

    it('returns fallback when the final field of a multi-method dot chain is missing', async () => {
      const result = await run(`
        dict[a: dict[b: 5]] -> .a.missing ?? "x"
      `);
      expect(result).toBe('x');
    });

    it('returns fallback for an empty string reached via -> .field (pipe target)', async () => {
      const result = await run(`
        dict[a: ""] -> .a ?? "d"
      `);
      expect(result).toBe('d');
    });

    it('returns fallback for an empty string reached via -> .method (pipe target)', async () => {
      const result = await run(`
        "" -> .upper ?? "d"
      `);
      expect(result).toBe('d');
    });

    it('returns fallback for a bare empty string as the pipe target', async () => {
      const result = await run(`
        ("") ?? "d"
      `);
      expect(result).toBe('d');
    });

    it('returns fallback for a bare empty list as the pipe target', async () => {
      const result = await run(`
        (list[]) ?? "d"
      `);
      expect(result).toBe('d');
    });

    it('returns fallback for an empty string reached via a variable path', async () => {
      const result = await run(`
        dict[a: ""] => $d
        $d.a ?? "d"
      `);
      expect(result).toBe('d');
    });
  });

  describe('Vacancy trigger on invalid LHS', () => {
    it('?? falls back when bare LHS is an invalid value from guard', async () => {
      const result = await run('guard { "a" -> number } ?? "fb"');
      expect(result).toBe('fb');
      expect(isInvalid(result as never)).toBe(false);
    });
  });

  describe('Composition with existence check (.?)', () => {
    // Phase 1 task 1.4 removed the `.?` / `??` parser mutex. Phase 2 task 2.2
    // wired vacancy-triggered defaults for the non-existence-check paths.
    // These tests lock in the observed semantics of composing the two forms.
    //
    // Actual semantic contract:
    //   1. `$x.?field ?? default` — `.?field` (existence check with a final
    //      access) returns a bool. `??` trigger never fires on a valid bool,
    //      so the default is effectively dead code. The expression always
    //      evaluates to the existence bool.
    //   2. `$x.?` with no final access is NOT an existence check. The parser
    //      accepts the trailing `.?` but produces no existence-check node;
    //      the variable value passes through. `??` then applies the
    //      bare-variable vacancy trigger (null or invalid).
    //   3. Access-chain vacancy rule still applies when a chain precedes a
    //      non-existence-check final access (covered by other suites).

    it('returns true when .?field matches present field (?? is dead code)', async () => {
      const result = await run(`
        dict[status: "active"] => $data
        $data.?status ?? "fallback"
      `);
      expect(result).toBe(true);
    });

    it('returns false when .?field targets an absent field (?? is dead code)', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        $data.?status ?? "fallback"
      `);
      expect(result).toBe(false);
    });

    it('returns true when type-qualified existence check matches', async () => {
      const result = await run(`
        dict[status: "active"] => $data
        $data.?status&string ?? "fallback"
      `);
      expect(result).toBe(true);
    });

    it('returns false when type-qualified existence check rejects wrong type', async () => {
      const result = await run(`
        dict[status: 42] => $data
        $data.?status&string ?? "fallback"
      `);
      expect(result).toBe(false);
    });

    it('returns true when nested .?field resolves to a present field', async () => {
      const result = await run(`
        dict[inner: dict[a: 1]] => $data
        $data.inner.?a ?? "fallback"
      `);
      expect(result).toBe(true);
    });

    it('returns false when nested .?field targets an absent nested field', async () => {
      const result = await run(`
        dict[inner: dict[b: 1]] => $data
        $data.inner.?a ?? "fallback"
      `);
      expect(result).toBe(false);
    });

    it('passes non-empty valid $x through when trailing .? has no field', async () => {
      // `$x.?` with nothing after `.?` is parsed without an existence check,
      // so it behaves as `$x ?? default`. Valid non-empty LHS passes through.
      const result = await run(`
        "hello" => $x
        $x.? ?? "fallback"
      `);
      expect(result).toBe('hello');
    });
  });

  describe('Intermediate access-chain steps do not short-circuit on empty', () => {
    it('evaluates .empty on an empty list variable instead of defaulting early', async () => {
      const result = await run(`
        list[] => $l
        $l.empty ?? false
      `);
      expect(result).toBe(true);
    });

    it('evaluates .empty on an empty dict variable instead of defaulting early', async () => {
      const result = await run(`
        dict[] => $d
        $d.empty ?? false
      `);
      expect(result).toBe(true);
    });

    it('evaluates .empty on an empty list nested behind an intermediate field', async () => {
      const result = await run(`
        dict[a: list[]] => $d
        $d.a.empty ?? false
      `);
      expect(result).toBe(true);
    });

    it('evaluates .empty when the empty list is the pipe target itself', async () => {
      const result = await run('list[] -> .empty ?? false');
      expect(result).toBe(true);
    });

    it('still applies the default when the final step resolves to a genuinely vacant value', async () => {
      const result = await run(`
        dict[a: dict[]] => $d
        $d.a.missing ?? "fallback"
      `);
      expect(result).toBe('fallback');
    });
  });

  // ============================================================
  // ?? accepts any expression on its right-hand side, so the
  // literal forms newly accepted in restricted default-value
  // positions (closure param and structural type field defaults)
  // already worked here. These are regression guards confirming
  // that behavior is unchanged.
  // ============================================================

  describe('Additional literal forms on the right-hand side', () => {
    it('negative number default', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? -7
      `);
      expect(result).toBe(-7);
    });

    it('atom literal default', async () => {
      const result = await run(`
        dict[a: 1] => $data
        ($data.b ?? #TIMEOUT) -> string
      `);
      expect(result).toBe('TIMEOUT');
    });

    it('keyword tuple literal default', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? tuple[1, "a"]
      `);
      expect(isTuple(result)).toBe(true);
    });

    it('keyword ordered literal default', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data.b ?? ordered[x: 1]
      `);
      expect(isOrdered(result)).toBe(true);
    });

    it('an arbitrary expression still works on the right-hand side (?? is not literal-restricted)', async () => {
      const result = await run(`
        dict[a: 1] => $data
        1 => $x
        $data.b ?? ($x + 1)
      `);
      expect(result).toBe(2);
    });
  });
});
