/**
 * Rill Language Tests: Anonymous Typed Closure Parameters
 *
 * Tests for anonymous typed closure syntax: fn(type) { body }
 * A closure with a single type keyword as parameter type-checks the pipe value.
 *
 * AC = Acceptance Criterion from anonymous-typed-closure spec.
 * EC = Error Contract from anonymous-typed-closure spec.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import type { RillValue, RillVector } from '@rcrsr/rill';

import { run, createLogCollector } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

// Ordered and vector are special internal types not constructable via rill syntax.
// Provide them as host variables so fn(ordered) and fn(vector) can be exercised.
const ORDERED_VAL = {
  __rill_ordered: true as const,
  entries: [['a', 1]] as [string, RillValue][],
};
const VECTOR_VAL: RillVector = {
  __rill_vector: true,
  data: new Float32Array([1.0, 2.0]),
  model: 'test',
};

describe('Rill Language: Anonymous Typed Closure Parameters', () => {
  // ============================================================
  // Success Cases: Basic Typed Input
  // ============================================================

  describe('Basic Typed Input (AC-24, AC-25)', () => {
    it('AC-24: fn(number) closure doubles input', async () => {
      expect(await run('5 -> fn(number) { $ * 2 }')).toBe(10);
    });

    it('AC-25: fn(string) closure upcases input via .upper method', async () => {
      expect(await run('"hello" -> fn(string) { $ -> .upper }')).toBe('HELLO');
    });
  });

  // ============================================================
  // Equivalence with Bare Block (AC-26)
  // ============================================================

  describe('Bare Block Equivalence (AC-26)', () => {
    it('AC-26: bare block { $ * 2 } accepts number input', async () => {
      expect(await run('5 -> { $ * 2 }')).toBe(10);
    });

    it('AC-26: fn(any):any { $ * 2 } accepts number input', async () => {
      expect(await run('5 -> fn(any):any { $ * 2 }')).toBe(10);
    });

    it('AC-26: bare block and fn(any):any form produce same result', async () => {
      const bareResult = await run('5 -> { $ * 2 }');
      const typedResult = await run('5 -> fn(any):any { $ * 2 }');
      expect(bareResult).toBe(typedResult);
    });
  });

  // ============================================================
  // Pipe Chain with Typed Closure (AC-30)
  // ============================================================

  describe('Pipe Chain (AC-30)', () => {
    it('AC-30: pipe chain through typed closure and log executes', async () => {
      const { logs, callbacks } = createLogCollector();
      const result = await run('"hello" -> fn(string) { $ -> .upper } -> log', {
        callbacks,
      });
      expect(result).toBe('HELLO');
      expect(logs).toContain('HELLO');
    });

    it('AC-30: chained typed closures transform value in sequence', async () => {
      expect(
        await run('5 -> fn(number) { $ * 2 } -> fn(number) { $ + 1 }')
      ).toBe(11);
    });
  });

  // ============================================================
  // Bool Keyword (AC-31)
  // ============================================================

  describe('Bool Keyword (AC-31)', () => {
    it('AC-31: fn(bool) closure passes through true', async () => {
      expect(await run('true -> fn(bool) { $ }')).toBe(true);
    });

    it('AC-31: fn(bool) closure passes through false', async () => {
      expect(await run('false -> fn(bool) { $ }')).toBe(false);
    });
  });

  // ============================================================
  // All 11 Type Keywords (AC-32)
  // ============================================================

  describe('All 11 Type Keywords Parse as Anonymous Typed Form (AC-32)', () => {
    it('fn(string) parses and accepts string input', async () => {
      expect(await run('"hi" -> fn(string) { $ }')).toBe('hi');
    });

    it('fn(number) parses and accepts number input', async () => {
      expect(await run('42 -> fn(number) { $ }')).toBe(42);
    });

    it('fn(bool) parses and accepts bool input', async () => {
      expect(await run('true -> fn(bool) { $ }')).toBe(true);
    });

    it('fn(fn) parses and accepts fn input', async () => {
      // Body returns 42 to confirm the type-check passed and body executed
      expect(await run('{ $ } => $fn\n$fn -> fn(fn) { 42 }')).toBe(42);
    });

    it('fn(list) parses and accepts list input', async () => {
      expect(await run('list[1, 2] -> fn(list) { $ }')).toEqual([1, 2]);
    });

    it('fn(dict) parses and accepts dict input', async () => {
      expect(await run('dict[a: 1] -> fn(dict) { $ }')).toEqual({ a: 1 });
    });

    it('fn(tuple) parses and accepts tuple input', async () => {
      // tuple[...] produces a RillTuple with typeName "tuple"
      expect(await run('tuple[1, 2] -> fn(tuple) { 42 }')).toBe(42);
    });

    it('fn(ordered) parses and accepts ordered input', async () => {
      // ordered values are produced internally (e.g. dict.entries); provided via host variable
      expect(
        await run('$ordVal -> fn(ordered) { 42 }', {
          variables: { ordVal: ORDERED_VAL },
        })
      ).toBe(42);
    });

    it('fn(vector) parses and accepts vector input', async () => {
      // vector values carry __rill_vector marker; provided via host variable
      expect(
        await run('$vecVal -> fn(vector) { 42 }', {
          variables: { vecVal: VECTOR_VAL },
        })
      ).toBe(42);
    });

    it('fn(any) parses and accepts any type input', async () => {
      expect(await run('42 -> fn(any) { $ }')).toBe(42);
      expect(await run('"hello" -> fn(any) { $ }')).toBe('hello');
    });

    it('fn(type) parses and accepts type value input', async () => {
      const result = (await run('number -> fn(type) { $ }')) as Record<
        string,
        unknown
      >;
      expect(result['__rill_type']).toBe(true);
      expect(result['typeName']).toBe('number');
    });
  });

  // ============================================================
  // Dynamic Type Reference (AC-45)
  // ============================================================

  describe('Dynamic Type Reference (AC-45)', () => {
    it('AC-45: |$myType| resolves type from variable and accepts matching input', async () => {
      const script = `
        string => $myType
        "hello" -> fn($myType) { $ }
      `;
      expect(await run(script)).toBe('hello');
    });

    it('AC-45: |$myType| rejects non-matching input with RILL-R001', async () => {
      const script = `
        number => $myType
        "hello" -> fn($myType) { $ }
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  // ============================================================
  // Nested Closures (AC-44)
  // ============================================================

  describe('Nested Closures (AC-44)', () => {
    it('AC-44: inner fn(number) closure rejects string from outer body', async () => {
      // Outer accepts string; inner fn(number) rejects it — inner type-checks independently
      const script = `"hello" -> fn(string) { $ -> fn(number) { $ * 2 } }`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('AC-44: outer fn(string) closure feeds .len (number) into inner fn(number) closure', async () => {
      const script = `"hello" -> fn(string) { $.len -> fn(number) { $ * 2 } }`;
      expect(await run(script)).toBe(10);
    });
  });

  // ============================================================
  // Boundary Cases
  // ============================================================

  describe('Boundary: Bare Block Has No Type Check (AC-6)', () => {
    it('AC-6: bare block passes any type without error', async () => {
      expect(await run('5 -> { $ * 2 }')).toBe(10);
      expect(await run('"hi" -> { $ }')).toBe('hi');
      expect(await run('true -> { $ }')).toBe(true);
    });
  });

  describe('Boundary: fn(any) Accepts All Types (AC-7, AC-40)', () => {
    it('AC-7: fn(any) accepts number', async () => {
      expect(await run('5 -> fn(any) { $ * 2 }')).toBe(10);
    });

    it('AC-40: fn(any) accepts string', async () => {
      expect(await run('"hello" -> fn(any) { $ }')).toBe('hello');
    });

    it('AC-40: fn(any) accepts bool', async () => {
      expect(await run('true -> fn(any) { $ }')).toBe(true);
    });

    it('AC-40: fn(any) accepts list', async () => {
      expect(await run('list[1, 2] -> fn(any) { $ }')).toEqual([1, 2]);
    });
  });

  describe('Boundary: Typed Input with Any Return (AC-8)', () => {
    it('AC-8: fn(number):any checks input type but not output type', async () => {
      expect(await run('5 -> fn(number):any { $ * 2 }')).toBe(10);
    });

    it('AC-8: fn(number):any rejects non-number input with RILL-R001', async () => {
      await expect(
        run('"hello" -> fn(number):any { $ }')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  describe('Boundary: fn(type) Keyword Accepts Type Values (AC-41)', () => {
    it('AC-41: fn(type) accepts a type value (number)', async () => {
      const result = (await run('number -> fn(type) { $ }')) as Record<
        string,
        unknown
      >;
      expect(result['__rill_type']).toBe(true);
    });

    it('AC-41: fn(type) accepts a type value (string)', async () => {
      const result = (await run('string -> fn(type) { $ }')) as Record<
        string,
        unknown
      >;
      expect(result['__rill_type']).toBe(true);
      expect(result['typeName']).toBe('string');
    });
  });

  describe('Boundary: Non-Keyword as Named Param (AC-43)', () => {
    it('AC-43: fn(x) where x is not a type keyword parses as named-param closure', async () => {
      const script = `
        fn(x) { $x + 1 } => $fn
        $fn(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('AC-43: fn(foo) parses as named-param closure, not anonymous typed', async () => {
      const script = `
        fn(foo) { $foo * 2 } => $fn
        $fn(7)
      `;
      expect(await run(script)).toBe(14);
    });
  });

  // ============================================================
  // Error Cases
  // ============================================================

  describe('Error: Input Type Mismatch (AC-1, AC-33, EC-4)', () => {
    it('AC-1/EC-4: fn(number) rejects string input with RILL-R001', async () => {
      await expect(
        run('"hello" -> fn(number) { $ * 2 }')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('AC-39/EC-4: 5 -> fn(string) rejects number input with RILL-R001', async () => {
      await expect(run('5 -> fn(string) { $ }')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });
  });

  describe('Error: Zero-Param Fn Body Reads $ (AC-2, AC-34, EC-6)', () => {
    it('AC-2/EC-6: fn() { $ } is rejected where it is written with RILL-P029', () => {
      try {
        parse('fn() { $ }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P029');
      }
    });
  });

  describe('Error: Named-Param Closure Body References Undefined $ (AC-3, AC-35, EC-6)', () => {
    it('AC-3/EC-6: fn(x: string) { $ } body has $ undefined — throws RILL-R005', async () => {
      const script = `
        fn(x: string) { $ } => $fn
        $fn("hello")
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R005');
    });
  });

  describe('Error: Type Keyword as Param Name Causes Parse Error (AC-4, AC-37, EC-2)', () => {
    it('AC-4/EC-2: fn(string: string) throws RILL-P003 parse error', () => {
      try {
        parse('fn(string: string) { $string }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P003');
        expect(parseErr.message).toMatch(/reserved type keyword/i);
      }
    });

    it('AC-38/EC-2: fn(dict: dict) throws RILL-P003 parse error', () => {
      try {
        parse('fn(dict: dict) { $dict }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P003');
      }
    });
  });

  describe('Error: Return Type Violation (AC-5, AC-36, EC-5)', () => {
    it('AC-5/EC-5: fn(number):number { "hello" } halts #TYPE_MISMATCH on return type mismatch', async () => {
      const script = `5 -> fn(number):number { "hello" }`;
      await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
    });

    it('AC-36: fn(number):string { $ * 2 } halts #TYPE_MISMATCH when body returns number', async () => {
      const script = `5 -> fn(number):string { $ * 2 }`;
      await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
    });
  });

  describe('Error: Chained Type Mismatch (AC-9)', () => {
    it('AC-9: second typed closure in chain rejects number with RILL-R001', async () => {
      // First closure outputs number; second fn(string) closure rejects it
      const script = `5 -> fn(number) { $ * 2 } -> fn(string) { $ -> .upper }`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  // ============================================================
  // Parameterized Type Annotations — Success Cases
  // (AC-1, AC-2, AC-3, AC-8, AC-9, AC-12)
  // ============================================================

  describe('Parameterized Type: Named Param list(string) (AC-1)', () => {
    it('AC-1: closure with list(string) param accepts list of strings', async () => {
      const script = `
        fn(items: list(string)) { $items } => $fn
        $fn(list["a"])
      `;
      expect(await run(script)).toEqual(['a']);
    });

    it('AC-1: closure with list(string) param passes through multi-element list', async () => {
      const script = `
        fn(items: list(string)) { $items } => $fn
        $fn(list["x", "y", "z"])
      `;
      expect(await run(script)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('Parameterized Type: Pipe-form list(string) annotation (AC-2)', () => {
    it('AC-2: list["a", "b"] piped through fn(list(string)) block returns list', async () => {
      const result = await run('list["a", "b"] -> fn(list(string)) { $ }');
      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('Parameterized Type: Return type list(string) annotation (AC-3)', () => {
    it('AC-3: closure with :list(string) return type returns ["a"] for string input', async () => {
      const script = `
        fn(string):list(string) { [$] } => $fn
        $fn("a")
      `;
      expect(await run(script)).toEqual(['a']);
    });
  });

  describe('Parameterized Type: Bare list annotation unchanged (AC-12, AC-24)', () => {
    it('AC-12: fn(list) param accepts list of numbers unchanged', async () => {
      const script = `
        fn(items: list) { $items } => $fn
        $fn(list[1, 2, 3])
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('AC-12: bare list annotation accepts list of strings unchanged', async () => {
      const script = `
        fn(items: list) { $items } => $fn
        $fn(list["a", "b"])
      `;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('AC-24: bare list pipe annotation accepts any list element type', async () => {
      expect(await run('list[1, 2] -> fn(list) { $ }')).toEqual([1, 2]);
    });
  });

  describe('Parameterized Type: Dynamic type variable (AC-8, AC-20)', () => {
    it('AC-8: dynamic list(string) type variable used as param annotation accepts matching list', async () => {
      const script = `
        list(string) => $t
        fn($t) { $ } => $fn
        $fn(list["a"])
      `;
      expect(await run(script)).toEqual(['a']);
    });

    it('AC-20: dynamic list(string) type variable rejects list of numbers with RILL-R001', async () => {
      const script = `
        list(string) => $t
        fn($t) { $ } => $fn
        $fn(list[1])
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  describe('Parameterized Type: Nested list(list(string)) (AC-9, AC-21, AC-29)', () => {
    it('AC-9: closure with list(list(string)) param accepts nested list', async () => {
      const script = `
        fn(x: list(list(string))) { $x } => $fn
        $fn(list[list["a"], list["b"]])
      `;
      expect(await run(script)).toEqual([['a'], ['b']]);
    });

    it('AC-21: nested type error message contains list(list(string)) not just list', async () => {
      const script = `
        fn(x: list(list(string))) { $x } => $fn
        $fn(list[list[1], list[2]])
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error).message).toContain('list(list(string))');
    });

    it('AC-29: deeply nested list(list(dict(name: string))) validates at full depth', async () => {
      const script = `
        fn(x: list(list(dict(name: string)))) { $x } => $fn
        $fn(list[list[dict[name: "alice"]], list[dict[name: "bob"]]])
      `;
      expect(await run(script)).toEqual([
        [{ name: 'alice' }],
        [{ name: 'bob' }],
      ]);
    });
  });

  describe('Parameterized Type: Bare closure annotation unchanged (AC-27)', () => {
    it('AC-27: bare closure annotation continues to accept any closure', async () => {
      const script = `
        fn(callback: fn) { $callback() } => $apply
        $apply(fn() { 42 })
      `;
      expect(await run(script)).toBe(42);
    });
  });

  // ============================================================
  // Parameterized Type Annotations — Error Cases
  // (AC-13, AC-14, AC-15, EC-8)
  // ============================================================

  describe('Parameterized Type: Param type mismatch list(string) (AC-13, EC-8)', () => {
    it('AC-13: list(string) param rejects list of numbers with RILL-R001', async () => {
      const script = `
        fn(items: list(string)) { $items } => $fn
        $fn(list[1, 2])
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error & { errorId: string }).errorId).toBe('RILL-R001');
      expect((err as Error).message).toContain('list(string)');
    });
  });

  describe('Parameterized Type: Dict param type mismatch (AC-14)', () => {
    it('AC-14: dict(name: string, age: number) param rejects wrong field type with RILL-R001', async () => {
      const script = `
        fn(x: dict(name: string, age: number)) { $x } => $fn
        $fn(dict[name: "alice", age: "thirty"])
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error & { errorId: string }).errorId).toBe('RILL-R001');
      // dict fields are sorted alphabetically in formatStructure
      expect((err as Error).message).toContain(
        'dict(age: number, name: string)'
      );
    });
  });

  describe('Parameterized Type: Return type assertion mismatch (AC-15)', () => {
    it('AC-15: closure declared :list(string) that returns list[1, 2] halts #TYPE_MISMATCH', async () => {
      const script = `
        fn():list(string) { list[1, 2] } => $fn
        $fn()
      `;
      await expectHalt(() => run(script), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'list(string)',
      });
    });
  });
});
