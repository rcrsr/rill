/**
 * Rill Language Tests: :> Conversion Operator
 * Tests for the :> convert pipe target operator.
 *
 * Feature: Phase 1 keyword conversion operator (task 1.4)
 * Covers: AC-11 to AC-15, AC-28, AC-29, AC-33, AC-34, AC-47, AC-49
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
});
