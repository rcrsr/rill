/**
 * Rill Language Tests: Anonymous Typed Closure Parameters
 *
 * Tests for anonymous typed closure syntax: |type|{ body }
 * A closure with a single type keyword as parameter type-checks the pipe value.
 *
 * AC = Acceptance Criterion from anonymous-typed-closure spec.
 * EC = Error Contract from anonymous-typed-closure spec.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

import { run, createLogCollector } from '../helpers/runtime.js';

// Ordered and vector are special internal types not constructable via rill syntax.
// Provide them as host variables so |ordered| and |vector| can be exercised.
const ORDERED_VAL = {
  __rill_ordered: true,
  entries: [['a', 1]] as [string, unknown][],
};
const VECTOR_VAL = {
  __rill_vector: true,
  data: new Float32Array([1.0, 2.0]),
  model: 'test',
};

describe('Rill Language: Anonymous Typed Closure Parameters', () => {
  // ============================================================
  // Success Cases: Basic Typed Input
  // ============================================================

  describe('Basic Typed Input (AC-24, AC-25)', () => {
    it('AC-24: |number| closure doubles input', async () => {
      expect(await run('5 -> |number|{ $ * 2 }')).toBe(10);
    });

    it('AC-25: |string| closure upcases input via .upper method', async () => {
      expect(await run('"hello" -> |string|{ $ -> .upper }')).toBe('HELLO');
    });
  });

  // ============================================================
  // Equivalence with Bare Block (AC-26)
  // ============================================================

  describe('Bare Block Equivalence (AC-26)', () => {
    it('AC-26: bare block { $ * 2 } accepts number input', async () => {
      expect(await run('5 -> { $ * 2 }')).toBe(10);
    });

    it('AC-26: |any|{ $ * 2 }:any accepts number input', async () => {
      expect(await run('5 -> |any|{ $ * 2 }:any')).toBe(10);
    });

    it('AC-26: bare block and |any|:any form produce same result', async () => {
      const bareResult = await run('5 -> { $ * 2 }');
      const typedResult = await run('5 -> |any|{ $ * 2 }:any');
      expect(bareResult).toBe(typedResult);
    });
  });

  // ============================================================
  // Pipe Chain with Typed Closure (AC-30)
  // ============================================================

  describe('Pipe Chain (AC-30)', () => {
    it('AC-30: pipe chain through typed closure and log executes', async () => {
      const { logs, callbacks } = createLogCollector();
      const result = await run('"hello" -> |string|{ $ -> .upper } -> log', {
        callbacks,
      });
      expect(result).toBe('HELLO');
      expect(logs).toContain('HELLO');
    });

    it('AC-30: chained typed closures transform value in sequence', async () => {
      expect(await run('5 -> |number|{ $ * 2 } -> |number|{ $ + 1 }')).toBe(11);
    });
  });

  // ============================================================
  // Bool Keyword (AC-31)
  // ============================================================

  describe('Bool Keyword (AC-31)', () => {
    it('AC-31: |bool| closure passes through true', async () => {
      expect(await run('true -> |bool|{ $ }')).toBe(true);
    });

    it('AC-31: |bool| closure passes through false', async () => {
      expect(await run('false -> |bool|{ $ }')).toBe(false);
    });
  });

  // ============================================================
  // All 11 Type Keywords (AC-32)
  // ============================================================

  describe('All 11 Type Keywords Parse as Anonymous Typed Form (AC-32)', () => {
    it('|string| parses and accepts string input', async () => {
      expect(await run('"hi" -> |string|{ $ }')).toBe('hi');
    });

    it('|number| parses and accepts number input', async () => {
      expect(await run('42 -> |number|{ $ }')).toBe(42);
    });

    it('|bool| parses and accepts bool input', async () => {
      expect(await run('true -> |bool|{ $ }')).toBe(true);
    });

    it('|closure| parses and accepts closure input', async () => {
      // Body returns 42 to confirm the type-check passed and body executed
      expect(await run('{ $ } => $fn\n$fn -> |closure|{ 42 }')).toBe(42);
    });

    it('|list| parses and accepts list input', async () => {
      expect(await run('list[1, 2] -> |list|{ $ }')).toEqual([1, 2]);
    });

    it('|dict| parses and accepts dict input', async () => {
      expect(await run('dict[a: 1] -> |dict|{ $ }')).toEqual({ a: 1 });
    });

    it('|tuple| parses and accepts tuple input', async () => {
      // tuple[...] produces a RillTuple with typeName "tuple"
      expect(await run('tuple[1, 2] -> |tuple|{ 42 }')).toBe(42);
    });

    it('|ordered| parses and accepts ordered input', async () => {
      // ordered values are produced internally (e.g. dict.entries); provided via host variable
      expect(
        await run('$ordVal -> |ordered|{ 42 }', {
          variables: { ordVal: ORDERED_VAL },
        })
      ).toBe(42);
    });

    it('|vector| parses and accepts vector input', async () => {
      // vector values carry __rill_vector marker; provided via host variable
      expect(
        await run('$vecVal -> |vector|{ 42 }', {
          variables: { vecVal: VECTOR_VAL },
        })
      ).toBe(42);
    });

    it('|any| parses and accepts any type input', async () => {
      expect(await run('42 -> |any|{ $ }')).toBe(42);
      expect(await run('"hello" -> |any|{ $ }')).toBe('hello');
    });

    it('|type| parses and accepts type value input', async () => {
      const result = (await run('number -> |type|{ $ }')) as Record<
        string,
        unknown
      >;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('number');
    });
  });

  // ============================================================
  // Dynamic Type Reference (AC-45)
  // ============================================================

  describe('Dynamic Type Reference (AC-45)', () => {
    it('AC-45: |$myType| resolves type from variable and accepts matching input', async () => {
      const script = `
        string => $myType
        "hello" -> |$myType|{ $ }
      `;
      expect(await run(script)).toBe('hello');
    });

    it('AC-45: |$myType| rejects non-matching input with RILL-R001', async () => {
      const script = `
        number => $myType
        "hello" -> |$myType|{ $ }
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  // ============================================================
  // Nested Closures (AC-44)
  // ============================================================

  describe('Nested Closures (AC-44)', () => {
    it('AC-44: inner |number| closure rejects string from outer body', async () => {
      // Outer accepts string; inner |number| rejects it — inner type-checks independently
      const script = `"hello" -> |string|{ $ -> |number|{ $ * 2 } }`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('AC-44: outer |string| closure feeds .len (number) into inner |number| closure', async () => {
      const script = `"hello" -> |string|{ $.len -> |number|{ $ * 2 } }`;
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

  describe('Boundary: |any| Accepts All Types (AC-7, AC-40)', () => {
    it('AC-7: |any| accepts number', async () => {
      expect(await run('5 -> |any|{ $ * 2 }')).toBe(10);
    });

    it('AC-40: |any| accepts string', async () => {
      expect(await run('"hello" -> |any|{ $ }')).toBe('hello');
    });

    it('AC-40: |any| accepts bool', async () => {
      expect(await run('true -> |any|{ $ }')).toBe(true);
    });

    it('AC-40: |any| accepts list', async () => {
      expect(await run('list[1, 2] -> |any|{ $ }')).toEqual([1, 2]);
    });
  });

  describe('Boundary: Typed Input with Any Return (AC-8)', () => {
    it('AC-8: |number|:any checks input type but not output type', async () => {
      expect(await run('5 -> |number|{ $ * 2 }:any')).toBe(10);
    });

    it('AC-8: |number|:any rejects non-number input with RILL-R001', async () => {
      await expect(run('"hello" -> |number|{ $ }:any')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });
  });

  describe('Boundary: |type| Keyword Accepts Type Values (AC-41)', () => {
    it('AC-41: |type| accepts a type value (number)', async () => {
      const result = (await run('number -> |type|{ $ }')) as Record<
        string,
        unknown
      >;
      expect(result.__rill_type).toBe(true);
    });

    it('AC-41: |type| accepts a type value (string)', async () => {
      const result = (await run('string -> |type|{ $ }')) as Record<
        string,
        unknown
      >;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('string');
    });
  });

  describe('Boundary: Non-Keyword as Named Param (AC-43)', () => {
    it('AC-43: |x| where x is not a type keyword parses as named-param closure', async () => {
      const script = `
        |x|{ $x + 1 } => $fn
        $fn(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('AC-43: |foo| parses as named-param closure, not anonymous typed', async () => {
      const script = `
        |foo|{ $foo * 2 } => $fn
        $fn(7)
      `;
      expect(await run(script)).toBe(14);
    });
  });

  // ============================================================
  // Error Cases
  // ============================================================

  describe('Error: Input Type Mismatch (AC-1, AC-33, EC-4)', () => {
    it('AC-1/EC-4: |number| rejects string input with RILL-R001', async () => {
      await expect(run('"hello" -> |number|{ $ * 2 }')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });

    it('AC-39/EC-4: 5 -> |string| rejects number input with RILL-R001', async () => {
      await expect(run('5 -> |string|{ $ }')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });
  });

  describe('Error: Zero-Param Closure Body References Undefined $ (AC-2, AC-34, EC-6)', () => {
    it('AC-2/EC-6: ||{ $ } called directly throws RILL-R005 ($ not defined)', async () => {
      const script = `
        ||{ $ } => $fn
        $fn()
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R005');
    });
  });

  describe('Error: Named-Param Closure Body References Undefined $ (AC-3, AC-35, EC-6)', () => {
    it('AC-3/EC-6: |x: string|{ $ } body has $ undefined — throws RILL-R005', async () => {
      const script = `
        |x: string|{ $ } => $fn
        $fn("hello")
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R005');
    });
  });

  describe('Error: Type Keyword as Param Name Causes Parse Error (AC-4, AC-37, EC-2)', () => {
    it('AC-4/EC-2: |string: string| throws RILL-P003 parse error', () => {
      try {
        parse('|string: string|{ $string }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P003');
        expect(parseErr.message).toMatch(/reserved type keyword/i);
      }
    });

    it('AC-38/EC-2: |dict: dict| throws RILL-P003 parse error', () => {
      try {
        parse('|dict: dict|{ $ }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P003');
      }
    });
  });

  describe('Error: Return Type Violation (AC-5, AC-36, EC-5)', () => {
    it('AC-5/EC-5: |number|{ "hello" }:number throws RILL-R004 on return type mismatch', async () => {
      const script = `5 -> |number|{ "hello" }:number`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R004');
    });

    it('AC-36: |number|{ $ * 2 }:string throws RILL-R004 when body returns number', async () => {
      const script = `5 -> |number|{ $ * 2 }:string`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R004');
    });
  });

  describe('Error: Chained Type Mismatch (AC-9)', () => {
    it('AC-9: second typed closure in chain rejects number with RILL-R001', async () => {
      // First closure outputs number; second |string| closure rejects it
      const script = `5 -> |number|{ $ * 2 } -> |string|{ $ -> .upper }`;
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
        |items: list(string)| { $items } => $fn
        $fn(list["a"])
      `;
      expect(await run(script)).toEqual(['a']);
    });

    it('AC-1: closure with list(string) param passes through multi-element list', async () => {
      const script = `
        |items: list(string)| { $items } => $fn
        $fn(list["x", "y", "z"])
      `;
      expect(await run(script)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('Parameterized Type: Pipe-form list(string) annotation (AC-2)', () => {
    it('AC-2: list["a", "b"] piped through |list(string)| block returns list', async () => {
      const result = await run('list["a", "b"] -> |list(string)| { $ }');
      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('Parameterized Type: Return type list(string) annotation (AC-3)', () => {
    it('AC-3: closure with :list(string) return type returns ["a"] for string input', async () => {
      const script = `
        |string| { [$] } :list(string) => $fn
        $fn("a")
      `;
      expect(await run(script)).toEqual(['a']);
    });
  });

  describe('Parameterized Type: Bare list annotation unchanged (AC-12, AC-24)', () => {
    it('AC-12: |list| param accepts list of numbers unchanged', async () => {
      const script = `
        |items: list| { $items } => $fn
        $fn(list[1, 2, 3])
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('AC-12: bare list annotation accepts list of strings unchanged', async () => {
      const script = `
        |items: list| { $items } => $fn
        $fn(list["a", "b"])
      `;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('AC-24: bare list pipe annotation accepts any list element type', async () => {
      expect(await run('list[1, 2] -> |list| { $ }')).toEqual([1, 2]);
    });
  });

  describe('Parameterized Type: Dynamic type variable (AC-8, AC-20)', () => {
    it('AC-8: dynamic list(string) type variable used as param annotation accepts matching list', async () => {
      const script = `
        list(string) => $t
        |$t| { $ } => $fn
        $fn(list["a"])
      `;
      expect(await run(script)).toEqual(['a']);
    });

    it('AC-20: dynamic list(string) type variable rejects list of numbers with RILL-R001', async () => {
      const script = `
        list(string) => $t
        |$t| { $ } => $fn
        $fn(list[1])
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  describe('Parameterized Type: Nested list(list(string)) (AC-9, AC-21, AC-29)', () => {
    it('AC-9: closure with list(list(string)) param accepts nested list', async () => {
      const script = `
        |x: list(list(string))| { $x } => $fn
        $fn(list[list["a"], list["b"]])
      `;
      expect(await run(script)).toEqual([['a'], ['b']]);
    });

    it('AC-21: nested type error message contains list(list(string)) not just list', async () => {
      const script = `
        |x: list(list(string))| { $x } => $fn
        $fn(list[list[1], list[2]])
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error).message).toContain('list(list(string))');
    });

    it('AC-29: deeply nested list(list(dict(name: string))) validates at full depth', async () => {
      const script = `
        |x: list(list(dict(name: string)))| { $x } => $fn
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
        |fn: closure| { $fn() } => $apply
        $apply(|| 42)
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
        |items: list(string)| { $items } => $fn
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
        |x: dict(name: string, age: number)| { $x } => $fn
        $fn(dict[name: "alice", age: "thirty"])
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error & { errorId: string }).errorId).toBe('RILL-R001');
      // dict fields are sorted alphabetically in formatStructuralType
      expect((err as Error).message).toContain(
        'dict(age: number, name: string)'
      );
    });
  });

  describe('Parameterized Type: Return type assertion mismatch (AC-15)', () => {
    it('AC-15: closure declared :list(string) that returns list[1, 2] halts with RILL-R004', async () => {
      const script = `
        || { list[1, 2] } :list(string) => $fn
        $fn()
      `;
      const err = await run(script).catch((e: unknown) => e);
      expect((err as Error & { errorId: string }).errorId).toBe('RILL-R004');
      expect((err as Error).message).toContain('list(string)');
    });
  });
});
