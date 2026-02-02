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
        [type: "blocked"] :> $result
        $result.?type
      `);
      expect(result).toBe(true);
    });

    it('returns false when field does not exist', async () => {
      const result = await run(`
        [name: "test"] :> $result
        $result.?missing
      `);
      expect(result).toBe(false);
    });

    it('returns true for nested field access when field exists', async () => {
      const result = await run(`
        [user: [name: "alice"]] :> $data
        $data.user.?name
      `);
      expect(result).toBe(true);
    });

    it('returns false for nested field access when field does not exist', async () => {
      const result = await run(`
        [user: [name: "alice"]] :> $data
        $data.user.?age
      `);
      expect(result).toBe(false);
    });
  });

  describe('Existence Check in Conditionals', () => {
    it('can be used as condition in if-else', async () => {
      const result = await run(`
        [type: "blocked"] :> $result
        ($result.?type) ? "has type" ! "no type"
      `);
      expect(result).toBe('has type');
    });

    it('returns "no type" when field missing', async () => {
      const result = await run(`
        [name: "test"] :> $result
        ($result.?type) ? "has type" ! "no type"
      `);
      expect(result).toBe('no type');
    });

    it('can check multiple fields', async () => {
      const result = await run(`
        [type: "blocked", reason: "dependency"] :> $result
        ($result.?type && $result.?reason) ? "both exist" ! "missing"
      `);
      expect(result).toBe('both exist');
    });
  });

  describe('Existence Check with Pipe Variable', () => {
    it('works with pipe variable ($)', async () => {
      const result = await run(`
        [name: "test"] -> ($.?name)
      `);
      expect(result).toBe(true);
    });

    it('returns false for missing field on pipe variable', async () => {
      const result = await run(`
        [name: "test"] -> ($.?age)
      `);
      expect(result).toBe(false);
    });
  });
});
