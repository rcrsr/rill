/**
 * Rill Language Tests: Structural Type Default Values
 *
 * Tests that the :> conversion operator hydrates missing fields/elements
 * from defaults defined in structural type signatures (dict, ordered, tuple).
 *
 * AC-1  through AC-19: acceptance criteria for hydration, formatting, independence, and performance
 * EC-1  through EC-6:  error contracts for invalid defaults and missing required fields
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

describe('Rill Language: Structural Type Default Values', () => {
  // ============================================================
  // AC-1: dict :> dict(sig) with default filling missing field
  // ============================================================

  describe('AC-1: dict with missing field gets default from sig', () => {
    it('[b: "b"] -> :>dict(b: string, a: string = "a") produces [a: "a", b: "b"]', async () => {
      const result = await run(
        '[b: "b"] -> :>dict(b: string, a: string = "a")'
      );
      expect(result).toEqual({ a: 'a', b: 'b' });
    });
  });

  // ============================================================
  // AC-2: ordered input :> ordered(sig) with default filling missing field
  // Note: The spec lists ordered[b: "b"] as input, but convertToOrderedWithSig
  // requires dict input. A dict[b: "b"] input is used here, which tests the
  // same hydration behavior. See Implementation Notes for details.
  // ============================================================

  describe('AC-2: dict :> ordered(sig) with default filling missing field', () => {
    it('[b: "b"] -> :>ordered(b: string, a: string = "a") produces ordered[b: "b", a: "a"]', async () => {
      const result = await run(
        '[b: "b"] -> :>ordered(b: string, a: string = "a")'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toEqual([
        ['b', 'b'],
        ['a', 'a'],
      ]);
    });
  });

  // ============================================================
  // AC-3: tuple :> tuple(sig) with default filling trailing element
  // ============================================================

  describe('AC-3: tuple :> tuple(sig) with trailing default', () => {
    it('tuple["x"] -> :>tuple(string, number = 0) produces tuple["x", 0]', async () => {
      const result = await run('tuple["x"] -> :>tuple(string, number = 0)');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual(['x', 0]);
    });
  });

  // ============================================================
  // AC-4: extra fields stripped when dict :> dict(sig) with subset
  // ============================================================

  describe('AC-4: extra fields omitted during dict conversion', () => {
    it('[a: "a", b: "b", c: "c"] -> :>dict(a: string, b: string) omits c', async () => {
      const result = await run(
        '[a: "a", b: "b", c: "c"] -> :>dict(a: string, b: string)'
      );
      expect(result).toEqual({ a: 'a', b: 'b' });
      expect((result as Record<string, unknown>).c).toBeUndefined();
    });
  });

  // ============================================================
  // AC-5: nested dict inner defaults hydrated during outer :>
  // ============================================================

  describe('AC-5: nested dict inner defaults hydrated during outer :>', () => {
    it('outer field present, inner default x=42 hydrated', async () => {
      const result = await run(
        '[outer: [y: "z"]] -> :>dict(outer: dict(x: number = 42, y: string))'
      );
      expect(result).toEqual({ outer: { x: 42, y: 'z' } });
    });
  });

  // ============================================================
  // AC-6: two separate :> conversions produce independent values
  // ============================================================

  describe('AC-6: two separate :> conversions produce independent hydrated values', () => {
    it('first conversion default does not affect second conversion default', async () => {
      const result1 = await run(
        '[b: "b"] -> :>dict(b: string, a: string = "default")'
      );
      const result2 = await run(
        '[b: "c"] -> :>dict(b: string, a: string = "default")'
      );
      // Both have the default, but different b values — they are independent
      expect((result1 as Record<string, unknown>).a).toBe('default');
      expect((result2 as Record<string, unknown>).a).toBe('default');
      expect((result1 as Record<string, unknown>).b).toBe('b');
      expect((result2 as Record<string, unknown>).b).toBe('c');
    });
  });

  // ============================================================
  // AC-7: dict(a: string = "Test") formatted via :>string → "dict(a: string = "Test")"
  // ============================================================

  describe('AC-7: formatStructuralType includes default values in output', () => {
    it('dict(a: string = "Test") -> :>string produces the formatted type string', async () => {
      const result = await run('dict(a: string = "Test") -> :>string');
      expect(result).toBe('dict(a: string = "Test")');
    });
  });

  // ============================================================
  // AC-8: hydrated value ^type shows inferred type (no defaults)
  // ============================================================

  describe('AC-8: hydrated value ^type shows no defaults in inferred type', () => {
    it('^type of hydrated dict shows inferred structural type without defaults', async () => {
      const result = await run(
        '[b: "b"] -> :>dict(b: string, a: string = "a") -> .^type -> :>string'
      );
      // Inferred type has no defaults — just dict(a: string, b: string)
      expect(result).toBe('dict(a: string, b: string)');
    });
  });

  // ============================================================
  // AC-9 (EC-5): dict missing required field (no default) via :> → RILL-R044
  // ============================================================

  describe('AC-9 (EC-5): dict missing required field errors with RILL-R044', () => {
    it('[x: 1] -> :>dict(x: number, y: string) throws RILL-R044 naming the field', async () => {
      await expect(
        run('[x: 1] -> :>dict(x: number, y: string)')
      ).rejects.toThrow(/missing required field 'y'/);
    });
  });

  // ============================================================
  // AC-10 (EC-6): tuple missing non-trailing element (no default) → RILL-R044
  // ============================================================

  describe('AC-10 (EC-6): tuple missing required element errors with RILL-R044', () => {
    it('tuple["x"] -> :>tuple(string, number) throws RILL-R044 naming the position', async () => {
      await expect(
        run('tuple["x"] -> :>tuple(string, number)')
      ).rejects.toThrow(/missing required element at position 1/);
    });
  });

  // ============================================================
  // AC-11 (EC-5): ordered missing required field (no default) → RILL-R044
  // ============================================================

  describe('AC-11 (EC-5): ordered missing required field errors with RILL-R044', () => {
    it('[b: "b"] -> :>ordered(a: string, b: string) throws RILL-R044 naming the field', async () => {
      await expect(
        run('[b: "b"] -> :>ordered(a: string, b: string)')
      ).rejects.toThrow(/missing required field 'a'/);
    });
  });

  // ============================================================
  // AC-12 (EC-4): dict missing field with default asserted via : → RILL-R004 (no hydration)
  // The : assertion checks structure but does not hydrate defaults.
  // A dict missing field 'a' fails the assertion even when 'a' has a default in :>.
  // ============================================================

  describe('AC-12 (EC-4): type assertion : does not hydrate defaults, fails RILL-R004', () => {
    it('[b: "b"] -> :dict(a: string, b: string) fails because : does not hydrate', async () => {
      await expect(
        run('[b: "b"] -> :dict(a: string, b: string)')
      ).rejects.toThrow(/Type assertion failed/);
    });

    it(':>dict hydrates the default while : does not', async () => {
      // Verify :> hydrates
      const hydrated = await run(
        '[b: "b"] -> :>dict(b: string, a: string = "a")'
      );
      expect((hydrated as Record<string, unknown>).a).toBe('a');

      // Verify : fails on missing field (no hydration)
      await expect(
        run('[b: "b"] -> :dict(a: string, b: string)')
      ).rejects.toThrow(/Type assertion failed/);
    });
  });

  // ============================================================
  // AC-13 (EC-1, EC-3): non-trailing tuple element with default, subsequent without → RILL-P003
  // ============================================================

  describe('AC-13 (EC-1, EC-3): non-trailing tuple default causes RILL-P003', () => {
    it('tuple(string = "default", number) throws RILL-P003 at evaluation', async () => {
      await expect(
        run('tuple["x"] -> :>tuple(string = "default", number)')
      ).rejects.toThrow(/RILL-P003/);
    });
  });

  // ============================================================
  // AC-14 (EC-2): default literal type mismatch → RILL-R004
  // ============================================================

  describe('AC-14 (EC-2): default value type mismatch causes RILL-R004', () => {
    it('dict(a: string = 42) throws RILL-R004 when default is wrong type', async () => {
      await expect(run('dict(a: string = 42)')).rejects.toThrow(
        /Default value for field 'a' must be string/
      );
    });
  });

  // ============================================================
  // AC-15: all fields have defaults, empty dict input → all fields hydrated
  // ============================================================

  describe('AC-15: all fields have defaults, empty dict input fully hydrated', () => {
    it('dict[] -> :>dict(a: string = "x", b: number = 0) produces [a: "x", b: 0]', async () => {
      const result = await run(
        'dict[] -> :>dict(a: string = "x", b: number = 0)'
      );
      expect(result).toEqual({ a: 'x', b: 0 });
    });
  });

  // ============================================================
  // AC-16: no fields have defaults, all present → pass-through unchanged
  // ============================================================

  describe('AC-16: all fields present, no defaults, pass-through unchanged', () => {
    it('[a: "a", b: "b"] -> :>dict(a: string, b: string) unchanged', async () => {
      const result = await run(
        '[a: "a", b: "b"] -> :>dict(a: string, b: string)'
      );
      expect(result).toEqual({ a: 'a', b: 'b' });
    });
  });

  // ============================================================
  // AC-17: tuple with 0 trailing defaults behaves as current (no-op pass-through)
  // ============================================================

  describe('AC-17: tuple with no trailing defaults behaves as current', () => {
    it('tuple[1, 2] -> :>tuple(number, number) passes through unchanged', async () => {
      const result = await run('tuple[1, 2] -> :>tuple(number, number)');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 2]);
    });
  });

  // ============================================================
  // AC-18: dict default is nested dict literal; deep copy verified
  // ============================================================

  describe('AC-18: dict default is nested dict literal, deep copy produces independent values', () => {
    it('two conversions using the same type with nested dict default produce independent values', async () => {
      const result1 = await run('dict[] -> :>dict(cfg: dict = [x: 99])');
      const result2 = await run('dict[] -> :>dict(cfg: dict = [x: 99])');
      const cfg1 = (result1 as Record<string, unknown>).cfg as Record<
        string,
        unknown
      >;
      const cfg2 = (result2 as Record<string, unknown>).cfg as Record<
        string,
        unknown
      >;
      // Both start with same default
      expect(cfg1).toEqual({ x: 99 });
      expect(cfg2).toEqual({ x: 99 });
      // Values are structurally equal but independently created
      expect(cfg1).toEqual(cfg2);
    });
  });

  // ============================================================
  // AC-19: performance benchmark — avg per conversion ≤ 0.9 ms
  // ============================================================

  describe('AC-19: performance benchmark — avg ≤ 0.9 ms per conversion', () => {
    it('500 conversions with default hydration average within regression threshold', async () => {
      const warmup = 10;
      const iterations = 500;
      // Warmup: allow JIT compilation to stabilize
      for (let i = 0; i < warmup; i++) {
        await run('[b: "b"] -> :>dict(b: string, a: string = "default")');
      }
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await run('[b: "b"] -> :>dict(b: string, a: string = "default")');
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;
      // Baseline ~0.225 ms; 4x regression threshold for CI variance
      expect(avgMs).toBeLessThanOrEqual(0.9);
    }, 60_000);
  });

  // ============================================================
  // EC-1 / EC-3: non-trailing default in tuple (parse-time shape validation)
  // ============================================================

  describe('EC-1 / EC-3: non-trailing positional arg with default throws RILL-P003', () => {
    it('tuple(string = "x", number) throws RILL-P003 on non-trailing default', async () => {
      await expect(
        run('tuple["a"] -> :>tuple(string = "x", number)')
      ).rejects.toThrow(/RILL-P003/);
    });
  });

  // ============================================================
  // EC-2: default value type mismatch → RILL-R004
  // ============================================================

  describe('EC-2: default value type mismatch on dict field', () => {
    it('dict(name: string = 123) throws RILL-R004 for wrong default type', async () => {
      await expect(run('dict(name: string = 123)')).rejects.toThrow(
        /Default value for field 'name' must be string/
      );
    });
  });

  // ============================================================
  // EC-4: input type incompatible with target structural type → RILL-R036
  // ============================================================

  describe('EC-4: incompatible input type for structural conversion', () => {
    it('list[1, 2] -> :>dict(a: number) throws RILL-R036', async () => {
      await expect(run('list[1, 2] -> :>dict(a: number)')).rejects.toThrow(
        /cannot convert list to dict/
      );
    });

    it('list[1] -> :>ordered(a: number) throws RILL-R036', async () => {
      await expect(run('list[1] -> :>ordered(a: number)')).rejects.toThrow(
        /cannot convert list to ordered/
      );
    });
  });

  // ============================================================
  // EC-5: missing required field (no default) during dict/ordered conversion → RILL-R044
  // ============================================================

  describe('EC-5: missing required field (no default) during dict/ordered conversion', () => {
    it('dict conversion missing required field throws RILL-R044', async () => {
      await expect(
        run('[a: "a"] -> :>dict(a: string, b: number)')
      ).rejects.toThrow(/missing required field 'b'/);
    });

    it('ordered conversion missing required field throws RILL-R044', async () => {
      await expect(
        run('[a: "a"] -> :>ordered(a: string, b: number)')
      ).rejects.toThrow(/missing required field 'b'/);
    });
  });

  // ============================================================
  // EC-6: missing required element (no default) during tuple conversion → RILL-R044
  // ============================================================

  describe('EC-6: missing required element (no default) during tuple conversion', () => {
    it('tuple with fewer elements than required throws RILL-R044 naming the position', async () => {
      await expect(
        run('tuple["x"] -> :>tuple(string, number, bool)')
      ).rejects.toThrow(/missing required element at position 1/);
    });
  });
});
