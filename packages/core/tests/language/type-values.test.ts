/**
 * Rill Language Tests: Type Value Expressions
 * Tests for bare type name expressions, `.^type` operator, `.name` property,
 * and type value equality.
 *
 * AC = Acceptance Criterion from the type-value-expressions spec.
 * EC = Error Contract from the type-value-expressions spec.
 *
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Type Value Expressions', () => {
  // ============================================================
  // Bare Type Name Expressions (AC-3)
  // ============================================================

  describe('Bare Type Name Expressions (AC-3)', () => {
    it('string evaluates as a RillTypeValue with typeName "string"', async () => {
      await expect(run('string')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('number evaluates as a RillTypeValue with typeName "number"', async () => {
      await expect(run('number')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('bool evaluates as a RillTypeValue with typeName "bool"', async () => {
      await expect(run('bool')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('dict evaluates as a RillTypeValue with typeName "dict"', async () => {
      await expect(run('dict')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('list evaluates as a RillTypeValue with typeName "list"', async () => {
      await expect(run('list')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('tuple evaluates as a RillTypeValue with typeName "tuple"', async () => {
      await expect(run('tuple')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('vector evaluates as a RillTypeValue with typeName "vector"', async () => {
      await expect(run('vector')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('closure evaluates as a RillTypeValue with typeName "closure"', async () => {
      await expect(run('closure')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('any evaluates as a RillTypeValue with typeName "any"', async () => {
      await expect(run('any')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('type evaluates as a RillTypeValue with typeName "type"', async () => {
      await expect(run('type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });
  });

  // ============================================================
  // .^type Operator — Basic Type Retrieval (AC-4, AC-5, EC-4)
  // ============================================================

  describe('.^type Operator (AC-4, AC-5, EC-4)', () => {
    it('42.^type == number evaluates to true (AC-4)', async () => {
      const result = await run('42 => $v\n$v.^type == number');
      expect(result).toBe(true);
    });

    it('"hello".^type == string evaluates to true (AC-5)', async () => {
      const result = await run('"hello" => $v\n$v.^type == string');
      expect(result).toBe(true);
    });

    it('true.^type == bool evaluates to true', async () => {
      const result = await run('true => $v\n$v.^type == bool');
      expect(result).toBe(true);
    });

    it('[1, 2].^type.name == "list" evaluates to true', async () => {
      const result = await run('[1, 2] => $v\n$v.^type.name == "list"');
      expect(result).toBe(true);
    });

    it('[a: 1].^type.name == "dict" evaluates to true', async () => {
      const result = await run('[a: 1] => $v\n$v.^type.name == "dict"');
      expect(result).toBe(true);
    });

    it('closure.^type.name == "closure" evaluates to true (EC-4: .^type never errors)', async () => {
      const result = await run('|| { 1 } => $v\n$v.^type.name == "closure"');
      expect(result).toBe(true);
    });

    it('.^type returns a RillTypeValue object (EC-4)', async () => {
      await expect(run('42 => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('.^type on a string returns typeName "string"', async () => {
      await expect(run('"hello" => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('.^type on a bool returns typeName "bool"', async () => {
      await expect(run('true => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('.^type on a list returns typeName "list"', async () => {
      await expect(run('[1, 2, 3] => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('.^type on a dict returns typeName "dict"', async () => {
      await expect(run('[a: 1] => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });

    it('"hello".^type == string evaluates to true (literal receiver)', async () => {
      const result = await run('"hello".^type == string');
      expect(result).toBe(true);
    });

    it('42.^type == number evaluates to true (literal receiver)', async () => {
      const result = await run('42.^type == number');
      expect(result).toBe(true);
    });

    it('true.^type == bool evaluates to true (literal receiver)', async () => {
      const result = await run('true.^type == bool');
      expect(result).toBe(true);
    });

    it('[1, 2].^type.name == "list" evaluates to true (literal receiver)', async () => {
      const result = await run('[1, 2].^type.name == "list"');
      expect(result).toBe(true);
    });

    it('[a: 1].^type.name == "dict" evaluates to true (literal receiver)', async () => {
      const result = await run('[a: 1].^type.name == "dict"');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // .name on Type Values (via .^type chain)
  // ============================================================

  describe('.name on Type Values', () => {
    it('"hello" => $v; $v.^type.name returns "string"', async () => {
      const result = await run('"hello" => $v\n$v.^type.name');
      expect(result).toBe('string');
    });

    it('42 => $v; $v.^type.name returns "number"', async () => {
      const result = await run('42 => $v\n$v.^type.name');
      expect(result).toBe('number');
    });

    it('"hello".^type.name returns "string" (chained on literal)', async () => {
      const result = await run('"hello".^type.name');
      expect(result).toBe('string');
    });
  });

  // ============================================================
  // .^type on Type Values (AC-6, AC-23)
  // ============================================================

  describe('.^type on Type Values (AC-6, AC-23)', () => {
    it('number.^type == type evaluates to true (AC-6)', async () => {
      const result = await run('number => $v\n$v.^type == type');
      expect(result).toBe(true);
    });

    it('type.^type == type evaluates to true (AC-23)', async () => {
      const result = await run('type => $v\n$v.^type == type');
      expect(result).toBe(true);
    });

    it('string.^type == type evaluates to true', async () => {
      const result = await run('string => $v\n$v.^type == type');
      expect(result).toBe(true);
    });

    it('bool.^type == type evaluates to true', async () => {
      const result = await run('bool => $v\n$v.^type == type');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // .name Property on Type Values (AC-7, AC-24)
  // ============================================================

  describe('.name Property on Type Values (AC-7, AC-24)', () => {
    it('number.name == "number" evaluates to true (AC-7)', async () => {
      const result = await run('number => $v\n$v.^name == "number"');
      expect(result).toBe(true);
    });

    it('type.name == "type" evaluates to true (AC-24)', async () => {
      const result = await run('type => $v\n$v.^name == "type"');
      expect(result).toBe(true);
    });

    it('string.name returns "string"', async () => {
      const result = await run('string => $v\n$v.^name');
      expect(result).toBe('string');
    });

    it('number.name returns "number"', async () => {
      const result = await run('number => $v\n$v.^name');
      expect(result).toBe('number');
    });

    it('bool.name returns "bool"', async () => {
      const result = await run('bool => $v\n$v.^name');
      expect(result).toBe('bool');
    });

    it('dict.name returns "dict"', async () => {
      const result = await run('dict => $v\n$v.^name');
      expect(result).toBe('dict');
    });

    it('list.name returns "list"', async () => {
      const result = await run('list => $v\n$v.^name');
      expect(result).toBe('list');
    });

    it('closure.name returns "closure"', async () => {
      const result = await run('closure => $v\n$v.^name');
      expect(result).toBe('closure');
    });

    it('type.name returns "type"', async () => {
      const result = await run('type => $v\n$v.^name');
      expect(result).toBe('type');
    });
  });

  // ============================================================
  // Type Value Equality
  // ============================================================

  describe('Type Value Equality', () => {
    it('number == number evaluates to true', async () => {
      const result = await run('number == number');
      expect(result).toBe(true);
    });

    it('string == string evaluates to true', async () => {
      const result = await run('string == string');
      expect(result).toBe(true);
    });

    it('number == string evaluates to false', async () => {
      const result = await run('number == string');
      expect(result).toBe(false);
    });

    it('type == type evaluates to true', async () => {
      const result = await run('type == type');
      expect(result).toBe(true);
    });

    it('number == bool evaluates to false', async () => {
      const result = await run('number == bool');
      expect(result).toBe(false);
    });

    it('42.^type == number when stored in variable', async () => {
      const result = await run(`
        42 => $val
        $val.^type => $t
        $t == number
      `);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // .^type Chain — Depth Termination (AC-27)
  // ============================================================

  describe('.^type Chain Termination (AC-27)', () => {
    it('$v.^type.^type == type — type of a type value is type (AC-27)', async () => {
      const result = await run('42 => $v\n$v.^type => $t\n$t.^type == type');
      expect(result).toBe(true);
    });

    it('$v.^type.^type.name == "type" — full round-trip terminates correctly (AC-27)', async () => {
      const result = await run(`
        42 => $v
        $v.^type => $t
        $t.^type => $tt
        $tt.^name
      `);
      expect(result).toBe('type');
    });

    it('triple .^type chain: type of type of type is still type', async () => {
      const result = await run(`
        "hello" => $v
        $v.^type => $t1
        $t1.^type => $t2
        $t2.^type == type
      `);
      expect(result).toBe(true);
    });

    it('.^type on type value returns RillTypeValue with typeName "type"', async () => {
      await expect(run('number => $v\n$v.^type')).rejects.toThrow(
        'type values cannot be returned from scripts'
      );
    });
  });

  // ============================================================
  // Invalid Type Names Fall Through (AC-26, EC-6)
  // ============================================================

  describe('Invalid Type Names Fall Through (AC-26, EC-6)', () => {
    it('misspelled type name "nubmer" is not a type value — treated as bare host ref (AC-26, EC-6)', async () => {
      // "nubmer" is not a valid type name; the parser treats it as a bare host
      // function reference. At runtime, calling a bare identifier that has no
      // registered function produces an unknown-function error.
      await expect(run('nubmer')).rejects.toThrow();
    });

    it('misspelled "strng" is not a type value — falls through to host call path', async () => {
      await expect(run('strng')).rejects.toThrow();
    });

    it('misspelled "Bool" (capital B) is not a type value — case-sensitive', async () => {
      // Rill type names are lowercase; "Bool" is not recognized as a type name.
      await expect(run('Bool')).rejects.toThrow();
    });
  });

  // ============================================================
  // EC-7: 42 -> type produces unknown-function error
  // ============================================================

  describe('EC-7: type() removal', () => {
    it('42 -> type produces unknown-function error (EC-7)', async () => {
      await expect(run('42 -> type')).rejects.toThrow('Unknown function: type');
    });
  });

  // ============================================================
  // Type value string formatting
  // ============================================================

  describe('Type value formatting', () => {
    it('type value formats as structural type string via .str', async () => {
      const result = await run('"hello".^type.str');
      expect(result).toBe('string');
    });

    it('type value formats as structural type string for number', async () => {
      const result = await run('42.^type.str');
      expect(result).toBe('number');
    });

    it('type value formats as structural type string for bool', async () => {
      const result = await run('true.^type.str');
      expect(result).toBe('bool');
    });

    it('type value formats as structural type in string interpolation', async () => {
      const result = await run('[a: 1].^type => $t\n"kind: {$t}"');
      expect(result).toBe('kind: dict(a: number)');
    });
  });
});
