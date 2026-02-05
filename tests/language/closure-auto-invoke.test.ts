/**
 * Rill Runtime Tests: Closure Auto-Invocation
 *
 * Tests for FR-RUNTIME-2: Closure auto-invocation in expression contexts.
 * Closures are auto-invoked when used in expression contexts (operators, conditionals)
 * and $ is bound.
 *
 * Coverage: AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Closure Auto-Invocation', () => {
  describe('Success Cases', () => {
    it('AC-28: auto-invokes closure in negation operator', async () => {
      // Setup: |x|($x > 0) => $pos
      // Expression: 5 -> (! $pos)
      // Expected: false (5 > 0 = true, then negated)
      const script = `
        |x|($x > 0) => $pos
        5 -> (! $pos)
      `;
      expect(await run(script)).toBe(false);
    });

    it('AC-29: auto-invokes zero-param closure in arithmetic', async () => {
      // Setup: || { $ + 1 } => $inc
      // Expression: 5 -> ($inc + 10)
      // Expected: 16 (5+1=6, then 6+10=16)
      const script = `
        || { $ + 1 } => $inc
        5 -> ($inc + 10)
      `;
      expect(await run(script)).toBe(16);
    });

    it('AC-30: auto-invokes closure in equality comparison', async () => {
      // Setup: |x| { $x } => $id
      // Expression: "test" -> ($id == "test")
      // Expected: true (identity returns "test", equals "test")
      const script = `
        |x| { $x } => $id
        "test" -> ($id == "test")
      `;
      expect(await run(script)).toBe(true);
    });

    it('auto-invokes closure in less-than comparison', async () => {
      const script = `
        |x|($x * 2) => $double
        5 -> ($double < 20)
      `;
      expect(await run(script)).toBe(true); // 5*2=10, 10<20=true
    });

    it('auto-invokes closure in greater-than comparison', async () => {
      const script = `
        |x|($x - 3) => $sub
        10 -> ($sub > 5)
      `;
      expect(await run(script)).toBe(true); // 10-3=7, 7>5=true
    });

    it('auto-invokes closure in subtraction', async () => {
      const script = `
        |x|($x * 3) => $triple
        10 -> ($triple - 5)
      `;
      expect(await run(script)).toBe(25); // 10*3=30, 30-5=25
    });

    it('auto-invokes closure in multiplication', async () => {
      const script = `
        |x|($x + 2) => $addTwo
        5 -> ($addTwo * 3)
      `;
      expect(await run(script)).toBe(21); // 5+2=7, 7*3=21
    });

    it('auto-invokes closure in division', async () => {
      const script = `
        |x|($x * 4) => $quadruple
        10 -> ($quadruple / 2)
      `;
      expect(await run(script)).toBe(20); // 10*4=40, 40/2=20
    });
  });

  describe('Boundary Conditions', () => {
    it('AC-34: closure returning closure - outer invoked, inner returned', async () => {
      // Outer closure invoked, returns inner closure (not auto-invoked again)
      const script = `
        || { |x|($x + 1) } => $outer
        5 -> type($outer)
      `;
      // When $ is bound (5 ->), $outer is auto-invoked, returning inner closure
      expect(await run(script)).toBe('closure');
    });

    it('AC-35: both closures auto-invoked in && operator', async () => {
      // Both operands are closures that should be auto-invoked
      const script = `
        |x|($x > 0) => $a
        |x|($x < 10) => $b
        5 -> ($a && $b)
      `;
      expect(await run(script)).toBe(true); // (5>0) && (5<10) = true && true
    });

    it('AC-35 variant: both closures auto-invoked in || operator', async () => {
      const script = `
        |x|($x > 10) => $a
        |x|($x < 0) => $b
        5 -> ($a || $b)
      `;
      expect(await run(script)).toBe(false); // (5>10) || (5<0) = false || false
    });

    it('AC-36: fallback closure in ?? operator (NOT auto-invoked)', async () => {
      // Default value is evaluated but NOT auto-invoked
      // This is because default value evaluation happens outside expression context
      const script = `
        || { $ * 2 } => $fallback
        [x: 10] => $data
        5 -> ($data.y ?? $fallback)
      `;
      // $data.y missing, evaluates $fallback, but returns closure (not invoked)
      const result = await run(script);
      expect(await run('type($result)', { variables: { result } })).toBe(
        'closure'
      );
    });

    it('double negation with closure auto-invoke', async () => {
      const script = `
        |x|($x > 5) => $test
        3 -> (!!$test)
      `;
      expect(await run(script)).toBe(false); // 3>5=false, !!false=false
    });

    it('chained comparisons with closure', async () => {
      const script = `
        |x|($x + 5) => $addFive
        5 -> (($addFive > 8) && ($addFive < 12))
      `;
      expect(await run(script)).toBe(true); // 5+5=10, (10>8) && (10<12) = true
    });

    it('nested arithmetic with multiple closures', async () => {
      const script = `
        |x|($x * 2) => $double
        |x|($x + 3) => $addThree
        5 -> (($double + $addThree) * 2)
      `;
      expect(await run(script)).toBe(36); // (10 + 8) * 2 = 36
    });
  });

  describe('Error Cases', () => {
    it('AC-31: closure returning non-boolean in negation throws RUNTIME_TYPE_ERROR', async () => {
      // Closure returns number, but negation requires boolean
      const script = `
        |x|($x + 1) => $add
        5 -> (! $add)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_TYPE_ERROR');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/requires boolean operand, got number/)
        );
      }
    });

    it('AC-31 variant: closure returning string in negation', async () => {
      const script = `
        |x|($x -> .str) => $toStr
        5 -> (! $toStr)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_TYPE_ERROR');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/requires boolean operand, got string/)
        );
      }
    });

    it('AC-32: auto-invoke without $ bound throws RUNTIME_TYPE_ERROR', async () => {
      // No pipe context ($), so closure is NOT auto-invoked
      // The closure itself is passed to negation, which throws type error
      const script = `
        || { $ + 1 } => $inc
        ! $inc
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_TYPE_ERROR');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/requires boolean operand, got closure/)
        );
      }
    });

    it('AC-33: closure requiring 2+ params without tuple throws arity error', async () => {
      // Closure expects 2 parameters, auto-invoke only provides 1 ($ value)
      const script = `
        |a, b|($a + $b) => $add
        5 -> ($add + 10)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown arity error');
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

    it('closure returns wrong type for arithmetic', async () => {
      const script = `
        |x|("text") => $str
        5 -> ($str + 10)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_TYPE_ERROR');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Arithmetic requires number/)
        );
      }
    });

    it('closure returns wrong type for comparison', async () => {
      const script = `
        |x|("text") => $str
        5 -> ($str < 10)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_TYPE_ERROR');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/Cannot compare string with number/)
        );
      }
    });

    it('undefined variable in closure body during auto-invoke', async () => {
      const script = `
        |x|($x + $undefined) => $bad
        5 -> (10 + $bad)
      `;
      try {
        await run(script);
        expect.fail('Should have thrown RUNTIME_UNDEFINED_VARIABLE');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R005');
        expect(err).toHaveProperty(
          'message',
          expect.stringMatching(/undefined/i)
        );
      }
    });
  });

  describe('No Auto-Invoke Contexts', () => {
    it('capture target does not auto-invoke (outside pipe)', async () => {
      // Closure captured as-is when not in pipe context
      const script = `
        |x|($x + 1) => $add
        $add => $captured
        type($captured)
      `;
      expect(await run(script)).toBe('closure');
    });

    it('direct pipe target does not auto-invoke', async () => {
      // Piping directly to closure invokes it normally (not auto-invoke)
      const script = `
        |x|($x + 1) => $add
        5 -> $add
      `;
      expect(await run(script)).toBe(6);
    });

    it('function call argument does not auto-invoke', async () => {
      // Closure passed as argument, not auto-invoked
      const script = `
        |x|($x + 1) => $add
        type($add)
      `;
      expect(await run(script)).toBe('closure');
    });
  });

  describe('Auto-Invoke Integration', () => {
    it('auto-invoke in conditional condition (via comparison)', async () => {
      // Auto-invoke happens in > operator, not in conditional itself
      const script = `
        |x|($x) => $id
        10 -> (($id > 5) ? "big" ! "small")
      `;
      expect(await run(script)).toBe('big');
    });

    it('list filter with direct pipe to closure', async () => {
      // filter receives closure, not auto-invoked
      const script = `
        |x|($x > 0) => $positive
        [-1, 2, -3, 4] -> filter $positive
      `;
      expect(await run(script)).toEqual([2, 4]);
    });

    it('each loop with direct pipe to closure', async () => {
      // each receives closure, not auto-invoked
      const script = `
        |x|($x * 2) => $double
        [1, 2, 3] -> each $double
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('auto-invoke with multiple operators', async () => {
      const script = `
        |x|($x + 5) => $addFive
        |x|($x * 2) => $double
        5 -> ((($addFive + $double) > 15) && ($addFive < 15))
      `;
      // 5+5=10, 5*2=10, (10+10>15) && (10<15) = true && true
      expect(await run(script)).toBe(true);
    });
  });
});
