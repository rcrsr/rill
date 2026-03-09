/**
 * Rill Language Tests: :> Conversion Operator
 * Tests for the :> convert pipe target operator.
 *
 * Feature: Phase 1 keyword conversion operator (task 1.4)
 * Covers: AC-11 to AC-15, AC-28, AC-29, AC-33, AC-34, AC-47, AC-49
 *
 * Feature: Expanded conversion routes (task 1.3)
 * Covers: AC-1 to AC-17, EC-1 to EC-5, AC-25 to AC-33
 */

import { describe, expect, it } from 'vitest';

import { isTuple } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// Helper to check if a value is an ordered collection
function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

// Helper to get ordered entries
function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}

describe('Rill Language: :> Conversion Operator', () => {
  // ============================================================
  // BASIC CONVERSIONS
  // ============================================================

  describe('list -> :>tuple (AC-11)', () => {
    it('converts list[1, 2] to tuple with elements 1 and 2', async () => {
      const result = await run('list[1, 2] -> :>tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 2]);
    });

    it('converts empty list to empty tuple', async () => {
      const result = await run('list[] -> :>tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([]);
    });

    it('converts list with string elements to tuple', async () => {
      const result = await run('list["a", "b", "c"] -> :>tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual(['a', 'b', 'c']);
    });
  });

  describe('tuple -> :>list (AC-11b)', () => {
    it('converts tuple[1, 2] to list with elements 1 and 2', async () => {
      const result = await run('tuple[1, 2] -> :>list');
      expect(result).toEqual([1, 2]);
    });

    it('converts empty tuple to empty list', async () => {
      const result = await run('tuple[] -> :>list');
      expect(result).toEqual([]);
    });

    it('converts tuple with string elements to list', async () => {
      const result = await run('tuple["a", "b", "c"] -> :>list');
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('ordered -> :>dict (AC-12)', () => {
    it('converts ordered[a: 1, b: 2] to dict with keys a and b', async () => {
      const result = await run('ordered[a: 1, b: 2] -> :>dict');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('converts empty ordered to empty dict', async () => {
      const result = await run('ordered[] -> :>dict');
      expect(result).toEqual({});
    });
  });

  describe('dict -> :>ordered(sig) (AC-13, AC-49)', () => {
    it('converts dict[a: 1, b: 2] to ordered using field order from sig (AC-13)', async () => {
      const result = await run(
        'dict[a: 1, b: 2] -> :>ordered(a: number, b: number)'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('uses type signature field order, not dict order (AC-49)', async () => {
      const result = await run(
        'dict[b: 2, a: 1] -> :>ordered(b: number, a: number)'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries[0]![0]).toBe('b');
      expect(entries[1]![0]).toBe('a');
    });
  });

  describe('string -> :>number (AC-14)', () => {
    it('converts "5" to integer 5', async () => {
      const result = await run('"5" -> :>number');
      expect(result).toBe(5);
    });

    it('converts "3.14" to decimal', async () => {
      const result = await run('"3.14" -> :>number');
      expect(result).toBe(3.14);
    });

    it('converts "-10" to negative number', async () => {
      const result = await run('"-10" -> :>number');
      expect(result).toBe(-10);
    });
  });

  describe('number -> :>string (AC-14b)', () => {
    it('converts integer 42 to string "42"', async () => {
      const result = await run('42 -> :>string');
      expect(result).toBe('42');
    });

    it('converts decimal 3.14 to string "3.14"', async () => {
      const result = await run('3.14 -> :>string');
      expect(result).toBe('3.14');
    });

    it('converts negative -7 to string "-7"', async () => {
      const result = await run('-7 -> :>string');
      expect(result).toBe('-7');
    });
  });

  // ============================================================
  // DYNAMIC TYPE VARIABLE (AC-15)
  // ============================================================

  describe('dynamic :>$t type variable (AC-15)', () => {
    it('converts list[1, 2] to tuple using type variable $t', async () => {
      const result = await run('tuple => $t\nlist[1, 2] -> :>$t');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 2]);
    });

    it('throws when dict -> :>$t where $t is ordered type (no sig available)', async () => {
      // dict -> :>ordered without a structural signature always errors (EC-11)
      await expect(
        run('ordered => $t\ndict[a: 1, b: 2] -> :>$t')
      ).rejects.toThrow(/structural type signature/);
    });

    it('passes through same type via variable (AC-47)', async () => {
      const result = await run('list => $t\nlist[1, 2] -> :>$t');
      expect(result).toEqual([1, 2]);
    });
  });

  // ============================================================
  // NO-OP CONVERSIONS (AC-47)
  // ============================================================

  describe('no-op conversions - same type (AC-47)', () => {
    it('list -> :>list is a no-op', async () => {
      const result = await run('list[1, 2] -> :>list');
      expect(result).toEqual([1, 2]);
    });

    it('dict -> :>dict is a no-op', async () => {
      const result = await run('dict[a: 1] -> :>dict');
      expect(result).toEqual({ a: 1 });
    });

    it('tuple -> :>tuple is a no-op', async () => {
      const result = await run('tuple[1, 2] -> :>tuple');
      expect(isTuple(result)).toBe(true);
    });

    it('ordered -> :>ordered is a no-op', async () => {
      const result = await run('ordered[a: 1] -> :>ordered');
      expect(isOrdered(result)).toBe(true);
    });

    it('"hello" -> :>string is a no-op', async () => {
      const result = await run('"hello" -> :>string');
      expect(result).toBe('hello');
    });

    it('42 -> :>number is a no-op', async () => {
      const result = await run('42 -> :>number');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // REMOVED METHODS: .str AND .num (AC-23, AC-24)
  // ============================================================

  describe('removed .str and .num methods (AC-23, AC-24)', () => {
    it('throws unknown method error: "123" -> .num (AC-23)', async () => {
      await expect(run('"123" -> .num')).rejects.toThrow(/Unknown method: num/);
    });

    it('throws unknown method error: 42 -> .str (AC-24)', async () => {
      await expect(run('42 -> .str')).rejects.toThrow(/Unknown method: str/);
    });
  });

  // ============================================================
  // ERROR CONTRACTS
  // ============================================================

  describe('error contracts', () => {
    it('throws runtime error: "hello" -> :>tuple (AC-28, EC-10)', async () => {
      await expect(run('"hello" -> :>tuple')).rejects.toThrow(
        /cannot convert string to tuple/
      );
    });

    it('throws runtime error: dict -> :>ordered without signature (AC-29, EC-11)', async () => {
      await expect(run('dict[a: 1] -> :>ordered')).rejects.toThrow(
        /structural type signature/
      );
    });

    it('throws runtime error: "five" -> :>number (AC-33, EC-12)', async () => {
      await expect(run('"five" -> :>number')).rejects.toThrow(
        /cannot convert string "five" to number/
      );
    });

    it('throws runtime error: :>$var where $var holds non-type value (AC-34, EC-13)', async () => {
      await expect(run('5 => $n\n"hello" -> :>$n')).rejects.toThrow(
        /expected type value/
      );
    });

    it('throws runtime error: list -> :>dict (incompatible)', async () => {
      await expect(run('list[1, 2] -> :>dict')).rejects.toThrow(
        /cannot convert list to dict/
      );
    });

    it('throws runtime error: tuple -> :>ordered (incompatible)', async () => {
      await expect(run('tuple[1, 2] -> :>ordered')).rejects.toThrow(
        /cannot convert tuple to ordered/
      );
    });

    it('throws runtime error: dict -> :>list (incompatible)', async () => {
      await expect(run('dict[a: 1] -> :>list')).rejects.toThrow(
        /cannot convert dict to list/
      );
    });
  });

  // ============================================================
  // :>STRING EXPANDED ROUTES (AC-1 to AC-6)
  // ============================================================

  describe(':>string conversions (AC-1 to AC-6)', () => {
    it('converts number 42 to string "42" (AC-1)', async () => {
      const result = await run('42 -> :>string');
      expect(result).toBe('42');
    });

    it('converts bool true to string "true" (AC-2)', async () => {
      const result = await run('true -> :>string');
      expect(result).toBe('true');
    });

    it('converts list[1, 2] to string "list[1, 2]" (AC-3)', async () => {
      const result = await run('list[1, 2] -> :>string');
      expect(result).toBe('list[1, 2]');
    });

    it('converts dict[a: 1] to string "dict[a: 1]" (AC-4)', async () => {
      const result = await run('dict[a: 1] -> :>string');
      expect(result).toBe('dict[a: 1]');
    });

    it('converts tuple[1, 2] to string "tuple[1, 2]" (AC-5)', async () => {
      const result = await run('tuple[1, 2] -> :>string');
      expect(result).toBe('tuple[1, 2]');
    });

    it('"hello" -> :>string is identity (AC-6)', async () => {
      const result = await run('"hello" -> :>string');
      expect(result).toBe('hello');
    });
  });

  // ============================================================
  // :>NUMBER EXPANDED ROUTES (AC-7 to AC-10)
  // ============================================================

  describe(':>number expanded conversions (AC-7 to AC-10)', () => {
    it('converts "123" to number 123 (AC-7)', async () => {
      const result = await run('"123" -> :>number');
      expect(result).toBe(123);
    });

    it('converts bool true to number 1 (AC-8)', async () => {
      const result = await run('true -> :>number');
      expect(result).toBe(1);
    });

    it('converts bool false to number 0 (AC-9)', async () => {
      const result = await run('false -> :>number');
      expect(result).toBe(0);
    });

    it('42 -> :>number is identity (AC-10)', async () => {
      const result = await run('42 -> :>number');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // :>BOOL CONVERSIONS (AC-11 to AC-15)
  // ============================================================

  describe(':>bool conversions (AC-11 to AC-15)', () => {
    it('converts number 0 to false (AC-11)', async () => {
      const result = await run('0 -> :>bool');
      expect(result).toBe(false);
    });

    it('converts number 1 to true (AC-12)', async () => {
      const result = await run('1 -> :>bool');
      expect(result).toBe(true);
    });

    it('converts string "true" to true (AC-13)', async () => {
      const result = await run('"true" -> :>bool');
      expect(result).toBe(true);
    });

    it('converts string "false" to false (AC-14)', async () => {
      const result = await run('"false" -> :>bool');
      expect(result).toBe(false);
    });

    it('true -> :>bool is identity (AC-15)', async () => {
      const result = await run('true -> :>bool');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // COLLECTION CONVERSIONS (AC-16, AC-17)
  // ============================================================

  describe('collection cross-conversions (AC-16, AC-17)', () => {
    it('converts list[1] to tuple[1] (AC-16)', async () => {
      const result = await run('list[1] -> :>tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1]);
    });

    it('converts tuple[1] to list[1] (AC-17)', async () => {
      const result = await run('tuple[1] -> :>list');
      expect(result).toEqual([1]);
    });
  });

  // ============================================================
  // ERROR CONTRACTS: INCOMPATIBLE AND UNPARSEABLE (EC-1 to EC-5, AC-25)
  // ============================================================

  describe('error contracts: expanded routes (EC-1 to EC-5, AC-25)', () => {
    it('throws RILL-R038: "abc" -> :>number (EC-1, AC-18)', async () => {
      await expect(run('"abc" -> :>number')).rejects.toThrow(
        /cannot convert string "abc" to number/
      );
    });

    it('throws RILL-R036: list[1] -> :>number (EC-2, AC-19)', async () => {
      await expect(run('list[1] -> :>number')).rejects.toThrow(
        /cannot convert list to number/
      );
    });

    it('throws RILL-R036: 2 -> :>bool (EC-3, AC-20)', async () => {
      await expect(run('2 -> :>bool')).rejects.toThrow(
        /cannot convert number to bool/
      );
    });

    it('throws RILL-R036: "yes" -> :>bool (EC-4, AC-21)', async () => {
      await expect(run('"yes" -> :>bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: list[1] -> :>bool (EC-5, AC-22)', async () => {
      await expect(run('list[1] -> :>bool')).rejects.toThrow(
        /cannot convert list to bool/
      );
    });

    it('throws RILL-R036: dict[a: 1] -> :>number (AC-25)', async () => {
      await expect(run('dict[a: 1] -> :>number')).rejects.toThrow(
        /cannot convert dict to number/
      );
    });
  });

  // ============================================================
  // BOUNDARY CASES (AC-26 to AC-33)
  // ============================================================

  describe('boundary cases (AC-26 to AC-33)', () => {
    it('throws RILL-R038: "" -> :>number (AC-26, BC-1 empty string)', async () => {
      await expect(run('"" -> :>number')).rejects.toThrow(
        /cannot convert string "" to number/
      );
    });

    it('throws RILL-R038: " " -> :>number (AC-27, BC-2 whitespace only)', async () => {
      await expect(run('" " -> :>number')).rejects.toThrow(
        /cannot convert string " " to number/
      );
    });

    it('throws RILL-R036: "True" -> :>bool (AC-28, BC-3 case-sensitive)', async () => {
      await expect(run('"True" -> :>bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: "0" -> :>bool (AC-29, BC-4 string zero rejected)', async () => {
      await expect(run('"0" -> :>bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: "1" -> :>bool (AC-30, BC-5 string one rejected)', async () => {
      await expect(run('"1" -> :>bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: -1 -> :>bool (AC-31, BC-6 only 0 and 1 accepted)', async () => {
      await expect(run('-1 -> :>bool')).rejects.toThrow(
        /cannot convert number to bool/
      );
    });

    it('converts closure to string via formatValue (AC-32, BC-7)', async () => {
      const result = await run('||(42) -> :>string');
      expect(result).toBe('type(closure)');
    });

    it('converts "-3.14" to number -3.14 (AC-33, BC-8 negative decimal)', async () => {
      const result = await run('"-3.14" -> :>number');
      expect(result).toBe(-3.14);
    });
  });
});
