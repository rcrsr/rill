/**
 * Rill Language Tests: Parameterized Existence Checks
 * Tests for type-qualified existence checks with structural types:
 * .?field&list(number), .?field&dict(key: string), .?field&string|number.
 *
 * AC = Acceptance Criterion from the type-system-improvements spec.
 * BC = Backward Compatibility criterion.
 *
 * Covers: AC-4, AC-5, AC-6, AC-20, AC-21, AC-26, BC-7, BC-9, BC-10, IC-2
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Parameterized Existence Check', () => {
  // ============================================================
  // AC-4: .?items&list(number) returns true for list of numbers
  // ============================================================

  describe('AC-4: .?field&list(number) returns true for list of numbers', () => {
    it('returns true when field exists and is list of numbers', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(true);
    });

    it('returns true for single-element list of numbers', async () => {
      const result = await run(`
        dict[items: list[42]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(true);
    });

    it('returns true for empty list against list(number)', async () => {
      const result = await run(`
        dict[items: list[]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-5: .?items&list(number) returns false for list of strings
  // ============================================================

  describe('AC-5: .?field&list(number) returns false for list of strings', () => {
    it('returns false when field is list of strings, not list of numbers', async () => {
      const result = await run(`
        dict[items: list["a", "b"]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(false);
    });

    it('returns false when field is a plain number, not list(number)', async () => {
      const result = await run(`
        dict[items: 42] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(false);
    });

    it('returns false when field does not exist', async () => {
      const result = await run(`
        dict[other: list[1, 2]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // AC-6: .?config&dict(key: string) returns true for matching dict
  // ============================================================

  describe('AC-6: .?field&dict(key: string) returns true for matching dict', () => {
    it('returns true when field matches dict(key: string) shape', async () => {
      const result = await run(`
        dict[config: dict[key: "val"]] => $data
        $data.?config&dict(key: string)
      `);
      expect(result).toBe(true);
    });

    it('returns false when dict field type does not match schema', async () => {
      const result = await run(`
        dict[config: dict[key: 42]] => $data
        $data.?config&dict(key: string)
      `);
      expect(result).toBe(false);
    });

    it('returns false when field is not a dict', async () => {
      const result = await run(`
        dict[config: "not-a-dict"] => $data
        $data.?config&dict(key: string)
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // AC-20: .?field&string|number returns true for string
  // ============================================================

  describe('AC-20: .?field&string|number returns true for string', () => {
    it('returns true when field is a string and type is string|number', async () => {
      const result = await run(`
        dict[score: "hello"] => $data
        $data.?score&string|number
      `);
      expect(result).toBe(true);
    });

    it('returns true when field is a number and type is string|number', async () => {
      const result = await run(`
        dict[score: 42] => $data
        $data.?score&string|number
      `);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-21: .?field&string|number returns false for bool
  // ============================================================

  describe('AC-21: .?field&string|number returns false for bool', () => {
    it('returns false when field is bool, type is string|number', async () => {
      const result = await run(`
        dict[flag: true] => $data
        $data.?flag&string|number
      `);
      expect(result).toBe(false);
    });

    it('returns false when field is list, type is string|number', async () => {
      const result = await run(`
        dict[items: list[1, 2]] => $data
        $data.?items&string|number
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // BC-10: All 3 access kinds use structural matching
  // Literal (.?field&type), variable (.?$var&type), computed (.?[$expr]&type)
  // ============================================================

  describe('BC-10: All 3 access kinds support parameterized type qualifier', () => {
    it('literal access: .?field&list(number) returns true', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(true);
    });

    it('variable access: .?$var&list(number) returns true', async () => {
      const result = await run(`
        "items" => $key
        dict[items: list[1, 2, 3]] => $data
        $data.?$key&list(number)
      `);
      expect(result).toBe(true);
    });

    it('computed access: .?("field")&list(number) returns true', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        $data.?("items")&list(number)
      `);
      expect(result).toBe(true);
    });

    it('literal access: .?field&list(number) returns false for string list', async () => {
      const result = await run(`
        dict[items: list["a", "b"]] => $data
        $data.?items&list(number)
      `);
      expect(result).toBe(false);
    });

    it('variable access: .?$var&list(number) returns false for string list', async () => {
      const result = await run(`
        "items" => $key
        dict[items: list["a", "b"]] => $data
        $data.?$key&list(number)
      `);
      expect(result).toBe(false);
    });

    it('computed access: .?("field")&list(number) returns false for string list', async () => {
      const result = await run(`
        dict[items: list["a", "b"]] => $data
        $data.?("items")&list(number)
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // BC-7: Simple .?field&string — identical to pre-change behavior
  // ============================================================

  describe('BC-7: Simple .?field&string backward compatibility', () => {
    it('returns true when field is string and type is string', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?name&string
      `);
      expect(result).toBe(true);
    });

    it('returns false when field is number and type is string', async () => {
      const result = await run(`
        dict[count: 42] => $data
        $data.?count&string
      `);
      expect(result).toBe(false);
    });

    it('returns false when field does not exist', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?missing&string
      `);
      expect(result).toBe(false);
    });

    it('returns true for number field with &number type', async () => {
      const result = await run(`
        dict[count: 42] => $data
        $data.?count&number
      `);
      expect(result).toBe(true);
    });

    it('returns true for bool field with &bool type', async () => {
      const result = await run(`
        dict[active: true] => $data
        $data.?active&bool
      `);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // BC-9: typeRef: null — pure existence check (no type validation)
  // ============================================================

  describe('BC-9: .?field with no type qualifier — pure existence check', () => {
    it('returns true when field exists regardless of type', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        $data.?items
      `);
      expect(result).toBe(true);
    });

    it('returns true for string field without type qualifier', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?name
      `);
      expect(result).toBe(true);
    });

    it('returns true for number field without type qualifier', async () => {
      const result = await run(`
        dict[count: 42] => $data
        $data.?count
      `);
      expect(result).toBe(true);
    });

    it('returns true for dict field without type qualifier', async () => {
      const result = await run(`
        dict[config: dict[key: "val"]] => $data
        $data.?config
      `);
      expect(result).toBe(true);
    });

    it('returns false when field is missing', async () => {
      const result = await run(`
        dict[name: "alice"] => $data
        $data.?missing
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // IC-2: Integration — parameterized existence in conditional
  // ============================================================

  describe('IC-2: Parameterized existence in conditional context', () => {
    it('uses list(number) existence check as if condition', async () => {
      const result = await run(`
        dict[items: list[1, 2, 3]] => $data
        ($data.?items&list(number)) ? "has numbers" ! "no numbers"
      `);
      expect(result).toBe('has numbers');
    });

    it('takes else branch when type does not match', async () => {
      const result = await run(`
        dict[items: list["a", "b"]] => $data
        ($data.?items&list(number)) ? "has numbers" ! "no numbers"
      `);
      expect(result).toBe('no numbers');
    });

    it('uses dict(key: string) existence check as if condition', async () => {
      const result = await run(`
        dict[config: dict[key: "val"]] => $data
        ($data.?config&dict(key: string)) ? "valid config" ! "bad config"
      `);
      expect(result).toBe('valid config');
    });

    it('combines multiple parameterized existence checks with &&', async () => {
      const result = await run(`
        dict[items: list[1, 2], config: dict[key: "val"]] => $data
        ($data.?items&list(number) && $data.?config&dict(key: string))
      `);
      expect(result).toBe(true);
    });
  });
});
