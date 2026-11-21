/**
 * Rill Language Tests: Ordered Error Messages, Nested Tuple Hydration,
 * and Conversion Error Contracts
 *
 * Tests bug fixes applied in Phase 1 tasks 1.2 and 1.4:
 *
 * AC-3: ordered error in resolveTypeRef says ordered() not dict()
 * AC-4: both resolveTypeRef and evaluateTypeConstructor produce identical error text
 * AC-6: nested tuple field defaults hydrated during -> conversion
 * EC-2: ordered type constructor with positional arg raises RILL-R004 with ordered()
 * EC-3: tuple conversion missing required element raises RILL-R044 with position
 * EC-4: dict conversion missing required field raises RILL-R044 with field name
 * EC-5: nested tuple conversion missing required element raises RILL-R044
 * BC-4: nested dict inside tuple field: nested defaults hydrated recursively
 */

import { describe, expect, it } from 'vitest';

import { isTuple } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { isOrdered, orderedEntries } from '../helpers/ordered.js';

// ============================================================
// HELPERS
// ============================================================

describe('Rill Language: Ordered Errors, Nested Tuple Hydration, Conversion Contracts', () => {
  // ============================================================
  // AC-3: ordered error in resolveTypeRef says ordered() not dict()
  // The :ordered(number) assertion triggers resolveTypeRef with a
  // positional arg. The error message must say "ordered()" not "dict()".
  // ============================================================

  describe('uniform dict and ordered assertions are removed', () => {
    it.each([
      ['[a: 1] -> :dict(number)', 'map(string, number)'],
      ['[a: 1] -> :dict(string)', 'map(string, string)'],
      ['[a: 1] -> :ordered(number)', 'map(string, number)'],
      ['ordered(number)', 'map(string, number)'],
    ])('rejects %s naming the map form', async (source, replacement) => {
      await expect(run(source)).rejects.toThrow(replacement);
    });
  });

  // ============================================================
  // AC-6: nested tuple field defaults hydrated during -> conversion
  // A dict field whose type is a tuple with trailing defaults
  // gets those defaults filled when the tuple is short.
  // ============================================================

  describe('AC-6: nested tuple field defaults hydrated during -> conversion', () => {
    it('dict with nested tuple gets trailing default filled', async () => {
      const result = await run(
        '[items: tuple[1]] -> dict(items: tuple(number, string = "default"))'
      );
      const items = (result as Record<string, RillValue>)['items'] as RillValue;
      expect(isTuple(items)).toBe(true);
      const tupleResult = items as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'default']);
    });

    it('ordered with nested tuple gets trailing default filled', async () => {
      const result = await run(
        '[items: tuple[1]] -> ordered(items: tuple(number, string = "default"))'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toHaveLength(1);
      expect(entries[0]![0]).toBe('items');
      const items = entries[0]![1] as RillValue;
      expect(isTuple(items)).toBe(true);
      const tupleResult = items as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'default']);
    });
  });

  // ============================================================
  // EC-2: ordered type constructor with positional arg raises
  // RILL-R004 with ordered() in the message
  // ============================================================

  describe('ordered() positional arguments', () => {
    it('rejects ordered(string, number) naming map(K, V)', async () => {
      await expect(run('ordered(string, number)')).rejects.toThrow('map(K, V)');
    });
  });

  // ============================================================
  // EC-3: tuple conversion missing required element raises
  // RILL-R044 with position
  // ============================================================

  describe('EC-3: tuple conversion missing required element raises RILL-R044', () => {
    it('tuple[1] -> tuple(number, string) throws with position 1', async () => {
      // 2 positional args: structural path with elements (unchanged)
      await expect(run('tuple[1] -> tuple(number, string)')).rejects.toThrow(
        /missing required element at position 1/
      );
    });

    it('tuple(number) produces a one-position tuple type', async () => {
      const result = (await run('tuple(number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
      expect(result.structure.valueType).toBeUndefined();
      expect(result.structure.elements).toEqual([{ type: { kind: 'number' } }]);
    });
  });

  // ============================================================
  // EC-4: dict conversion missing required field raises
  // RILL-R044 with field name
  // ============================================================

  describe('EC-4: dict conversion missing required field raises RILL-R044', () => {
    it('dict[] -> dict(x: number) throws naming field x', async () => {
      await expect(run('dict[] -> dict(x: number)')).rejects.toThrow(
        /missing required field 'x'/
      );
    });

    it('[a: 1] -> dict(a: number, b: string) throws naming field b', async () => {
      await expect(run('[a: 1] -> dict(a: number, b: string)')).rejects.toThrow(
        /missing required field 'b'/
      );
    });
  });

  // ============================================================
  // EC-5: nested tuple conversion missing required element
  // raises RILL-R044
  // ============================================================

  describe('EC-5: nested tuple conversion missing required element raises RILL-R044', () => {
    it('dict with nested tuple missing element throws RILL-R044', async () => {
      // Named args: structural path (unchanged)
      await expect(
        run('[items: tuple[1]] -> dict(items: tuple(number, string, bool))')
      ).rejects.toThrow(/missing required element at position/);
    });

    it('ordered with nested tuple missing element throws RILL-R044', async () => {
      // Named args: structural path (unchanged)
      await expect(
        run('[items: tuple[1]] -> ordered(items: tuple(number, string, bool))')
      ).rejects.toThrow(/missing required element at position/);
    });

    it('tuple with 2 structural elements still validates nested tuples', async () => {
      // 2 positional args: structural path (unchanged)
      await expect(
        run('tuple[tuple[1], 2] -> tuple(tuple(number, string), number)')
      ).rejects.toThrow(/missing required element at position/);
    });
  });

  // ============================================================
  // BC-4: nested dict inside tuple field, nested defaults
  // hydrated recursively
  // ============================================================

  describe('BC-4: nested dict inside tuple field defaults hydrated recursively', () => {
    it('tuple with two elements: second is dict with defaults', async () => {
      // 2 positional args: structural path (unchanged)
      const result = await run(
        'tuple[1, [b: "b"]] -> tuple(number, dict(a: string = "a", b: string))'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toHaveLength(2);
      expect(tupleResult.entries[0]).toBe(1);
      expect(tupleResult.entries[1]).toEqual({ a: 'a', b: 'b' });
    });

    it('nested dict inside tuple with all fields present passes through', async () => {
      // 2 positional args: structural path (unchanged)
      const result = await run(
        'tuple[[x: 10, y: "z"], 1] -> tuple(dict(x: number = 42, y: string), number)'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toHaveLength(2);
      // x is present in input (10), not replaced by default (42)
      expect(tupleResult.entries[0]).toEqual({ x: 10, y: 'z' });
      expect(tupleResult.entries[1]).toBe(1);
    });
  });
});
