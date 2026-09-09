/**
 * Rill Language Tests: Existence Check (.?field)
 * Tests for field existence check operator that returns boolean
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Existence Check', () => {
  describe('Basic Existence Check (.?field)', () => {
    it('returns true when field exists', async () => {
      const result = await run(`
        dict[type: "blocked"] => $result
        $result.?type
      `);
      expect(result).toBe(true);
    });

    it('returns false when field does not exist', async () => {
      const result = await run(`
        dict[name: "test"] => $result
        $result.?missing
      `);
      expect(result).toBe(false);
    });

    it('returns true for nested field access when field exists', async () => {
      const result = await run(`
        dict[user: dict[name: "alice"]] => $data
        $data.user.?name
      `);
      expect(result).toBe(true);
    });

    it('returns false for nested field access when field does not exist', async () => {
      const result = await run(`
        dict[user: dict[name: "alice"]] => $data
        $data.user.?age
      `);
      expect(result).toBe(false);
    });
  });

  describe('Existence Check in Conditionals', () => {
    it('can be used as condition in if-else', async () => {
      const result = await run(`
        dict[type: "blocked"] => $result
        ($result.?type) ? "has type" ! "no type"
      `);
      expect(result).toBe('has type');
    });

    it('returns "no type" when field missing', async () => {
      const result = await run(`
        dict[name: "test"] => $result
        ($result.?type) ? "has type" ! "no type"
      `);
      expect(result).toBe('no type');
    });

    it('can check multiple fields', async () => {
      const result = await run(`
        dict[type: "blocked", reason: "dependency"] => $result
        ($result.?type && $result.?reason) ? "both exist" ! "missing"
      `);
      expect(result).toBe('both exist');
    });
  });

  describe('Existence Check with Pipe Variable', () => {
    it('works with pipe variable ($)', async () => {
      const result = await run(`
        dict[name: "test"] -> ($.?name)
      `);
      expect(result).toBe(true);
    });

    it('returns false for missing field on pipe variable', async () => {
      const result = await run(`
        dict[name: "test"] -> ($.?age)
      `);
      expect(result).toBe(false);
    });
  });

  describe('Existence Check with Variable Key', () => {
    it('checks existence using named variable as key', async () => {
      const result = await run(`
        dict[name: "test", age: 30] => $data
        "name" => $key
        $data.?$key
      `);
      expect(result).toBe(true);
    });

    it('returns false when named variable key does not exist', async () => {
      const result = await run(`
        dict[name: "test"] => $data
        "age" => $key
        $data.?$key
      `);
      expect(result).toBe(false);
    });
  });

  describe('across a newline continuation', () => {
    it('returns true when field exists after a newline continuation', async () => {
      const result = await run(`
        dict[a: 1] => $d
        $d
        .?a
      `);
      expect(result).toBe(true);
    });

    // Pins parser-variables.ts's pre-existing `.?` newline-continuation
    // handling (skipNewlinesIfFollowedBy for DOT_QUESTION), not the
    // parser-expr.ts postfix/pipe-target-dot changes, which only peek for a
    // plain DOT token.
    it('returns false when field does not exist after a newline continuation', async () => {
      const result = await run(`
        dict[a: 1] => $d
        $d.a
        .?b
      `);
      expect(result).toBe(false);
    });
  });

  describe('Postfix Existence Check (after index/method chain)', () => {
    it('returns true for a field that exists after a bracket index chain', async () => {
      const result = await run(`list[dict[a: 1]][0].?a`);
      expect(result).toBe(true);
    });

    it('returns false for a field that does not exist after a bracket index chain', async () => {
      const result = await run(`list[dict[a: 1]][0].?b`);
      expect(result).toBe(false);
    });

    it('returns true when the field exists and matches the &type qualifier', async () => {
      const result = await run(`list[dict[a: 1]][0].?a & number`);
      expect(result).toBe(true);
    });
  });

  describe('Bare Existence Check (.?)', () => {
    it('returns true when the receiver is a valid value', async () => {
      const result = await run(`
        5 => $x
        $x.?
      `);
      expect(result).toBe(true);
    });

    it('returns false when the receiver is an invalid value caught by guard', async () => {
      const result = await run(`
        guard { 1 -> :string } => $x
        $x.?
      `);
      expect(result).toBe(false);
    });

    it('returns true for a bare probe on the pipe variable', async () => {
      const result = await run(`5 -> ($.?)`);
      expect(result).toBe(true);
    });

    it('leaves .?field access unchanged when a field is present', async () => {
      const result = await run(`
        dict[type: "blocked"] => $result
        $result.?type
      `);
      expect(result).toBe(true);
    });
  });

  describe('Error Contracts', () => {
    it('EC-4: throws error when $ is not followed by variable name', async () => {
      await expect(
        run(`
          dict[x: 1] => $data
          $data.?$@
        `)
      ).rejects.toThrow('Expected variable name after .?$');
    });

    it('EC-5, AC-11: throws error for invalid type in .?field&type', async () => {
      await expect(
        run(`
          dict[name: "test"] => $data
          $data.?name&invalid
        `)
      ).rejects.toThrow('Invalid type: invalid');
    });
  });

  describe('Chaining after a postfix-position .?field probe', () => {
    it('continues a method chain after .?field on a bracket-index chain', async () => {
      const result = await run(`list[dict[a: 1]][0].?a.^type`);
      expect(result).toEqual(expect.objectContaining({ typeName: 'bool' }));
    });

    it('returns true for the .?field probe before the chained method runs', async () => {
      const result = await run(`list[dict[a: 1]][0].?a.eq(true)`);
      expect(result).toBe(true);
    });

    it('returns false for a missing field before the chained method runs', async () => {
      const result = await run(`list[dict[a: 1]][0].?b.eq(true)`);
      expect(result).toBe(false);
    });
  });

  describe('.? followed by a non-identifier token (postfix position)', () => {
    it('throws a registered parse error naming the missing field name', async () => {
      await expect(run(`list[dict[a: 1]][0].?+1`)).rejects.toThrow(
        "Expected field name after '.?'"
      );
    });

    it('is unaffected for a bare .? at end of statement', async () => {
      const result = await run(`list[dict[a: 1]][0].?`);
      expect(result).toEqual({ a: 1 });
    });
  });
});
