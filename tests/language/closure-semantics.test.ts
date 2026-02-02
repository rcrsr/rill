/**
 * Rill Runtime Tests: Closure Semantics
 *
 * Tests for block-closure semantics (Phase 12.2).
 * Blocks in non-inline contexts produce closure values that can be invoked.
 * Inline pipe blocks remain eager.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Closure Semantics', () => {
  describe('Block Produces Closure Type', () => {
    it('AC-1: captured block has closure type', async () => {
      const script = `
        { "result" } :> $a
        type($a)
      `;
      expect(await run(script)).toBe('closure');
    });
  });

  describe('Block-Closure Pipe Invocation', () => {
    it('AC-2: piping to block-closure invokes it', async () => {
      const script = `
        { $ + 1 } :> $a
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
        [x: { $ + 1 }] :> $d
        5 -> $d.x
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Dict Dispatch Block-Closure', () => {
    it('AC-5: dict dispatch invokes block-closure', async () => {
      const script = `"x" -> [x: { "{$} matched" }]`;
      expect(await run(script)).toBe('x matched');
    });
  });

  describe('Grouped Expression Still Eager', () => {
    it('AC-6: grouped expression evaluates eagerly', async () => {
      const script = `
        (1 + 2) :> $a
        $a
      `;
      expect(await run(script)).toBe(3);
    });
  });

  describe('Direct Call Block-Closure', () => {
    it('AC-7: direct call syntax invokes block-closure', async () => {
      const script = `
        { $ + 1 } :> $a
        $a(5)
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Mixed Dict Value Types', () => {
    it('AC-8: dict values have distinct types (closure, eager, literal)', async () => {
      const script = `
        [a: { $ * 2 }, b: (5 + 5), c: 42] :> $d
        [type($d.a), $d.b, $d.c]
      `;
      expect(await run(script)).toEqual(['closure', 10, 42]);
    });

    it('AC-8 variant: invoking closure produces correct result', async () => {
      const script = `
        [a: { $ * 2 }, b: (5 + 5), c: 42] :> $d
        7 -> $d.a
      `;
      expect(await run(script)).toBe(14);
    });
  });

  describe('Block-Closure Edge Cases', () => {
    it('block-closure in list can be invoked', async () => {
      const script = `
        [{ $ + 1 }, { $ * 2 }] :> $fns
        10 -> $fns[0]
      `;
      expect(await run(script)).toBe(11);
    });

    it('nested block-closures work correctly', async () => {
      // Note: ||{ } creates zero-param outer closure that returns inner block-closure
      const script = `
        ||{ { $ + 1 } } :> $outer
        $outer()(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure with multiple statements', async () => {
      const script = `
        { $ :> $temp \n $temp * 2 } :> $doubler
        5 -> $doubler
      `;
      expect(await run(script)).toBe(10);
    });

    it('block-closure captures variables late-bound', async () => {
      const script = `
        10 :> $x
        { $ + $x } :> $add
        20 :> $x
        5 -> $add
      `;
      // Late binding: $x resolves to 20 at call time
      expect(await run(script)).toBe(25);
    });

    it('block-closure passed as argument', async () => {
      const script = `
        [1, 2, 3] -> map { $ * 2 }
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });
  });

  describe('Distinction from Traditional Closures', () => {
    it('traditional closure with params uses |param| syntax', async () => {
      const script = `
        |x| { $x + 1 } :> $add
        $add(5)
      `;
      expect(await run(script)).toBe(6);
    });

    it('block-closure receives pipe value as $', async () => {
      const script = `
        { $ + 1 } :> $add
        5 -> $add
      `;
      expect(await run(script)).toBe(6);
    });

    it('traditional closure ignores pipe value', async () => {
      const script = `
        |x| { $x + 1 } :> $add
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
        |a, b, c| { $c + $ } :> $fn
        "caller-pipe-value" -> $fn(1, 2, 3)
      `)
      ).rejects.toThrow('Undefined variable: $');
    });
  });

  describe('Boundary Conditions', () => {
    it('AC-14: minimal block produces closure', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        { "" } :> $a
        type($a)
      `;
      expect(await run(script)).toBe('closure');
    });

    it('AC-14 variant: minimal block-closure returns empty string when invoked', async () => {
      // Note: Empty blocks { } are disallowed by parser. Use minimal block with empty string.
      const script = `
        { "" } :> $a
        5 -> $a
      `;
      expect(await run(script)).toBe('');
    });

    it('AC-15: nested blocks', async () => {
      // Fixed: Originally piped "outer" -> $a, but unified dispatch would
      // try to find key "outer" in dict, throwing RUNTIME_PROPERTY_NOT_FOUND.
      // Test intent is to verify dict contains block-closure, not test dispatch.
      const script = `
        [y: { "inner" }] :> $a
        $a
      `;
      const result = await run(script);
      expect(result).toHaveProperty('y');
      expect(await run('type($result.y)', { variables: { result } })).toBe(
        'closure'
      );
    });

    it('AC-16: block-closure in list', async () => {
      const script = `
        [{ $ + 1 }, { $ + 2 }] :> $list
        [type($list[0]), type($list[1])]
      `;
      expect(await run(script)).toEqual(['closure', 'closure']);
    });

    it('AC-16 variant: verify both closures execute correctly', async () => {
      const script = `
        [{ $ + 1 }, { $ + 2 }] :> $list
        [5 -> $list[0], 5 -> $list[1]]
      `;
      expect(await run(script)).toEqual([6, 7]);
    });

    it('AC-17: dict with all value types', async () => {
      // Note: ||{ 42 } is property-style (isProperty: true), auto-invokes on access
      const script = `
        [a: { $ }, b: (1), c: "s", d: ||{ 42 }] :> $d
        [type($d.a), type($d.b), type($d.c), type($d.d)]
      `;
      expect(await run(script)).toEqual([
        'closure', // block-closure: no auto-invoke
        'number', // eager evaluation
        'string', // literal
        'number', // property-style: auto-invokes, returns 42
      ]);
    });

    it('AC-17 variant: verify closure values execute correctly', async () => {
      // Note: ||{ 42 } auto-invokes on access, so $d.d returns 42 directly
      const script = `
        [a: { $ }, b: (1), c: "s", d: ||{ 42 }] :> $d
        [10 -> $d.a, $d.b, $d.c, $d.d]
      `;
      expect(await run(script)).toEqual([10, 1, 's', 42]);
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
          { $ + 1 } :> $a
          $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
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
          { $ + 1 } :> $a
          $a(1, 2)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
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
          ||{ 42 } :> $a
          $a(5)
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
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
          |x|{ $x + 1 } :> $a
          $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
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
          [x: { $ + 1 }] :> $d
          $d.x()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
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
          { $ + $undefined } :> $a
          5 -> $a
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_UNDEFINED_VARIABLE');
      }
    });

    it('EC-4: type error in closure body throws RUNTIME_TYPE_ERROR', async () => {
      // Closure body contains type error (string + number)
      // Use explicit parameter to avoid undefined $ issue
      try {
        await run(`
          |x|{ $x + "text" } :> $a
          5 -> $a()
        `);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
      }
    });

    it('EC-5: reserved method name "keys" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'keys' as dict key
      try {
        await run('[keys: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'keys'/)
        );
      }
    });

    it('EC-5: reserved method name "values" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'values' as dict key
      try {
        await run('[values: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'values'/)
        );
      }
    });

    it('EC-5: reserved method name "entries" as block-closure key throws RUNTIME_TYPE_ERROR', async () => {
      // Cannot use reserved method name 'entries' as dict key
      try {
        await run('[entries: { $ }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot use reserved method name 'entries'/)
        );
      }
    });

    it('EC-10: undefined variable in dict dispatch closure body throws RUNTIME_UNDEFINED_VARIABLE', async () => {
      // Dict dispatch closure body references undefined variable - error propagated
      try {
        await run('"x" -> [x: { $undefined }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_UNDEFINED_VARIABLE');
      }
    });

    it('EC-10: type error in dict dispatch closure body throws RUNTIME_TYPE_ERROR', async () => {
      // Dict dispatch closure body contains type error (number + string) - error propagated
      try {
        await run('"x" -> [x: { 5 + "text" }]');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RUNTIME_TYPE_ERROR');
      }
    });
  });
});
