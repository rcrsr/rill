/**
 * Rill Language Tests: Structural Type Error Contracts
 * Tests for error cases in structural type construction and list operations.
 *
 * AC = Acceptance Criterion from the structural-type-identity spec.
 * EC = Error Contract from the structural-type-identity spec.
 *
 * Implementation notes:
 * - list(), dict(), tuple() constructor errors all use RILL-R004 (not RILL-P005).
 * - Mixed-type list construction and list spread both use RILL-R002.
 * - list(1, 2) with 2 args errors on argument count before type check.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Structural Type Error Contracts', () => {
  // ============================================================
  // AC-40: Mixed list elements throw RILL-R002
  // ============================================================

  describe('Mixed list elements (AC-40)', () => {
    it('throws on list with mixed number and string elements', async () => {
      await expect(run('list[1, "hello", 3]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });

    it('throws on list with mixed string and number elements', async () => {
      await expect(run('list["a", 1]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });

    it('throws on list with mixed bool and number elements', async () => {
      await expect(run('list[true, 1]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });
  });

  // ============================================================
  // AC-41: list() with no arguments throws RILL-R004
  // ============================================================

  describe('list() with no arguments (AC-41)', () => {
    it('throws when list() is called with no arguments', async () => {
      await expect(run('list()')).rejects.toThrow(
        'list() requires exactly 1 type argument'
      );
    });
  });

  // ============================================================
  // AC-42: list(1, 2) with multiple args throws RILL-R004
  // ============================================================

  describe('list() with multiple arguments (AC-42)', () => {
    it('throws when list() is called with 2 arguments — fails on arg count', async () => {
      // list() checks arg count (must be exactly 1) before type validation.
      // list(1, 2) has 2 args so it throws "requires exactly 1 type argument".
      await expect(run('list(1, 2)')).rejects.toThrow(
        'list() requires exactly 1 type argument'
      );
    });
  });

  // ============================================================
  // EC-5: list with single non-type arg throws RILL-R004
  // ============================================================

  describe('EC-5: list() with single non-type argument', () => {
    it('throws when list(1) is called with a non-type argument', async () => {
      await expect(run('list(1)')).rejects.toThrow(
        'Type constructor argument must be a type value'
      );
    });

    it('throws when list("hello") is called with a string argument', async () => {
      await expect(run('list("hello")')).rejects.toThrow(
        'Type constructor argument must be a type value'
      );
    });
  });

  // ============================================================
  // AC-43: dict(string) with positional arg throws RILL-R004
  // ============================================================

  describe('dict() with positional argument (AC-43)', () => {
    it('throws when dict() is called with a positional argument', async () => {
      await expect(run('dict(string)')).rejects.toThrow(
        'dict() requires named arguments'
      );
    });
  });

  // ============================================================
  // AC-44: tuple(a: string) with named arg throws RILL-R004
  // ============================================================

  describe('tuple() with named argument (AC-44)', () => {
    it('throws when tuple() is called with a named argument', async () => {
      await expect(run('tuple(a: string)')).rejects.toThrow(
        'tuple() requires positional arguments'
      );
    });
  });

  // ============================================================
  // AC-45: tuple[1, 2, 3] literal produces tuple
  // ============================================================

  describe('List spread produces tuple (AC-45)', () => {
    it('produces a tuple when spreading a homogeneous list', async () => {
      const result = (await run('tuple[1, 2, 3] => $t\n$t.^type')) as any;
      expect(result.typeName).toBe('tuple');
    });

    it('produces an empty tuple when spreading an empty list', async () => {
      const result = (await run('tuple[] => $t\n$t.^type')) as any;
      expect(result.typeName).toBe('tuple');
    });
  });

  // ============================================================
  // EC-6: Type constructor in dict/ordered requires named args
  // ============================================================

  describe('EC-6: ordered() with positional argument', () => {
    it('throws when ordered() is called with a positional argument', async () => {
      await expect(run('ordered(string)')).rejects.toThrow(
        'ordered() requires named arguments'
      );
    });
  });

  // ============================================================
  // Type Inference Cascade Error Contracts (AC-11, AC-12, AC-13)
  // ============================================================

  describe('Type Inference Cascade Error Contracts', () => {
    it('throws RILL-R002 for primitive top-level mismatch [AC-11]', async () => {
      await expect(run('list[1, "hello"]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });

    it('throws RILL-R002 for list vs string mismatch [AC-12]', async () => {
      await expect(run('list[list[1], "hello"]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });

    // Duplicate of line 37 (AC-40); retained for RILL-R002 error contract coverage
    it('throws RILL-R002 for bool vs number mismatch [AC-13]', async () => {
      await expect(run('list[true, 1]')).rejects.toThrow(
        'List elements must be the same type'
      );
    });
  });

  // ============================================================
  // EC-4: list() error shows clear message
  // ============================================================

  describe('EC-4: list() no-argument error message', () => {
    it('error message mentions exactly 1 type argument', async () => {
      await expect(run('list()')).rejects.toThrow('exactly 1 type argument');
    });
  });

  // ============================================================
  // EC-4 through EC-9: Type constructor non-type argument errors
  // ============================================================

  describe('EC-4 to EC-9: Type constructor argument type errors', () => {
    it('dict() with non-type value in named arg throws RILL-R004 (EC-5)', async () => {
      await expect(run('dict(a: 1)')).rejects.toThrow(
        'Type constructor argument must be a type value'
      );
    });

    it('tuple() with non-type positional arg throws RILL-R004 (EC-5)', async () => {
      await expect(run('tuple(1)')).rejects.toThrow(
        'Type constructor argument must be a type value'
      );
    });

    it('ordered() with non-type value in named arg throws RILL-R004 (EC-5)', async () => {
      await expect(run('ordered(a: 1)')).rejects.toThrow(
        'Type constructor argument must be a type value'
      );
    });
  });
});
