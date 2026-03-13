/**
 * Rill Language Tests: Anonymous Typed Closure Reflection
 *
 * Tests for `.^input` and `.^output` reflection on anonymous typed closures
 * and bare blocks.
 *
 * AC = Acceptance Criterion from anonymous-typed-closure spec.
 *
 * Runtime internals:
 * - `.^input` returns RillOrdered directly: { __rill_ordered: true, entries: [string, RillStructuralType][] }
 * - `.^output` returns RillTypeValue: { __rill_type: true, typeName, structure }
 *
 * Anonymous typed closure `|T|{ body }` produces param `$` with type T.
 * Bare block `{ body }` produces param `$` with no type (any).
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Anonymous Typed Closure Reflection', () => {
  // ============================================================
  // .^output reflection (AC-11, AC-27, AC-28, AC-47)
  // ============================================================

  describe('.^output on typed closure (AC-27, AC-47)', () => {
    it('AC-27/AC-47: |number|{ $ * 2 }:number .^output returns type value with typeName "number"', async () => {
      const script = `
        |number|{ $ * 2 }:number => $fn
        $fn.^output
      `;
      const result = await run(script);
      const typeValue = result as Record<string, unknown>;
      expect(typeValue.__rill_type).toBe(true);
      expect(typeValue.typeName).toBe('number');
    });

    it('AC-27/AC-47: .^output type value compares equal to number type keyword', async () => {
      const script = `
        |number|{ $ * 2 }:number => $fn
        $fn.^output == number
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('.^output on unannotated closure (AC-28, AC-47)', () => {
    it('AC-28/AC-47: |number|{ $ * 2 } .^output returns type value with typeName "any"', async () => {
      const script = `
        |number|{ $ * 2 } => $fn
        $fn.^output
      `;
      const result = await run(script);
      const typeValue = result as Record<string, unknown>;
      expect(typeValue.__rill_type).toBe(true);
      expect(typeValue.typeName).toBe('any');
    });

    it('AC-28/AC-47: .^output type value compares equal to any type keyword', async () => {
      const script = `
        |number|{ $ * 2 } => $fn
        $fn.^output == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('.^output on unannotated closure (AC-11)', () => {
    it('AC-11: plain unannotated closure .^output returns any type value', async () => {
      const script = `
        |x: string|{ $x } => $fn
        $fn.^output == any
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-11: bare block .^output returns any type value', async () => {
      const script = `
        { $ * 2 } => $fn
        $fn.^output == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // .^input reflection (AC-10, AC-29, AC-42)
  // ============================================================

  describe('.^input on anonymous typed closure (AC-29)', () => {
    it('AC-29: |string|{ $ } .^input returns closure structural type with $ param typed string', async () => {
      const script = `
        |string|{ $ } => $fn
        $fn.^input
      `;
      const result = await run(script);
      const shape = result as {
        __rill_ordered: true;
        entries: [string, { type: string }][];
      };
      expect(shape.__rill_ordered).toBe(true);
      expect(shape.entries).toHaveLength(1);
      expect(shape.entries[0]![0]).toBe('$');
      expect(shape.entries[0]![1]).toEqual({ type: 'string' });
    });

    it('AC-29: |number|{ $ * 2 } .^input has $ param typed number', async () => {
      const script = `
        |number|{ $ * 2 } => $fn
        $fn.^input
      `;
      const result = await run(script);
      const shape = result as {
        __rill_ordered: true;
        entries: [string, { type: string }][];
      };
      expect(shape.__rill_ordered).toBe(true);
      expect(shape.entries[0]![1]).toEqual({ type: 'number' });
    });

    it('AC-29: two |string|{ } closures have equal .^input', async () => {
      const script = `
        |string|{ $ } => $fn1
        |string|{ "different body" } => $fn2
        $fn1.^input == $fn2.^input
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-29: |string|{ } and |number|{ } have unequal .^input', async () => {
      const script = `
        |string|{ $ } => $fn1
        |number|{ $ * 2 } => $fn2
        $fn1.^input == $fn2.^input
      `;
      expect(await run(script)).toBe(false);
    });
  });

  describe('.^input on bare block (AC-10, AC-42)', () => {
    it('AC-10/AC-42: bare block .^input returns closure structural type with $ param typed any', async () => {
      const script = `
        { $ * 2 } => $fn
        $fn.^input
      `;
      const result = await run(script);
      const shape = result as {
        __rill_ordered: true;
        entries: [string, { type: string }][];
      };
      expect(shape.__rill_ordered).toBe(true);
      expect(shape.entries).toHaveLength(1);
      expect(shape.entries[0]![0]).toBe('$');
      // Bare block uses typeName: 'any' internally, which maps to { type: 'any' }
      expect(shape.entries[0]![1]).toEqual({ type: 'any' });
    });

    it('AC-10/AC-42: bare block .^input equals |any|{ } .^input', async () => {
      const script = `
        { $ * 2 } => $bare
        |any|{ $ * 2 } => $typed
        $bare.^input == $typed.^input
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // Regression: Existing closure tests unaffected (AC-46)
  // ============================================================

  describe('Regression: closure type and output interaction (AC-46)', () => {
    it('AC-46: .^type still returns closure type value for anonymous typed closure', async () => {
      const result = await run('|number|{ $ * 2 } => $fn\n$fn.^type.name');
      expect(result).toBe('closure');
    });

    it('AC-46: annotation on anonymous typed closure does not break .^output', async () => {
      const script = `
        ^(label: "double") |number|{ $ * 2 }:number => $fn
        $fn.^output == number
      `;
      expect(await run(script)).toBe(true);
    });

    it('AC-46: .^output on annotated closure without return type returns any', async () => {
      const script = `
        ^(label: "id") |string|{ $ } => $fn
        $fn.^output == any
      `;
      expect(await run(script)).toBe(true);
    });
  });

  // ============================================================
  // .^input flows through rill without RILL-R002
  // ============================================================

  describe('.^input value survives rill operations (no RILL-R002)', () => {
    it('$fn.^input assigned to variable, __rill_ordered access returns true', async () => {
      const script = `
        |string|{ $ } => $fn
        $fn.^input => $shape
        $shape.__rill_ordered
      `;
      expect(await run(script)).toBe(true);
    });

    it('$fn.^input compared to itself is true', async () => {
      const script = `
        |number|{ $ * 2 } => $fn
        $fn.^input => $shape
        $shape == $shape
      `;
      expect(await run(script)).toBe(true);
    });

    it('two closures with same param type have equal .^input', async () => {
      const script = `
        |string|{ $ } => $fn1
        |string|{ "other" } => $fn2
        $fn1.^input == $fn2.^input
      `;
      expect(await run(script)).toBe(true);
    });
  });
});
