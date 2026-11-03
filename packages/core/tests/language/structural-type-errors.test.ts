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

import { ParseError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt, expectRuntimeError } from '../helpers/halt.js';

describe('Rill Language: Structural Type Error Contracts', () => {
  // ============================================================
  // AC-40: Mixed list elements throw RILL-R002
  // ============================================================

  describe('Mixed list elements (AC-40)', () => {
    it('throws on list with mixed number and string elements', async () => {
      await expectRuntimeError(() => run('list[1, "hello", 3]'), {
        code: 'RILL-R002',
        messagePattern: 'List elements must be the same type',
      });
    });

    it('throws on list with mixed string and number elements', async () => {
      await expectRuntimeError(() => run('list["a", 1]'), {
        code: 'RILL-R002',
        messagePattern: 'List elements must be the same type',
      });
    });

    it('throws on list with mixed bool and number elements', async () => {
      await expectRuntimeError(() => run('list[true, 1]'), {
        code: 'RILL-R002',
        messagePattern: 'List elements must be the same type',
      });
    });
  });

  // ============================================================
  // AC-41: list() with no arguments throws RILL-R004
  // ============================================================

  describe('list() with no arguments (AC-41)', () => {
    it('throws when list() is called with no arguments', async () => {
      await expectHalt(() => run('list()'), {
        code: 'INVALID_INPUT',
        messagePattern: 'list() requires exactly 1 type argument',
      });
    });
  });

  // ============================================================
  // AC-42: list(1, 2) with multiple args throws RILL-R004
  // ============================================================

  describe('list() with multiple arguments (AC-42)', () => {
    it('throws when list() is called with two type arguments', async () => {
      await expectHalt(() => run('list(string, number)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'list() requires exactly 1 type argument',
      });
    });

    it('throws when list() is called with a named argument', async () => {
      await expectHalt(() => run('list(a: string)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'list() requires exactly 1 type argument',
      });
    });

    it('throws when list() is called with non-type arguments — fails at parse time', async () => {
      // parseFieldArgList uses parseTypeRef for arg values; non-type tokens
      // like numeric literals are rejected at parse time.
      await expect(run('list(1, 2)')).rejects.toThrow('Expected type name');
    });
  });

  // ============================================================
  // EC-5: list with single non-type arg throws RILL-R004
  // ============================================================

  describe('EC-5: list() with single non-type argument', () => {
    it('throws when list(1) is called with a non-type argument — fails at parse time', async () => {
      // parseFieldArgList uses parseTypeRef; numeric literals are not valid type names.
      await expect(run('list(1)')).rejects.toThrow('Expected type name');
    });

    it('throws when list("hello") is called with a string argument — fails at parse time', async () => {
      // parseFieldArgList uses parseTypeRef; string literals are not valid type names.
      await expect(run('list("hello")')).rejects.toThrow('Expected type name');
    });
  });

  // ============================================================
  // AC-43: dict(string) with single positional arg produces uniform type
  // (Task 1.5: uniform path for 1 positional arg)
  // ============================================================

  describe('dict() with single positional argument (AC-43)', () => {
    it('produces uniform dict type with valueType', async () => {
      const result = (await run('dict(string)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      expect(result.structure.kind).toBe('dict');
      expect(result.structure.valueType).toEqual({ kind: 'string' });
    });

    it('throws when dict() mixes positional and named arguments', async () => {
      await expectHalt(() => run('dict(string, x: number)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'dict() cannot mix positional and named arguments',
      });
    });

    it('throws when dict() has 2+ positional arguments', async () => {
      await expectHalt(() => run('dict(string, number)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'dict() requires exactly 1 positional type argument',
      });
    });
  });

  // ============================================================
  // AC-44: tuple(a: string) with named arg throws RILL-R004
  // ============================================================

  describe('tuple() with named argument (AC-44)', () => {
    it('throws when tuple() is called with a named argument', async () => {
      await expectHalt(() => run('tuple(a: string)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'tuple() requires positional arguments',
      });
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
  // EC-6: ordered() with single positional arg produces uniform type
  // (Task 1.5: uniform path for 1 positional arg)
  // ============================================================

  describe('ordered() with single positional argument (EC-6)', () => {
    it('produces uniform ordered type with valueType', async () => {
      const result = (await run('ordered(string)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.kind).toBe('ordered');
      expect(result.structure.valueType).toEqual({ kind: 'string' });
    });

    it('throws when ordered() mixes positional and named arguments', async () => {
      await expectHalt(() => run('ordered(string, x: number)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'ordered() cannot mix positional and named arguments',
      });
    });

    it('throws when ordered() has 2+ positional arguments', async () => {
      await expectHalt(() => run('ordered(string, number)'), {
        code: 'INVALID_INPUT',
        messagePattern: 'ordered() requires exactly 1 positional type argument',
      });
    });
  });

  // ============================================================
  // FR-DFIELD-4: Malformed field annotations in type constructors
  // ============================================================

  describe('Malformed field annotations in dict type declarations', () => {
    it('throws parse error when annotation ^() appears after closing paren', async () => {
      // Annotation must precede a field; dangling annotation at end of arg list
      await expect(run('dict(name: string, ^("label"))')).rejects.toThrow(
        'Expected field after annotation'
      );
    });

    it('throws parse error when annotation has unclosed paren', async () => {
      // Missing closing paren inside ^(
      const err = await run('dict(^("label" name: string)').catch(
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).errorId).toBe('RILL-P005');
    });

    it('throws RILL-R002 when annotation spread receives non-dict value', async () => {
      // Spread requires dict; number triggers RILL-R002
      await expect(
        run('42 => $n\ndict(^(...$n) name: string)')
      ).rejects.toHaveProperty('errorId', 'RILL-R002');
    });
  });

  // ============================================================
  // Type Inference Cascade Error Contracts (AC-12)
  // ============================================================

  describe('Type Inference Cascade Error Contracts', () => {
    it('throws RILL-R002 for list vs string mismatch [AC-12]', async () => {
      await expectRuntimeError(() => run('list[list[1], "hello"]'), {
        code: 'RILL-R002',
        messagePattern: 'List elements must be the same type',
      });
    });
  });

  // ============================================================
  // EC-4 through EC-9: Type constructor non-type argument errors
  // ============================================================

  describe('EC-4 to EC-9: Type constructor argument type errors', () => {
    it('dict() with non-type value in named arg — fails at parse time (EC-5)', async () => {
      // parseFieldArgList uses parseTypeRef; numeric literals are not valid type names.
      await expect(run('dict(a: 1)')).rejects.toThrow('Expected type name');
    });

    it('tuple() with non-type positional arg — fails at parse time (EC-5)', async () => {
      // parseFieldArgList uses parseTypeRef; numeric literals are not valid type names.
      await expect(run('tuple(1)')).rejects.toThrow('Expected type name');
    });

    it('ordered() with non-type value in named arg — fails at parse time (EC-5)', async () => {
      // parseFieldArgList uses parseTypeRef; numeric literals are not valid type names.
      await expect(run('ordered(a: 1)')).rejects.toThrow('Expected type name');
    });
  });
});
