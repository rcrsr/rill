/**
 * Rill Runtime Tests: Late-Bound Closures
 *
 * Tests for late-bound closure captures (Phase 11.5).
 * Closures resolve captured variables at call time, not definition time,
 * enabling recursive patterns and forward references.
 *
 * Note: Closures with complex bodies (conditionals, multiple expressions)
 * require braces {} to properly delimit the body.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Late-Bound Closures', () => {
  describe('Recursive Closures', () => {
    it('factorial: closure can call itself recursively', async () => {
      // Braces required for conditional body
      const script = `
        |n| { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
        $factorial(5)
      `;
      expect(await run(script)).toBe(120);
    });

    it('factorial: handles base case correctly', async () => {
      const script = `
        |n| { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
        $factorial(0)
      `;
      expect(await run(script)).toBe(1);
    });

    it('factorial: handles small values', async () => {
      const script = `
        |n| { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
        $factorial(1)
      `;
      expect(await run(script)).toBe(1);
    });
  });

  describe('Mutual Recursion', () => {
    it('even/odd: mutually recursive closures', async () => {
      const script = `
        |n| { ($n == 0) ? true ! $odd($n - 1) } => $even
        |n| { ($n == 0) ? false ! $even($n - 1) } => $odd
        $even(4)
      `;
      expect(await run(script)).toBe(true);
    });

    it('even/odd: odd number returns false', async () => {
      const script = `
        |n| { ($n == 0) ? true ! $odd($n - 1) } => $even
        |n| { ($n == 0) ? false ! $even($n - 1) } => $odd
        $even(5)
      `;
      expect(await run(script)).toBe(false);
    });

    it('even/odd: calling $odd directly', async () => {
      const script = `
        |n| { ($n == 0) ? true ! $odd($n - 1) } => $even
        |n| { ($n == 0) ? false ! $even($n - 1) } => $odd
        $odd(3)
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Fibonacci', () => {
    it('fibonacci: doubly recursive closure', async () => {
      const script = `
        |n| { ($n < 2) ? $n ! ($fib($n - 1) + $fib($n - 2)) } => $fib
        $fib(10)
      `;
      expect(await run(script)).toBe(55);
    });

    it('fibonacci: base cases', async () => {
      const script = `
        |n| { ($n < 2) ? $n ! ($fib($n - 1) + $fib($n - 2)) } => $fib
        [$fib(0), $fib(1), $fib(2)]
      `;
      expect(await run(script)).toEqual([0, 1, 1]);
    });
  });

  describe('Closures in Lists', () => {
    it('closures in list can reference forward-defined variable', async () => {
      const script = `
        [
          || { $helper(1) },
          || { $helper(2) }
        ] => $handlers
        |n| { $n * 10 } => $helper
        $handlers[0]()
      `;
      expect(await run(script)).toBe(10);
    });

    it('closures in list: second handler', async () => {
      const script = `
        [
          || { $helper(1) },
          || { $helper(2) }
        ] => $handlers
        |n| { $n * 10 } => $helper
        $handlers[1]()
      `;
      expect(await run(script)).toBe(20);
    });
  });

  describe('String Interpolations', () => {
    it('interpolation can reference forward-defined closure', async () => {
      const script = `
        |x| { "Result: {$format($x)}" } => $display
        |n| { $n * 100 } => $format
        $display(5)
      `;
      expect(await run(script)).toBe('Result: 500');
    });
  });

  describe('Variable Mutation Visibility', () => {
    it('closures see current value of captured variables', async () => {
      const script = `
        0 => $x
        || { $x } => $getX
        $getX()
      `;
      expect(await run(script)).toBe(0);
    });

    it('closures see updated value after mutation', async () => {
      const script = `
        0 => $x
        || { $x } => $getX
        5 => $x
        $getX()
      `;
      // With late binding, closure sees current value ($x=5)
      expect(await run(script)).toBe(5);
    });
  });

  describe('Error Cases', () => {
    it('undefined variable errors at call time', async () => {
      const script = `
        || { $undefined } => $fn
        $fn()
      `;
      // With late binding, undefined variables throw error at call time
      await expect(run(script)).rejects.toThrow('Undefined variable');
    });

    it('invoking non-callable throws error', async () => {
      const script = `
        [1, 2, 3] => $list
        $list[0]()
      `;
      await expect(run(script)).rejects.toThrow(/Cannot invoke non-callable/);
    });
  });

  describe('Nested Closures', () => {
    it('inner closure sees outer closure variables', async () => {
      const script = `
        10 => $x
        || {
          || { $x + 1 }
        } => $outer
        $outer()()
      `;
      expect(await run(script)).toBe(11);
    });

    it('nested closures see variable updates', async () => {
      const script = `
        1 => $x
        || { || { $x } } => $outer
        5 => $x
        $outer()()
      `;
      expect(await run(script)).toBe(5);
    });

    it('closure factory returns new closures', async () => {
      const script = `
        |n| { || { $n } } => $makeGetter
        $makeGetter(42)()
      `;
      expect(await run(script)).toBe(42);
    });
  });

  describe('Parameter Shadowing', () => {
    it('parameter shadows captured variable', async () => {
      const script = `
        100 => $x
        |x| { $x * 2 } => $double
        $double(5)
      `;
      // Parameter $x (5) shadows captured $x (100)
      expect(await run(script)).toBe(10);
    });

    it('inner param shadows outer captured var', async () => {
      const script = `
        100 => $n
        |n| { $n + 1 } => $increment
        $increment(5)
      `;
      expect(await run(script)).toBe(6);
    });
  });

  describe('Multiple Closures Same Scope', () => {
    it('multiple closures see same variable updates', async () => {
      const script = `
        0 => $counter
        || { $counter } => $get
        || { $counter + 1 } => $getPlus1
        5 => $counter
        [$get(), $getPlus1()]
      `;
      expect(await run(script)).toEqual([5, 6]);
    });
  });

  describe('Postfix Invocation Edge Cases', () => {
    it('invocation with arguments', async () => {
      const script = `
        [|a, b| { $a + $b }] => $fns
        $fns[0](3, 4)
      `;
      expect(await run(script)).toBe(7);
    });

    it('chained invocations', async () => {
      const script = `
        || { |n| { $n * 2 } } => $makeDoubler
        $makeDoubler()(5)
      `;
      expect(await run(script)).toBe(10);
    });

    it('method call after bracket access (requires grouping)', async () => {
      // $list[0].upper parses .upper as field access on $list, not method on result
      // Use grouping to force method call on the bracket access result
      const script = `
        ["hello", "world"] => $list
        ($list[0]).upper
      `;
      expect(await run(script)).toBe('HELLO');
    });

    it('invocation after method chain', async () => {
      const script = `
        [double: |n| { $n * 2 }] => $math
        $math.double(7)
      `;
      expect(await run(script)).toBe(14);
    });

    it('pipe-style invocation with dict closure', async () => {
      const script = `
        [double: |x| { $x * 2 }] => $math
        5 -> $math.double()
      `;
      expect(await run(script)).toBe(10);
    });

    it('pipe-style invocation with nested dict closure', async () => {
      const script = `
        [ops: [double: |x| { $x * 2 }, triple: |x| { $x * 3 }]] => $math
        7 -> $math.ops.double()
      `;
      expect(await run(script)).toBe(14);
    });

    it('pipe-style invocation chains with dict closure', async () => {
      const script = `
        [double: |x| { $x * 2 }] => $math
        5 -> $math.double() -> $math.double()
      `;
      expect(await run(script)).toBe(20);
    });

    it('pipe-style dict closure with explicit args ignores pipe value', async () => {
      const script = `
        [double: |x| { $x * 2 }] => $math
        999 -> $math.double(7)
      `;
      expect(await run(script)).toBe(14);
    });
  });

  describe('Scope Isolation', () => {
    it('closures capture loop variables when explicitly stored', async () => {
      // $ (pipeValue) is not a variable - must capture explicitly
      const script = `
        [1, 2, 3] -> each { $ => $item \n || { $item } } => $closures
        [$closures[0](), $closures[1](), $closures[2]()]
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('closure defined in conditional branch', async () => {
      const script = `
        10 => $x
        true ? { || { $x } } ! { || { 0 } } => $fn
        20 => $x
        $fn()
      `;
      // Late binding: sees $x=20
      expect(await run(script)).toBe(20);
    });

    it('closures in different loop iterations have different scopes', async () => {
      // Each iteration creates a new child scope with its own $item
      const script = `
        [10, 20, 30] -> each {
          $ => $val
          || { $val * 2 }
        } => $doublers
        [$doublers[0](), $doublers[1](), $doublers[2]()]
      `;
      expect(await run(script)).toEqual([20, 40, 60]);
    });
  });
});
