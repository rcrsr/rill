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
});
