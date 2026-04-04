/**
 * Rill Language Tests: Type-Ref Arg Unification
 *
 * Tests that parseFieldArgList and resolveTypeRef handle parameterized
 * collection types with named/positional forms, optional defaults,
 * union type args, and trailing commas.
 *
 * AC-1  through AC-8:   success cases for closure params, expression literals, and equality
 * AC-11 through AC-14:  error cases for default mismatch and parse failures
 * AC-15 through AC-18:  boundary cases for empty args, trailing commas, support matrix
 * AC-21:                public API exports unchanged
 * EC-1  through EC-10:  error contracts for parse/runtime failures
 */

import { describe, expect, it } from 'vitest';

import {
  isTuple,
  parse,
  ParseError,
  structureEquals,
  formatStructure,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Type-Ref Arg Unification', () => {
  // ============================================================
  // AC-1: |a: dict(b: number = 5)| closure, invoke with dict[]
  // ============================================================

  describe('AC-1: dict with default field, invoke/convert with empty dict', () => {
    it('closure param annotation hydrates dict default to 5', async () => {
      const result = await run(
        '|a: dict(b: number = 5)| { $a } => $fn\n$fn(dict[])'
      );
      expect(result).toEqual({ b: 5 });
    });

    it('accessing hydrated default field returns 5', async () => {
      const result = await run(
        '|a: dict(b: number = 5)| { $a.b } => $fn\n$fn(dict[])'
      );
      expect(result).toBe(5);
    });
  });

  // ============================================================
  // AC-2: |a: tuple(number = 0, string = "")| invoke with tuple[]
  // ============================================================

  describe('AC-2: tuple with defaults, convert with empty tuple', () => {
    it('closure param annotation hydrates tuple defaults to tuple[0, ""]', async () => {
      const result = await run(
        '|a: tuple(number = 0, string = "")| { $a } => $fn\n$fn(tuple[])'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([0, '']);
    });
  });

  // ============================================================
  // AC-3: dict(a: string | number) as expression literal
  // ============================================================

  describe('AC-3: dict type constructor with union field', () => {
    it('dict(a: string | number) produces type value with union field', async () => {
      const result = (await run('dict(a: string | number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      expect(result.structure.kind).toBe('dict');
      // Field 'a' has a union type
      const fieldA = result.structure.fields.a;
      expect(fieldA).toBeDefined();
      expect(fieldA.type.kind).toBe('union');
      expect(fieldA.type.members).toHaveLength(2);
    });
  });

  // ============================================================
  // AC-4: |a: dict(b: string | number = "x")| invoke with dict[]
  // ============================================================

  describe('AC-4: dict with union-typed field and default via closure', () => {
    it('closure param annotation hydrates union-typed default "x"', async () => {
      const result = await run(
        '|a: dict(b: string | number = "x")| { $a.b } => $fn\n$fn(dict[])'
      );
      expect(result).toBe('x');
    });
  });

  // ============================================================
  // AC-5: Same input in annotation and expression context
  // ============================================================

  describe('AC-5: annotation vs expression context equivalence', () => {
    it('dict(b: number) produces equivalent structure in both contexts', async () => {
      // Expression context: produces a type value directly
      const exprType = (await run('dict(b: number)')) as any;
      // Annotation context: type assertion on a matching value
      const annotResult = await run('[b: 42] -> :dict(b: number)');
      // The expression type should have the same field definition
      expect(exprType.__rill_type).toBe(true);
      expect(exprType.structure.fields.b.type).toEqual({ kind: 'number' });
      // Annotation passes the value through
      expect(annotResult).toEqual({ b: 42 });
    });

    it('dict(b: number = 5) structure matches between contexts', async () => {
      // Expression context
      const exprType = (await run('dict(b: number = 5)')) as any;
      // Annotation context: :> conversion hydrates defaults
      const convResult = await run('dict[] -> :>dict(b: number = 5)');
      expect(exprType.structure.fields.b.type).toEqual({ kind: 'number' });
      expect(exprType.structure.fields.b.defaultValue).toBe(5);
      expect(convResult).toEqual({ b: 5 });
    });
  });

  // ============================================================
  // AC-6: Two identical FieldArg lists -> equality true
  // ============================================================

  describe('AC-6: identical type arg lists produce equal type values', () => {
    it('dict(a: number, b: string) == dict(a: number, b: string) is true', async () => {
      const result = await run(
        'dict(a: number, b: string) == dict(a: number, b: string)'
      );
      expect(result).toBe(true);
    });

    it('dict(a: number = 5) == dict(a: number = 5) is true', async () => {
      const result = await run('dict(a: number = 5) == dict(a: number = 5)');
      expect(result).toBe(true);
    });

    it('tuple(number, string) == tuple(number, string) is true', async () => {
      const result = await run(
        'tuple(number, string) == tuple(number, string)'
      );
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-7: Two FieldArg lists differing only in default value -> inequality
  // ============================================================

  describe('AC-7: type arg lists differing in default value are not equal', () => {
    it('dict(a: number = 5) != dict(a: number = 10) is true', async () => {
      const result = await run('dict(a: number = 5) != dict(a: number = 10)');
      expect(result).toBe(true);
    });

    it('dict(a: number = 5) != dict(a: number) is true', async () => {
      const result = await run('dict(a: number = 5) != dict(a: number)');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-8: Collection type arg with default, caller omits arg
  // ============================================================

  describe('AC-8: default applied when caller omits arg', () => {
    it('dict default applied during :> conversion', async () => {
      const result = await run('dict[] -> :>dict(x: number = 42)');
      expect(result).toEqual({ x: 42 });
    });

    it('tuple trailing default applied during :> conversion', async () => {
      const result = await run(
        'tuple[1] -> :>tuple(number, string = "default")'
      );
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'default']);
    });
  });

  // ============================================================
  // AC-15: Empty arg list dict() -> parses to 0 args
  // ============================================================

  describe('AC-15: empty arg list parses successfully', () => {
    it('dict() produces type value with no fields', async () => {
      const result = (await run('dict()')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      // Empty arg list means bare type, no structural fields
    });

    it('tuple() produces type value with no elements', async () => {
      const result = (await run('tuple()')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
    });
  });

  // ============================================================
  // AC-16: Trailing comma dict(a: number,) -> parses without error
  // ============================================================

  describe('AC-16: trailing comma in arg list parses without error', () => {
    it('dict(a: number,) parses and produces correct type value', async () => {
      const result = (await run('dict(a: number,)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      expect(result.structure.fields.a.type).toEqual({ kind: 'number' });
    });

    it('tuple(number, string,) parses and produces correct type value', async () => {
      const result = (await run('tuple(number, string,)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
    });
  });

  // ============================================================
  // AC-17: All 8 support matrix rows
  // ============================================================

  describe('AC-17: support matrix — all 8 rows', () => {
    // Row 1: dict(a: number) — named positional, annotation context
    it('row 1: dict(a: number) annotation context', async () => {
      const result = await run('[a: 42] -> :dict(a: number)');
      expect(result).toEqual({ a: 42 });
    });

    // Row 2: dict(a: number = 5) — named with default, annotation context
    it('row 2: dict(a: number = 5) annotation context with conversion', async () => {
      const result = await run('dict[] -> :>dict(a: number = 5)');
      expect(result).toEqual({ a: 5 });
    });

    // Row 3: tuple(number, string) — positional, annotation context
    it('row 3: tuple(number, string) annotation context', async () => {
      const result = await run('tuple[1, "x"] -> :tuple(number, string)');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'x']);
    });

    // Row 4: tuple(number = 0, string = "") — positional with defaults, annotation context
    it('row 4: tuple(number = 0, string = "") annotation context with conversion', async () => {
      const result = await run('tuple[] -> :>tuple(number = 0, string = "")');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([0, '']);
    });

    // Row 5: dict(a: number) — named, expression context
    it('row 5: dict(a: number) expression context', async () => {
      const result = (await run('dict(a: number)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.fields.a.type).toEqual({ kind: 'number' });
    });

    // Row 6: dict(a: number = 5) — named with default, expression context
    it('row 6: dict(a: number = 5) expression context', async () => {
      const result = (await run('dict(a: number = 5)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.fields.a.type).toEqual({ kind: 'number' });
      expect(result.structure.fields.a.defaultValue).toBe(5);
    });

    // Row 7: tuple(number, string) — positional, expression context
    it('row 7: tuple(number, string) expression context', async () => {
      const result = (await run('tuple(number, string)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.elements).toHaveLength(2);
      expect(result.structure.elements[0].type).toEqual({ kind: 'number' });
      expect(result.structure.elements[1].type).toEqual({ kind: 'string' });
    });

    // Row 8: tuple(number = 0, string = "") — positional with defaults, expression context
    it('row 8: tuple(number = 0, string = "") expression context', async () => {
      const result = (await run('tuple(number = 0, string = "")')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.elements).toHaveLength(2);
      expect(result.structure.elements[0].defaultValue).toBe(0);
      expect(result.structure.elements[1].defaultValue).toBe('');
    });
  });

  // ============================================================
  // AC-18: list(string) unchanged behavior
  // ============================================================

  describe('AC-18: list(string) unchanged behavior', () => {
    it('list(string) produces uniform list type', async () => {
      const result = (await run('list(string)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('list');
      expect(result.structure.element).toEqual({ kind: 'string' });
    });

    it('list[1, 2, 3] -> :list(number) assertion passes', async () => {
      const result = await run('list[1, 2, 3] -> :list(number)');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ============================================================
  // AC-21: Public API exports identical before and after
  // ============================================================

  describe('AC-21: public API exports unchanged', () => {
    it('key exports exist in @rcrsr/rill', async () => {
      // Verify that key public API symbols are still exported
      expect(typeof isTuple).toBe('function');
      expect(typeof parse).toBe('function');
      expect(typeof structureEquals).toBe('function');
      expect(typeof formatStructure).toBe('function');
      expect(ParseError).toBeDefined();
    });
  });

  // ============================================================
  // FR-DFIELD-1: Field annotations in type-ref arg unification
  // ============================================================

  describe('Field annotations in type-ref unification', () => {
    it('dict type with annotated field equals same annotated type', async () => {
      const result = await run(
        'dict(^("label") a: number) == dict(^("label") a: number)'
      );
      expect(result).toBe(true);
    });

    it('dict types with different annotations are structurally equal', async () => {
      // Annotations are metadata; structural equality ignores them
      const result = await run(
        'dict(^("x") a: number) == dict(^("y") a: number)'
      );
      expect(result).toBe(true);
    });

    it('annotated dict field preserves annotation through :> conversion', async () => {
      const result = (await run('dict(^("label") a: number) => $t\n$t')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.fields.a.annotations).toEqual({
        description: 'label',
      });
    });

    it('ordered type with annotated fields evaluates correctly', async () => {
      const result = (await run(
        'ordered(^("first") a: string, ^("second") b: number)'
      )) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.fields).toHaveLength(2);
      expect(result.structure.fields[0].annotations).toEqual({
        description: 'first',
      });
      expect(result.structure.fields[1].annotations).toEqual({
        description: 'second',
      });
    });

    it('tuple type with annotated elements evaluates correctly', async () => {
      const result = (await run('tuple(^("x") number, ^("y") string)')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.structure.elements).toHaveLength(2);
      expect(result.structure.elements[0].annotations).toEqual({
        description: 'x',
      });
      expect(result.structure.elements[1].annotations).toEqual({
        description: 'y',
      });
    });
  });

  // ============================================================
  // ERROR CONTRACT TESTS
  // ============================================================

  // ============================================================
  // EC-8, AC-11: dict(a: string = 42) -> RILL-R004
  // ============================================================

  describe('EC-8, AC-11: default type mismatch in dict -> RILL-R004', () => {
    it('dict(a: string = 42) throws RILL-R004 for wrong default type', async () => {
      await expect(run('dict(a: string = 42)')).rejects.toThrow(
        /Default value for field 'a' must be string/
      );
    });

    it('dict(a: string = 42) has errorId RILL-R004', async () => {
      await expect(run('dict(a: string = 42)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-9, AC-12: Default expression evaluation error -> propagated
  // ============================================================

  describe('EC-9, AC-12: default evaluation error propagates original code', () => {
    it('default with interpolation referencing undefined var propagates RILL-R005', async () => {
      // String interpolation in a default value triggers evaluation of $undef,
      // which propagates the original RILL-R005 error from the runtime.
      // Simple $undef is not a valid literal; string interpolation is.
      await expect(
        run('dict(a: string = "hello {$undef}")')
      ).rejects.toHaveProperty('errorId', 'RILL-R005');
    });
  });

  // ============================================================
  // EC-1, EC-2, AC-13: Arg-list parse failure -> RILL-P014
  // ============================================================

  describe('EC-1, EC-2, AC-13: arg-list parse failure -> RILL-P014', () => {
    it('malformed arg list throws RILL-P014', () => {
      // Missing closing paren
      try {
        parse('dict(a: number');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P014');
      }
    });

    it('missing comma between args throws RILL-P014', () => {
      // Missing comma between args triggers RILL-P014 (EC-1)
      try {
        parse('dict(a: number b: string)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P014');
      }
    });
  });

  // ============================================================
  // EC-8, AC-14: tuple(number = "x") -> RILL-R004
  // ============================================================

  describe('EC-8, AC-14: tuple default type mismatch -> RILL-R004', () => {
    it('tuple(number = "x") throws RILL-R004', async () => {
      await expect(run('tuple(number = "x")')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-4: Non-type variable value -> RILL-R004
  // ============================================================

  describe('EC-4: non-type variable used as type ref -> RILL-R004', () => {
    it('variable holding number used as type ref throws RILL-R004', async () => {
      await expect(run('42 => $t\n"hello" -> :$t')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-5: list with != 1 arg -> RILL-R004
  // ============================================================

  describe('EC-5: list with wrong number of args -> RILL-R004', () => {
    it('list(string, number) with 2 args throws RILL-R004', async () => {
      await expect(run('list(string, number)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });

    it('list(a: string) with named arg throws RILL-R004', async () => {
      await expect(run('list(a: string)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-6: dict/ordered mixed arg kinds -> RILL-R004
  // ============================================================

  describe('EC-6: dict/ordered mixed positional and named args -> RILL-R004', () => {
    it('dict(string, a: number) with mixed args throws RILL-R004', async () => {
      await expect(run('dict(string, a: number)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });

    it('ordered(string, a: number) with mixed args throws RILL-R004', async () => {
      await expect(run('ordered(string, a: number)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-7: tuple with named arg -> RILL-R004
  // ============================================================

  describe('EC-7: tuple with named arg -> RILL-R004', () => {
    it('tuple(a: number) throws RILL-R004', async () => {
      await expect(run('tuple(a: number)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });

    it('tuple(a: number, b: string) throws RILL-R004', async () => {
      await expect(run('tuple(a: number, b: string)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });
  });

  // ============================================================
  // EC-3: Variable not found -> RILL-R005
  // ============================================================

  describe('EC-3: undefined variable in type position -> RILL-R005', () => {
    it('type assertion with undefined variable throws RILL-R005', async () => {
      await expect(run('"hello" -> :$notDefined')).rejects.toHaveProperty(
        'errorId',
        'RILL-R005'
      );
    });
  });

  // ============================================================
  // EC-10: tuple non-trailing default -> RILL-R004
  // ============================================================

  describe('EC-10: tuple non-trailing default -> RILL-R004', () => {
    it('tuple(number = 0, string) throws RILL-R004 for non-trailing default', async () => {
      await expect(run('tuple(number = 0, string)')).rejects.toThrow(
        /tuple\(\) default values must be trailing/
      );
    });

    it('tuple(string = "x", number, bool = true) throws RILL-R004 for non-trailing default', async () => {
      await expect(
        run('tuple(string = "x", number, bool = true)')
      ).rejects.toThrow(/tuple\(\) default values must be trailing/);
    });
  });
});
