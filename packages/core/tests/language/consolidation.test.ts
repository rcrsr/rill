/**
 * Rill Language Tests: Node Consolidation Regression Tests
 * Verifies no behavioral change after Phase 4 node consolidation.
 *
 * Before Phase 4: :$var emitted VarTypeAssertionNode / VarTypeCheckNode
 * After Phase 4:  :$var emits TypeAssertionNode / TypeCheckNode with typeRef: { kind: 'dynamic', varName }
 *
 * Covers: AC-16 — all existing behavior preserved with no observable change
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Node Consolidation Regression', () => {
  // ============================================================
  // Static TypeAssertionNode path (AC-16)
  // ============================================================

  describe('Static Type Assertions (TypeAssertionNode static path)', () => {
    it('42 -> :number passes', async () => {
      expect(await run('42 -> :number')).toBe(42);
    });

    it('"hello" -> :string passes', async () => {
      expect(await run('"hello" -> :string')).toBe('hello');
    });

    it('42 -> :string fails with type mismatch', async () => {
      await expect(run('42 -> :string')).rejects.toThrow(
        'expected string, got number'
      );
    });
  });

  // ============================================================
  // Dynamic TypeAssertionNode path via TypeRef (AC-16)
  // ============================================================

  describe('Dynamic Type Assertions (TypeAssertionNode dynamic path)', () => {
    it('$t holds number type value — 42 -> :$t passes', async () => {
      expect(await run('number => $t\n42 -> :$t')).toBe(42);
    });

    it('$t holds string type value — "hello" -> :$t passes', async () => {
      expect(await run('string => $t\n"hello" -> :$t')).toBe('hello');
    });

    it('$t holds number type value — "hello" -> :$t fails', async () => {
      await expect(run('number => $t\n"hello" -> :$t')).rejects.toThrow(
        'expected number, got string'
      );
    });
  });

  // ============================================================
  // Static TypeCheckNode path (AC-16)
  // ============================================================

  describe('Static Type Checks (TypeCheckNode static path)', () => {
    it('42 -> :?number returns true', async () => {
      expect(await run('42 -> :?number')).toBe(true);
    });

    it('"hello" -> :?string returns true', async () => {
      expect(await run('"hello" -> :?string')).toBe(true);
    });

    it('42 -> :?string returns false', async () => {
      expect(await run('42 -> :?string')).toBe(false);
    });
  });

  // ============================================================
  // Dynamic TypeCheckNode path via TypeRef (AC-16)
  // ============================================================

  describe('Dynamic Type Checks (TypeCheckNode dynamic path)', () => {
    it('$t holds number type value — 42 -> :?$t returns true', async () => {
      expect(await run('number => $t\n42 -> :?$t')).toBe(true);
    });

    it('$t holds string type value — "hello" -> :?$t returns true', async () => {
      expect(await run('string => $t\n"hello" -> :?$t')).toBe(true);
    });

    it('$t holds number type value — "hello" -> :?$t returns false', async () => {
      expect(await run('number => $t\n"hello" -> :?$t')).toBe(false);
    });
  });

  // ============================================================
  // Shape dispatch via $var (AC-16)
  // ============================================================

  describe.skip('Shape Dispatch via $var (resolveTypeRef returns RillShape)', () => {
    // Skipped: shape() syntax removed in Phase 2.
    it('$s holds a shape — valid dict passes :$s assertion', async () => {
      const result = await run(`
        shape(x: number) => $s
        [x: 42] -> :$s
      `);
      expect(result).toEqual({ x: 42 });
    });

    it('$s holds a shape — invalid dict fails :$s assertion', async () => {
      await expect(
        run(`
          shape(x: number) => $s
          [x: "hello"] -> :$s
        `)
      ).rejects.toThrow('expected number, got string');
    });
  });

  // ============================================================
  // Error cases unchanged (AC-16)
  // ============================================================

  describe('Error Cases Unchanged', () => {
    it('"number" => $t; 42 -> :$t throws RILL-R004 (string is not a type reference)', async () => {
      await expect(
        run(`
          "number" => $t
          42 -> :$t
        `)
      ).rejects.toThrow('not a valid type reference');
    });
  });
});
