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
      const result = (await run('string')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('string');
    });

    it('number evaluates as a RillTypeValue with typeName "number"', async () => {
      const result = (await run('number')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('number');
    });

    it('bool evaluates as a RillTypeValue with typeName "bool"', async () => {
      const result = (await run('bool')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('bool');
    });

    it('dict evaluates as a RillTypeValue with typeName "dict"', async () => {
      const result = (await run('dict')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
    });

    it('list evaluates as a RillTypeValue with typeName "list"', async () => {
      const result = (await run('list')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('list');
    });

    it('tuple evaluates as a RillTypeValue with typeName "tuple"', async () => {
      const result = (await run('tuple')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
    });

    it('vector evaluates as a RillTypeValue with typeName "vector"', async () => {
      const result = (await run('vector')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('vector');
    });

    it('closure evaluates as a RillTypeValue with typeName "closure"', async () => {
      const result = (await run('closure')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('closure');
    });

    it('any evaluates as a RillTypeValue with typeName "any"', async () => {
      const result = (await run('any')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('any');
    });

    it('type evaluates as a RillTypeValue with typeName "type"', async () => {
      const result = (await run('type')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('type');
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
      const result = await run('list[1, 2] => $v\n$v.^type.name == "list"');
      expect(result).toBe(true);
    });

    it('[a: 1].^type.name == "dict" evaluates to true', async () => {
      const result = await run('dict[a: 1] => $v\n$v.^type.name == "dict"');
      expect(result).toBe(true);
    });

    it('closure.^type.name == "closure" evaluates to true (EC-4: .^type never errors)', async () => {
      const result = await run('|| { 1 } => $v\n$v.^type.name == "closure"');
      expect(result).toBe(true);
    });

    it('.^type returns a RillTypeValue object (EC-4)', async () => {
      const result = (await run('42 => $v\n$v.^type')) as any;
      expect(result.__rill_type).toBe(true);
    });

    it('.^type on a string returns typeName "string"', async () => {
      const result = (await run('"hello" => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('string');
    });

    it('.^type on a bool returns typeName "bool"', async () => {
      const result = (await run('true => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('bool');
    });

    it('.^type on a list returns typeName "list"', async () => {
      const result = (await run('list[1, 2, 3] => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('list');
    });

    it('.^type on a dict returns typeName "dict"', async () => {
      const result = (await run('dict[a: 1] => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('dict');
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
      const result = await run('list[1, 2].^type.name == "list"');
      expect(result).toBe(true);
    });

    it('[a: 1].^type.name == "dict" evaluates to true (literal receiver)', async () => {
      const result = await run('dict[a: 1].^type.name == "dict"');
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
  // .^name on Type Values raises RILL-R008 (AC-16)
  // Type values are not annotation containers.
  // ============================================================

  describe('.^name on Type Values raises RILL-R008 (AC-16)', () => {
    it('.^name on number type value raises RILL-R008', async () => {
      try {
        await run('number => $v\n$v.^name');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
    });

    it('.^name on string type value raises RILL-R008', async () => {
      try {
        await run('string => $v\n$v.^name');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
    });

    it('.^name on type type value raises RILL-R008', async () => {
      try {
        await run('type => $v\n$v.^name');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
    });

    it('.^name on .^type result raises RILL-R008', async () => {
      // .^type returns a type value; .^name on that type value raises RILL-R008
      try {
        await run('42 => $v\n$v.^type => $t\n$t.^name');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
    });

    it('typeName is accessible via host API (JS typeName property)', async () => {
      // Type name is accessible from TypeScript via the typeName property
      const result = (await run('number')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('number');
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

    it('$v.^type.^type.name — .^name on type value raises RILL-R008 (AC-27)', async () => {
      // .^name on any type value now raises RILL-R008; use host typeName property instead
      try {
        await run(`
          42 => $v
          $v.^type => $t
          $t.^type => $tt
          $tt.^name
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
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
      const result = (await run('number => $v\n$v.^type')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('type');
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
  // .signature Property on Type Values (AC-14, AC-15)
  // ============================================================

  describe('.signature Property on Type Values (AC-14, AC-15)', () => {
    it('42.^type.signature returns "number" (AC-14)', async () => {
      const result = await run('42.^type.signature');
      expect(result).toBe('number');
    });

    it('$fn.^type.signature returns "|y: string| :string" for typed closure (AC-15)', async () => {
      // rill return-type annotation syntax: body followed by :type
      const result = await run(
        '|y: string| { y }:string => $fn\n$fn.^type.signature'
      );
      expect(result).toBe('|y: string| :string');
    });
  });

  // ============================================================
  // AC-19: Unknown annotation key on type value → RILL-R003
  // Type values are not annotation containers; ^key on them raises RILL-R003.
  // ============================================================

  describe('Unknown annotation key on type value raises RILL-R003 (AC-19)', () => {
    it('42.^type.^unknownKey throws RILL-R003 (AC-19)', async () => {
      try {
        await run('42 => $v\n$v.^type => $t\n$t.^unknownKey');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R003');
      }
    });

    it('number type value with .^someKey throws RILL-R003 (AC-19)', async () => {
      try {
        await run('number => $v\n$v.^someKey');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R003');
      }
    });
  });

  // ============================================================
  // EC-5: Unknown dot property on type value → RILL-R009 (AC-20)
  // ============================================================

  describe('Unknown dot property on type value (AC-20)', () => {
    it('42.^type.unknownProp throws RILL-R009 (AC-20)', async () => {
      try {
        await run('42.^type.unknownProp');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R009');
      }
    });
  });

  // ============================================================
  // Type value string formatting
  // ============================================================

  describe('Type value formatting', () => {
    it('type value formats as structural type string via .signature', async () => {
      const result = await run('"hello".^type.signature');
      expect(result).toBe('string');
    });

    it('type value formats as structural type string for number', async () => {
      const result = await run('42.^type.signature');
      expect(result).toBe('number');
    });

    it('type value formats as structural type string for bool', async () => {
      const result = await run('true.^type.signature');
      expect(result).toBe('bool');
    });

    it('type value formats as structural type in string interpolation', async () => {
      const result = await run('dict[a: 1].^type => $t\n"kind: {$t}"');
      expect(result).toBe('kind: dict(a: number)');
    });
  });
});
