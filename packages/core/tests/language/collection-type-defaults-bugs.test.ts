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
import { expectHaltMessage } from '../helpers/halt.js';

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

  describe('AC-3: resolveTypeRef ordered uniform type path', () => {
    it(':dict(number) resolves as uniform dict type and passes assertion', async () => {
      // Single positional arg now produces uniform dict type
      // [a: 1] is a dict with number values, so :dict(number) passes
      const result = await run('[a: 1] -> :dict(number)');
      expect(result).toEqual({ a: 1 });
    });

    it(':dict(string) assertion fails when value types do not match', async () => {
      // [a: 1] has number values, not string
      await expectHaltMessage(
        () => run('[a: 1] -> :dict(string)'),
        /Type assertion failed/
      );
    });

    it(':ordered(number) assertion fails on dict value (type mismatch)', async () => {
      // [a: 1] is a dict, not an ordered, so :ordered(number) fails
      await expectHaltMessage(
        () => run('[a: 1] -> :ordered(number)'),
        /Type assertion failed/
      );
    });
  });

  // ============================================================
  // AC-4: both resolveTypeRef and evaluateTypeConstructor produce
  // identical error text for ordered with positional arg
  // ============================================================

  describe('AC-4: resolveTypeRef and evaluateTypeConstructor uniform type parity', () => {
    it('resolveTypeRef accepts dict(number) as uniform type', async () => {
      // resolveTypeRef path: :dict(number) resolves as uniform dict type
      const result = await run('[a: 1] -> :dict(number)');
      expect(result).toEqual({ a: 1 });
    });

    it('evaluateTypeConstructor accepts ordered(number) as uniform type', async () => {
      // evaluateTypeConstructor path: ordered(number) produces uniform type
      // (Task 1.5: uniform path for 1 positional arg)
      const result = (await run('ordered(number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.kind).toBe('ordered');
      expect(result.structure.valueType).toEqual({ kind: 'number' });
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

  describe('EC-2: ordered() uniform type path (Task 1.5)', () => {
    it('ordered(number) produces uniform ordered type', async () => {
      const result = (await run('ordered(number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.valueType).toEqual({ kind: 'number' });
    });

    it('ordered(string, number) with 2+ positional args halts typed-atom', async () => {
      await expectHaltMessage(
        () => run('ordered(string, number)'),
        /ordered\(\) requires exactly 1 positional type argument/
      );
    });
  });

  // ============================================================
  // EC-3: tuple conversion missing required element raises
  // RILL-R044 with position
  // ============================================================

  describe('EC-3: tuple conversion missing required element raises RILL-R044', () => {
    it('tuple[1] -> :>tuple(number, string) throws with position 1', async () => {
      // 2 positional args: structural path with elements (unchanged)
      await expect(run('tuple[1] -> :>tuple(number, string)')).rejects.toThrow(
        /missing required element at position 1/
      );
    });

    it('tuple(number) produces uniform tuple type (Task 1.5)', async () => {
      // 1 positional arg: uniform path with valueType
      const result = (await run('tuple(number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
      expect(result.structure.valueType).toEqual({ kind: 'number' });
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
      // Named args: structural path (unchanged)
      await expect(
        run('[items: tuple[1]] -> :>dict(items: tuple(number, string, bool))')
      ).rejects.toThrow(/missing required element at position/);
    });

    it('ordered with nested tuple missing element throws RILL-R044', async () => {
      // Named args: structural path (unchanged)
      await expect(
        run(
          '[items: tuple[1]] -> :>ordered(items: tuple(number, string, bool))'
        )
      ).rejects.toThrow(/missing required element at position/);
    });

    it('tuple with 2 structural elements still validates nested tuples', async () => {
      // 2 positional args: structural path (unchanged)
      await expect(
        run('tuple[tuple[1], 2] -> :>tuple(tuple(number, string), number)')
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
        'tuple[1, [b: "b"]] -> :>tuple(number, dict(a: string = "a", b: string))'
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
        'tuple[[x: 10, y: "z"], 1] -> :>tuple(dict(x: number = 42, y: string), number)'
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
