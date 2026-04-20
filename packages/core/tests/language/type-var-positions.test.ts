/**
 * Rill Language Tests: $var in All 5 Type Positions
 * Tests for dynamic type references ($var) in assertion, check, shape field,
 * closure param, and capture positions.
 *
 * Covers: AC-9, AC-10, AC-11, AC-12, AC-13, AC-17, AC-19, AC-21, AC-22, AC-25,
 *         EC-1, EC-2, EC-3
 *
 * Implementation note on AC-9 / AC-10:
 * All 5 type positions now resolve TypeRef via resolveTypeRef, dispatching on
 * both RillTypeValue and TypeStructure. The :$t (VarTypeAssertion) and :?$t
 * (VarTypeCheck) positions accept variables holding a RillTypeValue directly.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

describe('Type Variable Positions', () => {
  // ============================================================
  // Assertion Position (:$t)  [AC-9, AC-22]
  // ============================================================

  describe('Assertion Position (:$t)', () => {
    // AC-9: variable holding a RillTypeValue works in assertion position
    it('AC-9: $t holds number type value — 42 -> :$t passes', async () => {
      expect(await run('number => $t\n42 -> :$t')).toBe(42);
    });
    it('AC-9: $t holds string type value — type mismatch throws', async () => {
      await expectHaltMessage(
        () => run('number => $t\n"hello" -> :$t'),
        'expected number, got string'
      );
    });
    it('AC-9: $t holds string type value — string passes', async () => {
      expect(await run('string => $t\n"hello" -> :$t')).toBe('hello');
    });
  });

  // ============================================================
  // Check Position (:?$t)  [AC-10, AC-22]
  // ============================================================

  describe('Check Position (:?$t)', () => {
    // AC-10: variable holding a RillTypeValue works in check position
    it('AC-10: $t holds number type value — 42 -> :?$t returns true', async () => {
      expect(await run('number => $t\n42 -> :?$t')).toBe(true);
    });
    it('AC-10: $t holds number type value — "hello" -> :?$t returns false', async () => {
      expect(await run('number => $t\n"hello" -> :?$t')).toBe(false);
    });
  });

  // ============================================================
  // Closure Param Position (|val: $t|)  [AC-12]
  // ============================================================

  describe('Closure Param Position (|val: $t|)', () => {
    // AC-12: $t resolves at closure creation time
    it('AC-12: $t bound to string — closure accepts string argument', async () => {
      const result = await run(`
        string => $t
        |val: $t| { $val } => $f
        $f("hello")
      `);
      expect(result).toBe('hello');
    });

    it('AC-12: $t bound to number — closure rejects string argument', async () => {
      await expect(
        run(`
          number => $t
          |val: $t| { $val } => $f
          $f("hello")
        `)
      ).rejects.toThrow('expects number, got string');
    });

    it('AC-12: $t bound to number — closure accepts number argument', async () => {
      const result = await run(`
        number => $t
        |val: $t| { $val * 2 } => $f
        $f(21)
      `);
      expect(result).toBe(42);
    });

    it('AC-12: $t reassigned after closure creation — closure retains creation-time type', async () => {
      const result = await run(`
        string => $t
        |val: $t| { $val } => $f
        number => $t
        $f("hello")
      `);
      expect(result).toBe('hello');
    });

    it('AC-12: $t bound to list — closure accepts list argument', async () => {
      const result = await run(`
        list => $t
        |val: $t| { $val } => $f
        $f(list[1, 2, 3])
      `);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ============================================================
  // Capture Position ($x:$t)  [AC-13]
  // ============================================================

  describe('Capture Position ($x:$t)', () => {
    // AC-13: $t resolves at binding (capture execution) time
    it('AC-13: $t bound to string — capture accepts string value', async () => {
      expect(await run('string => $t\n"hello" => $x:$t\n$x')).toBe('hello');
    });

    it('AC-13: $t bound to number — capture rejects string value', async () => {
      await expect(run('number => $t\n"hello" => $x:$t')).rejects.toThrow();
    });

    it('AC-13: $t bound to number — capture accepts number value', async () => {
      expect(await run('number => $t\n42 => $x:$t\n$x')).toBe(42);
    });

    it('AC-13: $t bound to bool — capture accepts bool value', async () => {
      expect(await run('bool => $t\ntrue => $x:$t\n$x')).toBe(true);
    });

    it('AC-13: $t bound to bool — capture rejects number value', async () => {
      await expect(run('bool => $t\n42 => $x:$t')).rejects.toThrow();
    });

    it('AC-13: $t reassigned after capture — variable retains captured value', async () => {
      expect(
        await run('string => $t\n"hello" => $x:$t\nnumber => $t\n$x')
      ).toBe('hello');
    });
  });

  // ============================================================
  // Error Cases  [AC-17, AC-19, AC-21, AC-22, EC-1, EC-2, EC-3]
  // ============================================================

  describe('Error Cases', () => {
    // AC-17 / EC-3: string variable in :$t — RILL-R004
    it('AC-17/EC-3: string variable $t used in :$t assertion halts typed-atom', async () => {
      await expectHaltMessage(
        () =>
          run(`
          "number" => $t
          42 -> :$t
        `),
        'not a valid type reference'
      );
    });

    it('AC-17/EC-3: string variable $t used in :$t — identifies the variable name', async () => {
      await expectHaltMessage(
        () =>
          run(`
          "string" => $t
          42 -> :$t
        `),
        '$t is not a valid type reference'
      );
    });

    // AC-19 / EC-1: undefined variable in :$t — runtime error
    it('AC-19/EC-1: undefined variable $s used in :$s throws runtime error', async () => {
      await expect(run('42 -> :$s')).rejects.toThrow();
    });

    it('AC-19/EC-1: undefined variable identifies the variable name in error', async () => {
      await expect(run('"hello" -> :$undefined_var')).rejects.toMatchObject({
        errorId: 'RILL-R005',
        message: expect.stringContaining('$undefined_var'),
      });
    });

    // AC-21 / EC-2: number variable in :$t — RILL-R004
    it('AC-21/EC-2: number variable $t used in :$t assertion halts typed-atom', async () => {
      await expectHaltMessage(
        () =>
          run(`
          42 => $t
          42 -> :$t
        `),
        'not a valid type reference'
      );
    });

    it('AC-21/EC-2: number variable $t used in :$t — identifies the variable name', async () => {
      await expectHaltMessage(
        () =>
          run(`
          99 => $myNum
          42 -> :$myNum
        `),
        '$myNum is not a valid type reference'
      );
    });

    it('typed-atom halt in closure param position identifies param and types', async () => {
      await expect(
        run(`
          string => $t
          |val: $t| { $val } => $f
          $f(42)
        `)
      ).rejects.toThrow('val expects string, got number');
    });
  });
});
