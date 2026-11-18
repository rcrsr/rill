/**
 * Rill Runtime Tests: Closure Operands Are Not Invoked
 *
 * A closure used as an operand in an expression context (operators,
 * conditions) is never invoked: the operator receives the closure value
 * itself and halts with its own type error. A closure runs only when called
 * (`$fn(...)`) or written as a pipe target (`-> $fn`).
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const NEGATION_TYPE_ERROR = {
  code: 'RILL_R002',
  hostErrorId: 'RILL-R002',
  messagePattern: /requires boolean operand, got closure/,
} as const;

const ARITHMETIC_TYPE_ERROR = {
  code: 'RILL_R002',
  hostErrorId: 'RILL-R002',
  messagePattern: /Arithmetic requires number, got closure/,
} as const;

describe('Rill Runtime: Closure Operands Are Not Invoked', () => {
  describe('Operators Reject A Closure Operand', () => {
    it('negation halts on a closure operand', async () => {
      const script = `
        |x|($x > 0) => $pos
        5 -> (! $pos)
      `;
      await expectHalt(() => run(script), NEGATION_TYPE_ERROR);
    });

    it('arithmetic halts on a zero-param closure operand', async () => {
      const script = `
        || { $ + 1 } => $inc
        5 -> ($inc + 10)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });

    it('equality halts on a closure operand', async () => {
      const script = `
        |x| { $x } => $id
        "test" -> ($id == "test")
      `;
      await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
    });

    it('less-than halts on a closure operand', async () => {
      const script = `
        |x|($x * 2) => $double
        5 -> ($double < 20)
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /closure/,
      });
    });

    it('greater-than halts on a closure operand', async () => {
      const script = `
        |x|($x - 3) => $sub
        10 -> ($sub > 5)
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /closure/,
      });
    });

    it('subtraction halts on a closure operand', async () => {
      const script = `
        |x|($x * 3) => $triple
        10 -> ($triple - 5)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });

    it('multiplication halts on a closure operand', async () => {
      const script = `
        |x|($x + 2) => $addTwo
        5 -> ($addTwo * 3)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });

    it('division halts on a closure operand', async () => {
      const script = `
        |x|($x * 4) => $quadruple
        10 -> ($quadruple / 2)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });
  });

  describe('Boundary Conditions', () => {
    it('closure returning closure is returned by an explicit call', async () => {
      const script = `
        || { |x|($x + 1) } => $outer
        $outer() => $inner
        $inner.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });

    it('&& halts on a closure operand', async () => {
      const script = `
        |x|($x > 0) => $a
        |x|($x < 10) => $b
        5 -> ($a && $b)
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          /Logical operator \(&&\) requires boolean operand, got closure/,
      });
    });

    it('|| halts on a closure operand', async () => {
      const script = `
        |x|($x > 10) => $a
        |x|($x < 0) => $b
        5 -> ($a || $b)
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern:
          /Logical operator \(\|\|\) requires boolean operand, got closure/,
      });
    });

    it('fallback closure in ?? operator is returned, not invoked', async () => {
      // The fallback is the value of the expression; it is never invoked.
      const script = `
        || { $ * 2 } => $fallback
        dict[x: 10] => $data
        5 -> ($data.y ?? $fallback) => $r
        $r.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });

    it('double negation halts on a closure operand', async () => {
      const script = `
        |x|($x > 5) => $test
        3 -> (!!$test)
      `;
      await expectHalt(() => run(script), NEGATION_TYPE_ERROR);
    });

    it('chained comparisons halt on a closure operand', async () => {
      const script = `
        |x|($x + 5) => $addFive
        5 -> (($addFive > 8) && ($addFive < 12))
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /closure/,
      });
    });

    it('nested arithmetic halts on a closure operand', async () => {
      const script = `
        |x|($x * 2) => $double
        |x|($x + 3) => $addThree
        5 -> (($double + $addThree) * 2)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });
  });

  describe('Error Cases', () => {
    it('negation of a closure returning a number halts on the closure', async () => {
      const script = `
        |x|($x + 1) => $add
        5 -> (! $add)
      `;
      await expectHalt(() => run(script), NEGATION_TYPE_ERROR);
    });

    it('negation of a closure returning a string halts on the closure', async () => {
      const script = `
        |x|($x -> string) => $toStr
        5 -> (! $toStr)
      `;
      await expectHalt(() => run(script), NEGATION_TYPE_ERROR);
    });

    it('negation of a closure without $ bound halts on the closure', async () => {
      const script = `
        || { $ + 1 } => $inc
        ! $inc
      `;
      await expectHalt(() => run(script), NEGATION_TYPE_ERROR);
    });

    it('arithmetic on a two-param closure halts on the closure, not on arity', async () => {
      const script = `
        |a, b|($a + $b) => $add
        5 -> ($add + 10)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });

    it('arithmetic on a closure returning text halts on the closure', async () => {
      const script = `
        |x|("text") => $str
        5 -> ($str + 10)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });

    it('comparison on a closure returning text halts on the closure', async () => {
      const script = `
        |x|("text") => $str
        5 -> ($str < 10)
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /closure/,
      });
    });

    it('a closure body is never entered, so its undefined variable never halts', async () => {
      const script = `
        |x|($x + $undefined) => $bad
        5 -> (10 + $bad)
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });
  });

  describe('Direct Closure Use', () => {
    it('capture target does not invoke (outside pipe)', async () => {
      const script = `
        |x|($x + 1) => $add
        $add => $captured
        $captured.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });

    it('direct pipe target invokes with the operand', async () => {
      const script = `
        |x|($x + 1) => $add
        5 -> $add
      `;
      expect(await run(script)).toBe(6);
    });

    it('closure reference is a closure value', async () => {
      const script = `
        |x|($x + 1) => $add
        $add.^type
      `;
      const result = (await run(script)) as any;
      expect(result.typeName).toBe('closure');
    });
  });

  describe('Integration', () => {
    it('comparison in a conditional condition halts on a closure operand', async () => {
      const script = `
        |x|($x) => $id
        10 -> (($id > 5) ? "big" ! "small")
      `;
      await expectHalt(() => run(script), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: /closure/,
      });
    });

    it('list filter with direct pipe to closure', async () => {
      const script = `
        |x|($x > 0) => $positive
        list[-1, 2, -3, 4] -> filter($positive)
      `;
      expect(await run(script)).toEqual([2, 4]);
    });

    it('each loop with direct pipe to closure', async () => {
      const script = `
        |x|($x * 2) => $double
        list[1, 2, 3] -> seq($double)
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('multiple operators halt on a closure operand', async () => {
      const script = `
        |x|($x + 5) => $addFive
        |x|($x * 2) => $double
        5 -> ((($addFive + $double) > 15) && ($addFive < 15))
      `;
      await expectHalt(() => run(script), ARITHMETIC_TYPE_ERROR);
    });
  });
});
