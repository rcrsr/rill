/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Closure Semantics
 *
 * Tests for block-closure semantics (Phase 12.2).
 * Blocks in non-inline contexts produce closure values that can be invoked.
 * Inline pipe blocks remain eager.
 */

import { describe, expect, it } from 'vitest';

import { run, runWithContext } from '../helpers/runtime.js';
import { expectHalt, expectRuntimeError } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

describe('Rill Runtime: Closure Semantics', () => {
  describe('Block Produces Closure Type', () => {
    it('AC-1: captured block has closure type', async () => {
      const script = `
        fn { "result" } => $a
        $a.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('fn');
    });
  });

  describe('Block-Closure Pipe Invocation', () => {
    it('AC-2: piping to block-closure invokes it', async () => {
      const script = `
        fn { $ + 1 } => $a
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
        fn { $ + 1 } => $a
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
        $d.^type.signature
      `;
      // code-block.non-selecting: .^type sees a held entry as fn()
      expect(await run(scriptA)).toBe(
        'dict(a: fn():any, b: number, c: number)'
      );
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
      // Note: fn() { } creates zero-param outer closure that returns inner block-closure
      const script = `
        fn() { fn { $ + 1 } } => $outer
        $outer()(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure with multiple statements', async () => {
      const script = `
        fn { $ => $temp \n $temp * 2 } => $doubler
        5 -> $doubler
      `;
      expect(await run(script)).toBe(10);
    });

    it('block-closure captures variables late-bound', async () => {
      const script = `
        10 => $x
        fn { $ + $x } => $add
        20 => $x
        5 -> $add
      `;
      // Late binding: $x resolves to 20 at call time
      expect(await run(script)).toBe(25);
    });

    it('block-closure passed as argument', async () => {
      const script = `
        list[1, 2, 3] -> fan({ $ * 2 })
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });
  });

  describe('Distinction from Traditional Closures', () => {
    it('traditional closure with params uses fn(param) syntax', async () => {
      const script = `
        fn(x) { $x + 1 } => $add
        $add(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure receives pipe value as $', async () => {
      const script = `
        fn { $ + 1 } => $add
        5 -> $add
      `;
      expect(await run(script)).toBe(6);
    });

    it('traditional closure receives the piped value as its first argument', async () => {
      const script = `
        fn(x, y) { $x + $y } => $add
        999 -> $add(5)
      `;
      expect(await run(script)).toBe(1004);
    });

    it('rejects a named-param closure that reads $', async () => {
      // A closure with named params binds no $, so reading one is rejected
      // where the function is written.
      await expect(
        run(`
        fn(a, b, c) { $c + $ } => $fn
        "caller-pipe-value" -> $fn(2, 3)
      `)
      ).rejects.toHaveProperty('errorId', 'RILL-P029');
    });
  });

  describe('Boundary Conditions', () => {
    it('AC-14: minimal block produces closure', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        fn { "" } => $a
        $a.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('fn');
    });

    it('AC-14 variant: minimal block-closure returns empty string when invoked', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        fn { "" } => $a
        $a()
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
      // code-block.non-selecting: .^type sees a held entry as fn()
      expect(
        await run('$result.^type.signature', { variables: { result: a! } })
      ).toBe('dict(y: fn():any)');
    });

    it('AC-16: block-closure in list', async () => {
      // code-block.non-selecting: .^type sees each held element as fn()
      expect(
        await run('list[{ $ + 1 }, { $ + 2 }] => $list\n$list.^type.signature')
      ).toBe('list(fn():any)');
    });

    it('AC-16 variant: verify both closures execute correctly', async () => {
      const script = `
        list[{ $ + 1 }, { $ + 2 }] => $list
        list[5 -> $list[0], 5 -> $list[1]]
      `;
      expect(await run(script)).toEqual([6, 7]);
    });

    it('AC-17: dict with all value types', async () => {
      // dispatch.fn: a no-parens read returns a stored fn uncalled
      // code-block.non-selecting: .^type sees the held entry as fn()
      const dict = `dict[a: { $ }, b: (1), c: "s", d: fn() { 42 }] => $d\n`;
      expect(await run(dict + '$d.^type.signature')).toBe(
        'dict(a: fn():any, b: number, c: string, d: fn():any)'
      );
      expect(((await run(dict + '$d.b.^type')) as any).typeName).toBe('number');
      expect(((await run(dict + '$d.c.^type')) as any).typeName).toBe('string');
      expect(((await run(dict + '$d.d.^type')) as any).typeName).toBe('fn');
    });

    it('AC-17 variant: verify closure values execute correctly', async () => {
      // Mixed-type list [10, 1, 's', 42] not allowed; verify each value separately
      const scriptA = `dict[a: { $ }, b: (1), c: "s", d: fn() { 42 }] => $d\n10 -> $d.a`;
      expect(await run(scriptA)).toBe(10);
      const scriptB = `dict[a: { $ }, b: (1), c: "s", d: fn() { 42 }] => $d\n$d.b`;
      expect(await run(scriptB)).toBe(1);
      const scriptC = `dict[a: { $ }, b: (1), c: "s", d: fn() { 42 }] => $d\n$d.c`;
      expect(await run(scriptC)).toBe('s');
      // dispatch.fn: parens select then call the stored fn
      const scriptD = `dict[a: { $ }, b: (1), c: "s", d: fn() { 42 }] => $d\n$d.d()`;
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
      await expectRuntimeError(
        () =>
          run(`
          fn { $ + 1 } => $a
          $a()
        `),
        {
          code: 'RILL-R044',
          messagePattern: /Missing argument for parameter '\$'/,
        }
      );
    });

    rule('invocation.excess').it(
      'AC-10: excess arguments to block-closure throws RUNTIME_TYPE_ERROR',
      async () => {
        // Block-closure accepts only 1 implicit $ argument
        await expectRuntimeError(
          () =>
            run(`
          fn { $ + 1 } => $a
          $a(1, 2)
        `),
          {
            code: 'RILL-R045',
            messagePattern: /expects 1 argument, got 2/,
          }
        );
      }
    );

    rule('invocation.excess').it(
      'AC-11: arguments to zero-param closure throws RUNTIME_TYPE_ERROR',
      async () => {
        // Zero-param closure fn() {} should not accept arguments
        await expectRuntimeError(
          () =>
            run(`
          fn() { 42 } => $a
          $a(5)
        `),
          {
            code: 'RILL-R045',
            messagePattern: /expects 0 arguments, got 1/,
          }
        );
      }
    );

    it('AC-12: missing argument to explicit param closure throws RUNTIME_TYPE_ERROR', async () => {
      // Explicit parameter closure requires argument
      await expectRuntimeError(
        () =>
          run(`
          fn(x) { $x + 1 } => $a
          $a()
        `),
        {
          code: 'RILL-R044',
          messagePattern: /Missing argument/,
        }
      );
    });

    it('AC-13: missing implicit $ in dict method call throws RUNTIME_TYPE_ERROR', async () => {
      // code-block.access / code-block.unbound: selecting the held block runs it
      // with the enclosing $, which is unbound here
      await expectHalt(
        () =>
          run(`
          dict[x: { $ + 1 }] => $d
          $d.x()
        `),
        {
          code: 'RILL_R005',
          hostErrorId: 'RILL-R005',
          messagePattern: /Undefined variable: \$/,
        }
      );
    });

    // A call with no arguments neither reads nor receives `$`. A dict-member
    // empty-paren call (`$app.flag()`) outside a pipe-target position gets
    // exactly the arguments written, so a member that declares a required
    // parameter halts with a missing-argument error even when a pipe value
    // is in scope, and a member with a default or no parameters runs with
    // its own defaults. Only a call written as the pipe target
    // (`5 -> $app.flag()`) receives the piped value.

    // A stored fn is selected uncalled and then called by the parens (dispatch.fn).
    it('AC-20: dict-member empty-paren call in ternary then-branch receives no pipe value', async () => {
      const script = `
        dict[flag: fn(x) { $x + 1 }] => $app
        5 -> (true) ? $app.flag() ! 0
      `;
      await expectRuntimeError(() => run(script), {
        code: 'RILL-R044',
        messagePattern: /Missing argument for parameter/,
      });
    });

    // A stored fn is selected uncalled and then called by the parens (dispatch.fn).
    it('AC-21: dict-member empty-paren call in bare ternary else-branch receives no pipe value', async () => {
      const script = `
        dict[flag: fn(x) { $x + 1 }] => $app
        5 -> (false) ? 0 ! $app.flag()
      `;
      await expectRuntimeError(() => run(script), {
        code: 'RILL-R044',
        messagePattern: /Missing argument for parameter/,
      });
    });

    it('AC-23: zero-param dict member is not injected with the pipe value', async () => {
      const script = `
        dict[f: fn() { 42 }] => $d
        5 -> (true) ? $d.f() ! 0
      `;
      expect(await run(script)).toBe(42);
    });

    it('AC-24: dict-member call with explicit args binds args, not the pipe value', async () => {
      // args.length === 0 guards existing explicit arguments from being
      // displaced. Fails (binds 5 instead of 1) if that guard is loosened.
      const script = `
        dict[g: fn(a) { $a + 1 }] => $d
        5 -> { $
$d.g(1) }
      `;
      expect(await run(script)).toBe(2);
    });

    it('AC-25: bare dict-member reference (no parens) stays an unapplied callable in pipe context', async () => {
      // Dispatch-table contract from the issue: `$app.flag` without parens
      // is a plain dict lookup, never auto-invoked, even with a pipe value
      // in scope. Capture it, confirm it is still a function, then invoke it
      // explicitly later. A stored fn is returned uncalled (dispatch.fn).
      const typeScript = `
        dict[flag: fn(x) { $x + 1 }] => $app
        5 -> { $
$app.flag } => $captured
        $captured.^type
      `;
      const typeResult = (await run(typeScript)) as any;
      expect(typeResult.typeName).toBe('fn');

      const invokeScript = `
        dict[flag: fn(x) { $x + 1 }] => $app
        5 -> { $
$app.flag } => $captured
        10 -> $captured
      `;
      expect(await run(invokeScript)).toBe(11);
    });

    it('AC-26: dict member with an all-optional param uses its default on an empty-paren call', async () => {
      const script = `
        dict[h: fn(a: number = 99) { $a }] => $d
        5 -> (true) ? $d.h() ! 0
      `;
      expect(await run(script)).toBe(99);
    });

    // The next 3 cases guard against expanding the rcrsr/rill#131 fix beyond
    // its intended scope: the pipe-value injection in evaluateMethod's
    // isDict(receiver) branch is gated on MethodCallNode.hasParens, which is
    // only true when the source wrote explicit parens. A bare `.field`
    // reached via the postfix/pipe-target path (parseMethodCall via
    // isMethodCall in parser-expr.ts, and parsePipeTargetDot) produces the
    // same `args: []` as an explicit `.field()` call, so hasParens is the
    // only signal that distinguishes them. If a future change drops that
    // gate, all 3 cases below silently receive the piped value instead of
    // throwing "Missing argument for parameter 'x'".

    it('AC-27: bare .field on a pipe target returns the fn uncalled', async () => {
      // A no-parens read never calls a stored fn (dispatch.fn).
      expect(await run(`dict[flag: fn(x) { $x }] -> .flag`)).toMatchObject({
        __type: 'callable',
      });
    });

    it('AC-28: bare .field on a grouped expression returns the fn uncalled', async () => {
      // A no-parens read never calls a stored fn (dispatch.fn).
      expect(await run(`(dict[flag: fn(x) { $x }]).flag`)).toMatchObject({
        __type: 'callable',
      });
    });

    it('AC-29: bare .field directly on a dict literal returns the fn uncalled', async () => {
      // A no-parens read never calls a stored fn (dispatch.fn).
      expect(await run(`dict[flag: fn(x) { $x }].flag`)).toMatchObject({
        __type: 'callable',
      });
    });

    it('spreading an empty tuple into a one-untyped-param closure reports the missing parameter, not an undefined variable', async () => {
      try {
        await run(`
          fn(x) { $x } => $f
          tuple[] -> $f(...)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Missing argument for parameter 'x'/)
        );
      }
    });

    it('spreading an empty dict into a one-untyped-param closure reports the missing parameter, not an undefined variable', async () => {
      try {
        await run(`
          fn(x) { $x } => $f
          dict[] -> $f(...)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Missing argument for parameter 'x'/)
        );
      }
    });

    it('EC-3: undefined variable in closure body throws RUNTIME_UNDEFINED_VARIABLE', async () => {
      // Closure body references undefined variable at call time
      try {
        await run(`
          fn { $ + $undefined } => $a
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
      await expectHalt(
        () =>
          run(`
          fn(x) { $x + "text" } => $a
          5 -> $a()
        `),
        {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: /Arithmetic requires number, got string/,
        }
      );
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
      await expectHalt(() => run('"x" -> dict[x: { 5 + "text" }]'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /Arithmetic requires number, got string/,
      });
    });

    it('AC-17: typed-param empty closure body raises RILL-R043 on invocation (not RILL-R005)', async () => {
      // fn(x: number) { } has no producing statements — invocation raises RILL-R043
      await expect(
        run('fn(x: number) { } => $fn\n5 -> $fn()')
      ).rejects.toHaveProperty('errorId', 'RILL-R043');
    });
  });

  describe('AC-12: Closure Param Dynamic Type Resolution via $t', () => {
    it('AC-12 success: $t bound to string — closure accepts string argument', async () => {
      const script = `
        string => $t
        fn(val: $t) { $val } => $f
        $f("hello")
      `;
      expect(await run(script)).toBe('hello');
    });

    it('AC-12 rejection: $t bound to number — closure rejects string argument', async () => {
      const script = `
        number => $t
        fn(val: $t) { $val } => $f
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
        fn(val: $t) { $val } => $f
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
        fn() {
          "a"
        } => $c

        0 -> do {
          $c()
          $ + 1
        } while ($ != 5)
      `;
      expect(await run(script)).toBe(5);
    });

    it('one-param closure with explicit empty parens receives no pipe value', async () => {
      // A call with no arguments neither reads nor receives the accumulator.
      const script = `
        fn { $ + 10 } => $fn

        0 -> do {
          $fn()
        } while ($ < 15)
      `;
      await expectRuntimeError(() => run(script), {
        code: 'RILL-R044',
        messagePattern: /Missing argument for parameter/,
      });
    });

    it('zero-param closure in while-loop with explicit call', async () => {
      // Zero-param closure called explicitly should not receive loop accumulator
      const script = `
        fn() { 100 } => $constant

        0 -> while ($ < 3) do {
          $constant()
          $ + 1
        }
      `;
      expect(await run(script)).toBe(3);
    });

    it('zero-param closure in do-while with mixed expressions', async () => {
      // Complex case: zero-param closure alongside accumulator operations
      const script = `
        fn() { 0 } => $reset

        5 -> do {
          $ => $prev
          $reset()
          $prev - 1
        } while ($ > 0)
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
  // Closure Type Inference Cascade
  // ============================================================

  describe('Closure Type Inference Cascade', () => {
    it('AC-6: list[{$ + 1}, {$ + 2}] infers structural closure match (same shape)', async () => {
      // code-block.non-selecting: held list elements are typed fn()
      const result = await run('list[{$ + 1}, {$ + 2}].^type.signature');
      expect(result).toBe('list(fn():any)');
    });

    it('AC-7: list[fn(a: number, b: string)($a), fn(a: number, b: string)($b)] infers structural closure match', async () => {
      // Typed closures with identical params -> structural match preserves full sig
      const result = await run(
        'list[fn(a: number, b: string) { $a }, fn(a: number, b: string) { $b }].^type.signature'
      );
      expect(result).toBe('list(fn(a: number, b: string):any)');
    });

    it('AC-17: list[fn(x)($x), fn(a, b)($a)] infers a union of both closure types (arity differs)', async () => {
      // Different param counts -> distinct union members
      const result = await run(
        'list[fn(x) { $x }, fn(a, b) { $a }].^type.signature'
      );
      expect(result).toMatch(/^list\(union\(/);
      expect(result).toContain('fn(x: any):any');
      expect(result).toContain('fn(a: any, b: any):any');
    });

    it('AC-18: list[fn(x: number)($x + 1), fn(y: number)($y + 1)] infers a union of both closure types (param names differ)', async () => {
      // Same types but different param names -> distinct union members
      const result = await run(
        'list[fn(x: number) { $x + 1 }, fn(y: number) { $y + 1 }].^type.signature'
      );
      expect(result).toMatch(/^list\(union\(/);
      expect(result).toContain('fn(x: number):any');
      expect(result).toContain('fn(y: number):any');
    });

    it('AC-19: list[fn(x: number)($x), fn(x: string)($x)] infers a union of both closure types (param types differ)', async () => {
      // Same param name but different types -> distinct union members
      const result = await run(
        'list[fn(x: number) { $x }, fn(x: string) { $x }].^type.signature'
      );
      expect(result).toMatch(/^list\(union\(/);
      expect(result).toContain('fn(x: number):any');
      expect(result).toContain('fn(x: string):any');
    });
  });

  // ============================================================
  // Return Type Assertions
  // ============================================================

  describe('Closure Return Type Assertions', () => {
    it('return type :number passes when closure returns number', async () => {
      expect(await run('fn(x: number):number { $x * 2 } => $fn\n$fn(5)')).toBe(
        10
      );
    });

    it('return type :string passes when closure returns string', async () => {
      expect(await run('fn(x: number):string { "{$x}" } => $fn\n$fn(42)')).toBe(
        '42'
      );
    });

    it('return type :number halts with #TYPE_MISMATCH on mismatch', async () => {
      await expectHalt(
        () => run('fn(x: number):number { "{$x}" } => $fn\n$fn(5)'),
        { code: 'TYPE_MISMATCH' }
      );
    });

    it('.^type.outer reflects declared return type', async () => {
      // .^type.outer returns a type value; access typeName via host API
      const result = (await run(
        'fn(x: number):number { $x } => $fn\n$fn.^type.outer'
      )) as any;
      expect(result.typeName).toBe('number');
    });

    it('.^type.outer defaults to any when no return type declared', async () => {
      const result = (await run(
        'fn(x: number) { $x } => $fn\n$fn.^type.outer'
      )) as any;
      expect(result.typeName).toBe('any');
    });

    it('^type includes return type when declared', async () => {
      // Closure with :number matches sig literal with :number
      expect(
        await run(`
          fn(x: number):number { $x } => $fn
          (fn(x: number):number) => $sig
          $fn.^type == $sig
        `)
      ).toBe(true);
    });

    it('^type shows any for return type when not declared', async () => {
      // Without :type, return defaults to any — differs from explicit :number
      expect(
        await run(`
          fn(x: number) { $x } => $fn
          (fn(x: number):number) => $sig
          $fn.^type == $sig
        `)
      ).toBe(false);
    });
  });

  // ============================================================
  // Closure Sig Literals
  // ============================================================

  describe('Closure Sig Literals', () => {
    it('parses fn(x: number):string as a type value', async () => {
      // Closure sig literal is a type value; typeName accessible via host API
      const result = (await run('(fn(x: number):string) => $t\n$t')) as any;
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('fn');
    });

    it('sig literal equality: same signature', async () => {
      expect(
        await run('(fn(x: number):string) == (fn(x: number):string)')
      ).toBe(true);
    });

    it('sig literal inequality: different return type', async () => {
      expect(
        await run('(fn(x: number):number) == (fn(x: number):string)')
      ).toBe(false);
    });

    it('sig literal inequality: different param name', async () => {
      expect(
        await run('(fn(x: number):string) == (fn(y: number):string)')
      ).toBe(false);
    });
  });
});
