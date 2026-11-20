/**
 * Rill Language Tests: Anonymous Typed Closure Reflection
 *
 * Tests for `.^type` structure and `.^type.inner` / `.^type.outer` reflection on
 * anonymous typed closures and bare blocks.
 *
 * AC = Acceptance Criterion from anonymous-typed-closure spec.
 *
 * Runtime internals:
 * - `.^type` returns RillTypeValue: { __rill_type: true, typeName: 'fn', structure: { kind: 'fn', params: [...], ret } }
 * - `.^type.inner` and `.^type.outer` are comparable values derived from the param and return types
 *
 * Anonymous typed fn `fn(T) { body }` produces an unnamed param with type T.
 * `fn { body }` produces an unnamed param with no type (any) for a body that reads `$`.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Anonymous Typed Closure Reflection', () => {
  // ============================================================
  // .^type.outer reflection (AC-11, AC-27, AC-28, AC-47)
  // ============================================================

  describe('.^type.outer on typed closure (AC-27, AC-47)', () => {
    it('AC-27/AC-47: fn(number):number { $ * 2 } .^type.outer returns type value with typeName "number"', async () => {
      const script = `
        fn(number):number { $ * 2 } => $fn
        $fn.^type.outer
      `;
      const result = await run(script);
      const typeValue = result as Record<string, unknown>;
      expect(typeValue['__rill_type']).toBe(true);
      expect(typeValue['typeName']).toBe('number');
    });

    it('AC-27/AC-47: .^type.outer type value compares equal to number type keyword', async () => {
      const script = `
        fn(number):number { $ * 2 } => $fn
        $fn.^type.outer == number
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('.^type.outer on unannotated closure (AC-28, AC-47)', () => {
    it('AC-28/AC-47: fn(number) { $ * 2 } .^type.outer returns type value with typeName "any"', async () => {
      const script = `
        fn(number) { $ * 2 } => $fn
        $fn.^type.outer
      `;
      const result = await run(script);
      const typeValue = result as Record<string, unknown>;
      expect(typeValue['__rill_type']).toBe(true);
      expect(typeValue['typeName']).toBe('any');
    });

    it('AC-28/AC-47: .^type.outer type value compares equal to any type keyword', async () => {
      const script = `
        fn(number) { $ * 2 } => $fn
        $fn.^type.outer == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('.^type.outer on unannotated closure (AC-11)', () => {
    it('AC-11: plain unannotated closure .^type.outer returns any type value', async () => {
      const script = `
        fn(x: string) { $x } => $fn
        $fn.^type.outer == any
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-11: bare block .^type.outer returns any type value', async () => {
      const script = `
        fn { $ * 2 } => $fn
        $fn.^type.outer == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // .^type reflection (AC-10, AC-29, AC-42)
  // ============================================================

  describe('.^type on anonymous typed closure (AC-29)', () => {
    it('AC-29: fn(string) { $ } .^type returns fn structural type with $ param typed string', async () => {
      const script = `
        fn(string) { $ } => $fn
        $fn.^type
      `;
      const result = await run(script);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          type: string;
          params: { name: string | undefined; type: unknown }[];
        };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('fn');
      expect(shape.structure.params).toHaveLength(1);
      // An unnamed parameter carries no name in the structure
      expect(shape.structure.params[0]!.name).toBeUndefined();
      expect(shape.structure.params[0]!.type).toEqual({ kind: 'string' });
    });

    it('AC-29: fn(number) { $ * 2 } .^type has $ param typed number', async () => {
      const script = `
        fn(number) { $ * 2 } => $fn
        $fn.^type
      `;
      const result = await run(script);
      const shape = result as {
        __rill_type: true;
        structure: { type: string; params: { name: string; type: unknown }[] };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.params[0]!.type).toEqual({ kind: 'number' });
    });

    it('AC-29: two fn(string) { } closures have equal .^type.inner', async () => {
      const script = `
        fn(string) { $ } => $fn1
        fn(string) { "different body" } => $fn2
        $fn1.^type.inner == $fn2.^type.inner
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-29: fn(string) { } and fn(number) { } have unequal .^type.inner', async () => {
      const script = `
        fn(string) { $ } => $fn1
        fn(number) { $ * 2 } => $fn2
        $fn1.^type.inner == $fn2.^type.inner
      `;
      expect(await run(script)).toBe(false);
    });
  });

  describe('.^type on bare block (AC-10, AC-42)', () => {
    it('AC-10/AC-42: bare block .^type returns fn structural type with $ param typed any', async () => {
      const script = `
        fn { $ * 2 } => $fn
        $fn.^type
      `;
      const result = await run(script);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          type: string;
          params: { name: string | undefined; type: unknown }[];
        };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('fn');
      expect(shape.structure.params).toHaveLength(1);
      // An unnamed parameter carries no name in the structure
      expect(shape.structure.params[0]!.name).toBeUndefined();
      // Bare block uses typeName: 'any' internally
      expect(shape.structure.params[0]!.type).toEqual({ kind: 'any' });
    });

    it('AC-10/AC-42: bare block .^type.inner equals fn(any) { } .^type.inner', async () => {
      const script = `
        fn { $ * 2 } => $bare
        fn(any) { $ * 2 } => $typed
        $bare.^type.inner == $typed.^type.inner
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // Regression: Existing closure tests unaffected (AC-46)
  // ============================================================

  describe('Regression: fn type and output interaction (AC-46)', () => {
    it('AC-46: .^type still returns fn type value for anonymous typed closure', async () => {
      const result = await run('fn(number) { $ * 2 } => $fn\n$fn.^type.name');
      expect(result).toBe('fn');
    });

    it('AC-46: annotation on anonymous typed closure does not break .^type.outer', async () => {
      const script = `
        ^(label: "double") fn(number):number { $ * 2 } => $fn
        $fn.^type.outer == number
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-46: .^type.outer on annotated closure without return type returns any', async () => {
      const script = `
        ^(label: "id") fn(string) { $ } => $fn
        $fn.^type.outer == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // .^type.inner flows through rill without RILL-R002
  // ============================================================

  describe('.^type.inner value survives rill operations (no RILL-R002)', () => {
    it('$fn.^type.inner assigned to variable and compared to itself returns true', async () => {
      const script = `
        fn(string) { $ } => $fn
        $fn.^type.inner => $shape
        $shape == $shape
      `;
      expect(await run(script)).toBe(true);
    });

    it('$fn.^type.inner compared to itself is true', async () => {
      const script = `
        fn(number) { $ * 2 } => $fn
        $fn.^type.inner => $shape
        $shape == $shape
      `;
      expect(await run(script)).toBe(true);
    });

    it('two closures with same param type have equal .^type.inner', async () => {
      const script = `
        fn(string) { $ } => $fn1
        fn(string) { "other" } => $fn2
        $fn1.^type.inner == $fn2.^type.inner
      `;
      expect(await run(script)).toBe(true);
    });
  });
});
