/**
 * Rill Runtime Tests: Closure Semantics
 *
 * Tests for block-closure semantics (Phase 12.2).
 * Blocks in non-inline contexts produce closure values that can be invoked.
 * Inline pipe blocks remain eager.
 */

import { describe, expect, it } from 'vitest';

import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Runtime: Closure Semantics', () => {
  describe('Block Produces Closure Type', () => {
    it('AC-1: captured block has closure type', async () => {
      const script = `
        { "result" } => $a
        $a.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });
  });

  describe('Block-Closure Pipe Invocation', () => {
    it('AC-2: piping to block-closure invokes it', async () => {
      const script = `
        { $ + 1 } => $a
        5 -> $a
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Inline Pipe Block Unchanged', () => {
    it('AC-3: inline pipe block evaluates eagerly', async () => {
      const script = `5 -> { $ + 1 }`;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Dict Value Block-Closure', () => {
    it('AC-4: dict value block-closure invoked via pipe', async () => {
      const script = `
        dict[x: { $ + 1 }] => $d
        5 -> $d.x
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Dict Dispatch Block-Closure', () => {
    it('AC-5: dict dispatch invokes block-closure', async () => {
      const script = `"x" -> dict[x: { "{$} matched" }]`;
      expect(await run(script)).toBe('x matched');
    });
  });

  describe('Grouped Expression Still Eager', () => {
    it('AC-6: grouped expression evaluates eagerly', async () => {
      const script = `
        (1 + 2) => $a
        $a
      `;
      expect(await run(script)).toBe(3);
    });
  });

  describe('Direct Call Block-Closure', () => {
    it('AC-7: direct call syntax invokes block-closure', async () => {
      const script = `
        { $ + 1 } => $a
        $a(5)
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Mixed Dict Value Types', () => {
    it('AC-8: dict values have distinct types (closure, eager, literal)', async () => {
      // Mixed-type list ['closure', 10, 42] not allowed; verify each field separately
      const scriptA = `
        dict[a: { $ * 2 }, b: (5 + 5), c: 42] => $d
        $d.a.^type
      `;
      expect(((await run(scriptA)) as any).typeName).toBe('closure');
      const scriptB = `
        dict[a: { $ * 2 }, b: (5 + 5), c: 42] => $d
        $d.b
      `;
      expect(await run(scriptB)).toBe(10);
      const scriptC = `
        dict[a: { $ * 2 }, b: (5 + 5), c: 42] => $d
        $d.c
      `;
      expect(await run(scriptC)).toBe(42);
    });

    it('AC-8 variant: invoking closure produces correct result', async () => {
      const script = `
        dict[a: { $ * 2 }, b: (5 + 5), c: 42] => $d
        7 -> $d.a
      `;
      expect(await run(script)).toBe(14);
    });
  });

  describe('Block-Closure Edge Cases', () => {
    it('block-closure in list can be invoked', async () => {
      const script = `
        list[{ $ + 1 }, { $ * 2 }] => $fns
        10 -> $fns[0]
      `;
      expect(await run(script)).toBe(11);
    });

    it('nested block-closures work correctly', async () => {
      // Note: ||{ } creates zero-param outer closure that returns inner block-closure
      const script = `
        ||{ { $ + 1 } } => $outer
        $outer()(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure with multiple statements', async () => {
      const script = `
        { $ => $temp \n $temp * 2 } => $doubler
        5 -> $doubler
      `;
      expect(await run(script)).toBe(10);
    });

    it('block-closure captures variables late-bound', async () => {
      const script = `
        10 => $x
        { $ + $x } => $add
        20 => $x
        5 -> $add
      `;
      // Late binding: $x resolves to 20 at call time
      expect(await run(script)).toBe(25);
    });

    it('block-closure passed as argument', async () => {
      const script = `
        list[1, 2, 3] -> map { $ * 2 }
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });
  });

  describe('Distinction from Traditional Closures', () => {
    it('traditional closure with params uses |param| syntax', async () => {
      const script = `
        |x| { $x + 1 } => $add
        $add(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure receives pipe value as $', async () => {
      const script = `
        { $ + 1 } => $add
        5 -> $add
      `;
      expect(await run(script)).toBe(6);
    });

    it('traditional closure ignores pipe value', async () => {
      const script = `
        |x| { $x + 1 } => $add
        999 -> $add(5)
      `;
      // Explicit arg (5) used, pipe value (999) ignored
      expect(await run(script)).toBe(6);
    });

    it('explicit param closure does not inherit caller pipeValue', async () => {
      // Closure with explicit params should NOT see caller's $
      // Using $c param instead, showing explicit params work but $ doesn't leak
      await expect(
        run(`
        |a, b, c| { $c + $ } => $fn
        "caller-pipe-value" -> $fn(1, 2, 3)
      `)
      ).rejects.toThrow('Undefined variable: $');
    });
  });

  describe('Boundary Conditions', () => {
    it('AC-14: minimal block produces closure', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        { "" } => $a
        $a.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });

    it('AC-14 variant: minimal block-closure returns empty string when invoked', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        { "" } => $a
        5 -> $a
      `;
      expect(await run(script)).toBe('');
    });

    it('AC-15: nested blocks', async () => {
      // Fixed: Originally piped "outer" -> $a, but unified dispatch would
      // try to find key "outer" in dict, throwing RUNTIME_PROPERTY_NOT_FOUND.
      // Test intent is to verify dict contains block-closure, not test dispatch.
      // Using runWithContext to capture $a as a raw RillValue (dict with closure),
      // since toNative() rejects dicts that contain closure values.
      const { context } = await runWithContext(`
        dict[y: { "inner" }] => $a
        true
      `);
      const a = context.variables.get('a');
      expect(a).toHaveProperty('y');
      expect(
        ((await run('$result.y.^type', { variables: { result: a } })) as any)
          .typeName
      ).toBe('closure');
    });

    it('AC-16: block-closure in list', async () => {
      // Verify each element is closure type via host typeName property
      const t0 = (await run(
        'list[{ $ + 1 }, { $ + 2 }] => $list\n$list[0].^type'
      )) as any;
      const t1 = (await run(
        'list[{ $ + 1 }, { $ + 2 }] => $list\n$list[1].^type'
      )) as any;
      expect(t0.typeName).toBe('closure');
      expect(t1.typeName).toBe('closure');
    });

    it('AC-16 variant: verify both closures execute correctly', async () => {
      const script = `
        list[{ $ + 1 }, { $ + 2 }] => $list
        list[5 -> $list[0], 5 -> $list[1]]
      `;
      expect(await run(script)).toEqual([6, 7]);
    });

    it('AC-17: dict with all value types', async () => {
      // Note: ||{ 42 } is property-style (isProperty: true), auto-invokes on access
      // Verify each field type via host typeName property (mixed-type list not allowed)
      const dict = `dict[a: { $ }, b: (1), c: "s", d: ||{ 42 }] => $d\n`;
      expect(((await run(dict + '$d.a.^type')) as any).typeName).toBe(
        'closure'
      );
      expect(((await run(dict + '$d.b.^type')) as any).typeName).toBe('number');
      expect(((await run(dict + '$d.c.^type')) as any).typeName).toBe('string');
      expect(((await run(dict + '$d.d.^type')) as any).typeName).toBe('number');
    });

    it('AC-17 variant: verify closure values execute correctly', async () => {
      // Mixed-type list [10, 1, 's', 42] not allowed; verify each value separately
      const scriptA = `dict[a: { $ }, b: (1), c: "s", d: ||{ 42 }] => $d\n10 -> $d.a`;
      expect(await run(scriptA)).toBe(10);
      const scriptB = `dict[a: { $ }, b: (1), c: "s", d: ||{ 42 }] => $d\n$d.b`;
      expect(await run(scriptB)).toBe(1);
      const scriptC = `dict[a: { $ }, b: (1), c: "s", d: ||{ 42 }] => $d\n$d.c`;
      expect(await run(scriptC)).toBe('s');
      const scriptD = `dict[a: { $ }, b: (1), c: "s", d: ||{ 42 }] => $d\n$d.d`;
      expect(await run(scriptD)).toBe(42);
    });

    it('AC-18: chained pipe through block-closure', async () => {
      const script = `5 -> { $ + 1 } -> { $ * 2 }`;
      expect(await run(script)).toBe(12);
    });
  });

  describe('Error Cases', () => {
    it('AC-9: missing implicit $ parameter throws RUNTIME_TYPE_ERROR', async () => {
      // Block-closure expects implicit $ argument when called directly
      try {
        await run(`
          { $ + 1 } => $a
          $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Missing argument for parameter '\$'/)
        );
      }
    });

    it('AC-10: excess arguments to block-closure throws RUNTIME_TYPE_ERROR', async () => {
      // Block-closure accepts only 1 implicit $ argument
      try {
        await run(`
          { $ + 1 } => $a
          $a(1, 2)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/expects 1 arguments, got 2/)
        );
      }
    });

    it('AC-11: arguments to zero-param closure throws RUNTIME_TYPE_ERROR', async () => {
      // Zero-param closure ||{} should not accept arguments
      try {
        await run(`
          ||{ 42 } => $a
          $a(5)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/expects 0 arguments, got 1/)
        );
      }
    });

    it('AC-12: missing argument to explicit param closure throws RUNTIME_TYPE_ERROR', async () => {
      // Explicit parameter closure requires argument
      try {
        await run(`
          |x|{ $x + 1 } => $a
          $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Missing argument/)
        );
      }
    });

    it('AC-13: missing implicit $ in dict method call throws RUNTIME_TYPE_ERROR', async () => {
      // Dict value block-closure also requires implicit $ when called directly
      try {
        await run(`
          dict[x: { $ + 1 }] => $d
          $d.x()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Missing argument for parameter '\$'/)
        );
      }
    });

    it('EC-3: undefined variable in closure body throws RUNTIME_UNDEFINED_VARIABLE', async () => {
      // Closure body references undefined variable at call time
      try {
        await run(`
          { $ + $undefined } => $a
          5 -> $a
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R005');
      }
    });

    it('EC-4: type error in closure body throws RUNTIME_TYPE_ERROR', async () => {
      // Closure body contains type error (string + number)
      // Use explicit parameter to avoid undefined $ issue
      try {
        await run(`
          |x|{ $x + "text" } => $a
          5 -> $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
      }
    });

    it('EC-5: reserved method name "keys" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'keys' as dict key
      try {
        await run('dict[keys: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'keys'/)
        );
      }
    });

    it('EC-5: reserved method name "values" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'values' as dict key
      try {
        await run('dict[values: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'values'/)
        );
      }
    });

    it('EC-5: reserved method name "entries" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'entries' as dict key
      try {
        await run('dict[entries: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'entries'/)
        );
      }
    });

    it('EC-10: undefined variable in dict dispatch closure body throws RUNTIME_UNDEFINED_VARIABLE', async () => {
      // Dict dispatch closure body references undefined variable - error propagated
      try {
        await run('"x" -> dict[x: { $undefined }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R005');
      }
    });

    it('EC-10: type error in dict dispatch closure body throws RUNTIME_TYPE_ERROR', async () => {
      // Dict dispatch closure body contains type error (number + string) - error propagated
      try {
        await run('"x" -> dict[x: { 5 + "text" }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
      }
    });

    it('AC-17: typed-param empty closure body raises RILL-R043 on invocation (not RILL-R005)', async () => {
      // |x: number| { } has no producing statements — invocation raises RILL-R043
      await expect(
        run('|x: number| { } => $fn\n5 -> $fn()')
      ).rejects.toHaveProperty('errorId', 'RILL-R043');
    });
  });

  describe('AC-12: Closure Param Dynamic Type Resolution via $t', () => {
    it('AC-12 success: $t bound to string — closure accepts string argument', async () => {
      const script = `
        string => $t
        |val: $t| { $val } => $f
        $f("hello")
      `;
      expect(await run(script)).toBe('hello');
    });

    it('AC-12 rejection: $t bound to number — closure rejects string argument', async () => {
      const script = `
        number => $t
        |val: $t| { $val } => $f
        $f("hello")
      `;
      await expect(run(script)).rejects.toThrow(
        'Parameter type mismatch: val expects number, got string'
      );
    });

    it('AC-12 creation-time capture: $t reassigned after closure creation — closure uses type from creation time', async () => {
      // Closure was created when $t held string; later reassigning $t to number
      // must not change the closure's captured parameter type.
      const script = `
        string => $t
        |val: $t| { $val } => $f
        number => $t
        $f("hello")
      `;
      expect(await run(script)).toBe('hello');
    });
  });

  describe('Zero-Parameter Closures in Loop Context', () => {
    it('zero-param closure called with empty parens in loop body succeeds', async () => {
      // Regression test: zero-param closure $c() with explicit empty parens
      // should not receive pipe value (accumulator) in loop body
      const script = `
        || {
          "a"
        } => $c

        0 -> @ {
          $c()
          $ + 1
        } ? ($ != 5)
      `;
      expect(await run(script)).toBe(5);
    });

    it('one-param closure with explicit empty parens receives pipe value', async () => {
      // Regression guard: one-param closure called with empty parens
      // should still receive pipe value (accumulator) in loop body
      const script = `
        { $ + 10 } => $fn

        0 -> @ {
          $fn()
        } ? ($ < 15)
      `;
      // Loop: 0 -> $fn() receives 0, returns 10 -> check (10 < 15 is true) -> continue
      //       10 -> $fn() receives 10, returns 20 -> check (20 < 15 is false) -> exits
      expect(await run(script)).toBe(20);
    });

    it('zero-param closure in while-loop with explicit call', async () => {
      // Zero-param closure called explicitly should not receive loop accumulator
      const script = `
        || { 100 } => $constant

        0 -> ($ < 3) @ {
          $constant()
          $ + 1
        }
      `;
      expect(await run(script)).toBe(3);
    });

    it('zero-param closure in do-while with mixed expressions', async () => {
      // Complex case: zero-param closure alongside accumulator operations
      const script = `
        || { 0 } => $reset

        5 -> @ {
          $ => $prev
          $reset()
          $prev - 1
        } ? ($ > 0)
      `;
      // Loop: 5 -> prev=5, reset()=0, prev-1=4
      //       4 -> prev=4, reset()=0, prev-1=3
      //       3 -> prev=3, reset()=0, prev-1=2
      //       2 -> prev=2, reset()=0, prev-1=1
      //       1 -> prev=1, reset()=0, prev-1=0
      //       0 -> condition (0 > 0) is false, exits
      expect(await run(script)).toBe(0);
    });
  });

  // ============================================================
  // Return Type Assertions
  // ============================================================

  describe('Closure Return Type Assertions', () => {
    it('return type :number passes when closure returns number', async () => {
      expect(await run('|x: number| { $x * 2 }:number => $fn\n$fn(5)')).toBe(
        10
      );
    });

    it('return type :string passes when closure returns string', async () => {
      expect(await run('|x: number| { "{$x}" }:string => $fn\n$fn(42)')).toBe(
        '42'
      );
    });

    it('return type :number halts with RILL-R004 on mismatch', async () => {
      try {
        await run('|x: number| { "{$x}" }:number => $fn\n$fn(5)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R004');
      }
    });

    it('^output reflects declared return type', async () => {
      // .^output returns a type value; access typeName via host API
      const result = (await run(
        '|x: number| { $x }:number => $fn\n$fn.^output'
      )) as any;
      expect(result.typeName).toBe('number');
    });

    it('^output defaults to any when no return type declared', async () => {
      const result = (await run(
        '|x: number| { $x } => $fn\n$fn.^output'
      )) as any;
      expect(result.typeName).toBe('any');
    });

    it('^type includes return type when declared', async () => {
      // Closure with :number matches sig literal with :number
      expect(
        await run(`
          |x: number| { $x }:number => $fn
          (|x: number| :number) => $sig
          $fn.^type == $sig
        `)
      ).toBe(true);
    });

    it('^type shows any for return type when not declared', async () => {
      // Without :type, return defaults to any — differs from explicit :number
      expect(
        await run(`
          |x: number| { $x } => $fn
          (|x: number| :number) => $sig
          $fn.^type == $sig
        `)
      ).toBe(false);
    });
  });

  // ============================================================
  // Closure Sig Literals
  // ============================================================

  describe('Closure Sig Literals', () => {
    it('parses |x: number| :string as a type value', async () => {
      // Closure sig literal is a type value; typeName accessible via host API
      const result = (await run('(|x: number| :string) => $t\n$t')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('closure');
    });

    it('sig literal equality: same signature', async () => {
      expect(await run('(|x: number| :string) == (|x: number| :string)')).toBe(
        true
      );
    });

    it('sig literal inequality: different return type', async () => {
      expect(await run('(|x: number| :number) == (|x: number| :string)')).toBe(
        false
      );
    });

    it('sig literal inequality: different param name', async () => {
      expect(await run('(|x: number| :string) == (|y: number| :string)')).toBe(
        false
      );
    });

    it('sig literal matches ^type of closure with return annotation', async () => {
      expect(
        await run(`
          |x: number| { $x }:number => $fn
          (|x: number| :number) => $sig
          $fn.^type == $sig
        `)
      ).toBe(true);
    });
  });
});
