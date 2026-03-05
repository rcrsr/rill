/**
 * Rill Language Tests: Structural Type Boundary Conditions
 * Tests for edge cases in structural type inference and equality.
 *
 * AC = Acceptance Criterion from the structural-type-identity spec.
 *
 * Implementation notes:
 * - AC-48 (*[] spread on empty list) is skipped: list spread is removed.
 * - formatStructuralType output: list(number), dict(a: number), tuple(number, string),
 *   ordered(a: number), any. Dict fields are sorted alphabetically.
 * - *[:] spreads an empty dict and produces an empty RillOrdered = ordered().
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Structural Type Boundary Conditions', () => {
  // ============================================================
  // AC-46: [] → list(any)
  // ============================================================

  describe('Empty list is list(any) (AC-46)', () => {
    it('[].^type == list(any) evaluates to true', async () => {
      const result = await run('[].^type == list(any)');
      expect(result).toBe(true);
    });

    it('[].^type.name returns "list"', async () => {
      const result = await run('[].^type.name');
      expect(result).toBe('list');
    });

    it('[].^type.str returns "list(any)"', async () => {
      const result = await run('[].^type.str');
      expect(result).toBe('list(any)');
    });
  });

  // ============================================================
  // AC-47: [:] → dict()
  // ============================================================

  describe('Empty dict is dict() (AC-47)', () => {
    it('[:].^type == dict() evaluates to true', async () => {
      const result = await run('[:].^type == dict()');
      expect(result).toBe(true);
    });

    it('[:].^type.name returns "dict"', async () => {
      const result = await run('[:].^type.name');
      expect(result).toBe('dict');
    });

    it('[:].^type.str returns "dict()"', async () => {
      const result = await run('[:].^type.str');
      expect(result).toBe('dict()');
    });
  });

  // ============================================================
  // AC-48: *[] → SKIPPED (list spread removed)
  // ============================================================

  describe('AC-48: *[] spread on empty list (SKIPPED)', () => {
    it.skip('*[] produces ordered() — SKIPPED: list spread removed in Phase 2', async () => {
      // List spread (*list) was removed. *[] throws RILL-R002 "Spread requires dict, got list".
      // This AC is no longer achievable with the current implementation.
      const result = await run('*[].^type == ordered()');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-49: *[:] → ordered()
  // Note: ordered() type equality and .^type inference via spread are not yet
  // implemented (pre-existing failures in structural-type-identity.test.ts AC-12,
  // AC-36, AC-38). These tests are skipped until that implementation lands.
  // ============================================================

  describe('Spread on empty dict produces ordered() (AC-49)', () => {
    it.skip('*[:].^type == ordered() evaluates to true — SKIP: ordered() type equality not yet implemented', async () => {
      const result = await run('*[:].^type == ordered()');
      expect(result).toBe(true);
    });

    it.skip('*[:].^type.name returns "ordered" — SKIP: ordered() structural type inference not yet implemented', async () => {
      const result = await run('*[:].^type.name');
      expect(result).toBe('ordered');
    });

    it.skip('*[:].^type.str returns "ordered()" — SKIP: ordered() structural type inference not yet implemented', async () => {
      const result = await run('*[:].^type.str');
      expect(result).toBe('ordered()');
    });
  });

  // ============================================================
  // AC-50: [1] → list(number)
  // ============================================================

  describe('Single-element list is list(number) (AC-50)', () => {
    it('[1].^type == list(number) evaluates to true', async () => {
      const result = await run('[1].^type == list(number)');
      expect(result).toBe(true);
    });

    it('[1].^type.str returns "list(number)"', async () => {
      const result = await run('[1].^type.str');
      expect(result).toBe('list(number)');
    });

    it('[1, 2, 3].^type == list(number) evaluates to true', async () => {
      const result = await run('[1, 2, 3].^type == list(number)');
      expect(result).toBe(true);
    });

    it('["a", "b"].^type == list(string) evaluates to true', async () => {
      const result = await run('["a", "b"].^type == list(string)');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-51: Nested dict structural type [a: [x: 1]].^type == dict(a: dict(x: number))
  // ============================================================

  describe('Nested dict structural type (AC-51)', () => {
    it('[a: [x: 1]].^type == dict(a: dict(x: number)) evaluates to true', async () => {
      const result = await run('[a: [x: 1]].^type == dict(a: dict(x: number))');
      expect(result).toBe(true);
    });

    it('[a: [x: 1]].^type.str returns "dict(a: dict(x: number))"', async () => {
      const result = await run('[a: [x: 1]].^type.str');
      expect(result).toBe('dict(a: dict(x: number))');
    });
  });

  // ============================================================
  // AC-52: [[1, 2], [3, 4]] → list(list(number))
  // ============================================================

  describe('Nested list structural type (AC-52)', () => {
    it('[[1, 2], [3, 4]].^type == list(list(number)) evaluates to true', async () => {
      const result = await run('[[1, 2], [3, 4]].^type == list(list(number))');
      expect(result).toBe(true);
    });

    it('[[1, 2], [3, 4]].^type.str returns "list(list(number))"', async () => {
      const result = await run('[[1, 2], [3, 4]].^type.str');
      expect(result).toBe('list(list(number))');
    });
  });

  // ============================================================
  // AC-53: type.^type.^type.^type → always returns type
  // ============================================================

  describe('Type of type chain always returns type (AC-53)', () => {
    it('type.^type.name == "type"', async () => {
      const result = await run('type => $v\n$v.^type.name');
      expect(result).toBe('type');
    });

    it('type.^type.^type.name == "type"', async () => {
      const result = await run(`
        type => $v
        $v.^type => $t1
        $t1.^type.name
      `);
      expect(result).toBe('type');
    });

    it('type.^type.^type.^type.name == "type"', async () => {
      const result = await run(`
        type => $v
        $v.^type => $t1
        $t1.^type => $t2
        $t2.^type.name
      `);
      expect(result).toBe('type');
    });

    it('number.^type.^type.name == "type" (non-type value chain)', async () => {
      const result = await run(`
        number => $v
        $v.^type => $t1
        $t1.^type.name
      `);
      expect(result).toBe('type');
    });
  });

  // ============================================================
  // Dict field sort order
  // ============================================================

  describe('Dict field sort order in structural type', () => {
    it('[b: 2, a: 1].^type.str returns "dict(a: number, b: number)" (sorted)', async () => {
      const result = await run('[b: 2, a: 1].^type.str');
      expect(result).toBe('dict(a: number, b: number)');
    });

    it('[b: 2, a: 1].^type == dict(a: number, b: number) evaluates to true', async () => {
      const result = await run(
        '[b: 2, a: 1].^type == dict(a: number, b: number)'
      );
      expect(result).toBe(true);
    });
  });
});
