/**
 * Rill Language Tests: Ordered Error Messages, Nested Tuple Hydration,
 * and Conversion Error Contracts
 *
 * Tests bug fixes applied in Phase 1 tasks 1.2 and 1.4:
 *
 * AC-3: ordered error in resolveTypeRef says ordered() not dict()
 * AC-4: both resolveTypeRef and evaluateTypeConstructor produce identical error text
 * AC-6: nested tuple field defaults hydrated during :> conversion
 * EC-2: ordered type constructor with positional arg raises RILL-R004 with ordered()
 * EC-3: tuple conversion missing required element raises RILL-R044 with position
 * EC-4: dict conversion missing required field raises RILL-R044 with field name
 * EC-5: nested tuple conversion missing required element raises RILL-R044
 * BC-4: nested dict inside tuple field: nested defaults hydrated recursively
 */

import { describe, expect, it } from 'vitest';

import { isTuple } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// ============================================================
// HELPERS
// ============================================================

function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}

describe('Rill Language: Ordered Errors, Nested Tuple Hydration, Conversion Contracts', () => {
  // ============================================================
  // AC-3: ordered error in resolveTypeRef says ordered() not dict()
  // The :ordered(number) assertion triggers resolveTypeRef with a
  // positional arg. The error message must say "ordered()" not "dict()".
  // ============================================================

  describe('AC-3: resolveTypeRef ordered error says ordered()', () => {
    it(':ordered(number) assertion error mentions ordered() not dict()', async () => {
      await expect(run('[a: 1] -> :ordered(number)')).rejects.toThrow(
        /ordered\(\) requires named arguments/
      );
    });

    it(':ordered(number) assertion error does not mention dict()', async () => {
      let errorMessage = '';
      try {
        await run('[a: 1] -> :ordered(number)');
      } catch (e) {
        errorMessage = (e as Error).message;
      }
      expect(errorMessage).toContain('ordered()');
      expect(errorMessage).not.toContain('dict()');
    });
  });

  // ============================================================
  // AC-4: both resolveTypeRef and evaluateTypeConstructor produce
  // identical error text for ordered with positional arg
  // ============================================================

  describe('AC-4: identical error text from resolveTypeRef and evaluateTypeConstructor', () => {
    it('type assertion and type constructor produce the same error message', async () => {
      // resolveTypeRef path: type assertion :ordered(number)
      let resolveError = '';
      try {
        await run('[a: 1] -> :ordered(number)');
      } catch (e) {
        resolveError = (e as Error).message;
      }

      // evaluateTypeConstructor path: ordered(number) as expression
      let constructorError = '';
      try {
        await run('ordered(number)');
      } catch (e) {
        constructorError = (e as Error).message;
      }

      // Both messages contain the same ordered() error text
      expect(resolveError).toContain(
        'ordered() requires named arguments (field: type)'
      );
      expect(constructorError).toContain(
        'ordered() requires named arguments (field: type)'
      );
    });
  });

  // ============================================================
  // AC-6: nested tuple field defaults hydrated during :> conversion
  // A dict field whose type is a tuple with trailing defaults
  // gets those defaults filled when the tuple is short.
  // ============================================================

  describe('AC-6: nested tuple field defaults hydrated during :> conversion', () => {
    it('dict with nested tuple gets trailing default filled', async () => {
      const result = await run(
        '[items: tuple[1]] -> :>dict(items: tuple(number, string = "default"))'
      );
      const items = (result as Record<string, unknown>).items;
      expect(isTuple(items)).toBe(true);
      const tupleResult = items as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'default']);
    });

    it('ordered with nested tuple gets trailing default filled', async () => {
      const result = await run(
        '[items: tuple[1]] -> :>ordered(items: tuple(number, string = "default"))'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toHaveLength(1);
      expect(entries[0]![0]).toBe('items');
      const items = entries[0]![1];
      expect(isTuple(items)).toBe(true);
      const tupleResult = items as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'default']);
    });
  });

  // ============================================================
  // EC-2: ordered type constructor with positional arg raises
  // RILL-R004 with ordered() in the message
  // ============================================================

  describe('EC-2: ordered() with positional arg raises RILL-R004', () => {
    it('ordered(number) throws RILL-R004 mentioning ordered()', async () => {
      await expect(run('ordered(number)')).rejects.toThrow(
        /ordered\(\) requires named arguments/
      );
    });

    it(':>ordered(number) conversion path also throws ordered() error', async () => {
      await expect(run('[a: 1] -> :>ordered(number)')).rejects.toThrow(
        /ordered\(\) requires named arguments/
      );
    });
  });

  // ============================================================
  // EC-3: tuple conversion missing required element raises
  // RILL-R044 with position
  // ============================================================

  describe('EC-3: tuple conversion missing required element raises RILL-R044', () => {
    it('tuple[1] -> :>tuple(number, string) throws with position 1', async () => {
      await expect(run('tuple[1] -> :>tuple(number, string)')).rejects.toThrow(
        /missing required element at position 1/
      );
    });

    it('tuple[] -> :>tuple(number) throws with position 0', async () => {
      await expect(run('tuple[] -> :>tuple(number)')).rejects.toThrow(
        /missing required element at position 0/
      );
    });
  });

  // ============================================================
  // EC-4: dict conversion missing required field raises
  // RILL-R044 with field name
  // ============================================================

  describe('EC-4: dict conversion missing required field raises RILL-R044', () => {
    it('dict[] -> :>dict(x: number) throws naming field x', async () => {
      await expect(run('dict[] -> :>dict(x: number)')).rejects.toThrow(
        /missing required field 'x'/
      );
    });

    it('[a: 1] -> :>dict(a: number, b: string) throws naming field b', async () => {
      await expect(
        run('[a: 1] -> :>dict(a: number, b: string)')
      ).rejects.toThrow(/missing required field 'b'/);
    });
  });

  // ============================================================
  // EC-5: nested tuple conversion missing required element
  // raises RILL-R044
  // ============================================================

  describe('EC-5: nested tuple conversion missing required element raises RILL-R044', () => {
    it('dict with nested tuple missing element throws RILL-R044', async () => {
      await expect(
        run('[items: tuple[1]] -> :>dict(items: tuple(number, string, bool))')
      ).rejects.toThrow(/missing required element at position/);
    });

    it('ordered with nested tuple missing element throws RILL-R044', async () => {
      await expect(
        run(
          '[items: tuple[1]] -> :>ordered(items: tuple(number, string, bool))'
        )
      ).rejects.toThrow(/missing required element at position/);
    });

    it('tuple inside tuple missing required element throws RILL-R044', async () => {
      // Outer tuple has a nested tuple element that is too short
      await expect(
        run('tuple[tuple[1]] -> :>tuple(tuple(number, string))')
      ).rejects.toThrow(/missing required element at position/);
    });
  });

  // ============================================================
  // BC-4: nested dict inside tuple field, nested defaults
  // hydrated recursively
  // ============================================================

  describe('BC-4: nested dict inside tuple field defaults hydrated recursively', () => {
    it('tuple element is a dict type with defaulted field, default hydrated', async () => {
      const result = await run(
        'tuple[[y: "z"]] -> :>tuple(dict(x: number = 42, y: string))'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toHaveLength(1);
      expect(tupleResult.entries[0]).toEqual({ x: 42, y: 'z' });
    });

    it('tuple with two elements: second is dict with defaults', async () => {
      const result = await run(
        'tuple[1, [b: "b"]] -> :>tuple(number, dict(a: string = "a", b: string))'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toHaveLength(2);
      expect(tupleResult.entries[0]).toBe(1);
      expect(tupleResult.entries[1]).toEqual({ a: 'a', b: 'b' });
    });

    it('nested dict inside tuple with all fields present passes through', async () => {
      const result = await run(
        'tuple[[x: 10, y: "z"]] -> :>tuple(dict(x: number = 42, y: string))'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toHaveLength(1);
      // x is present in input (10), not replaced by default (42)
      expect(tupleResult.entries[0]).toEqual({ x: 10, y: 'z' });
    });
  });
});
