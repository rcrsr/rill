/**
 * Rill Runtime Tests: Boolean Expressions
 * Tests for logical operators (&&, ||, !) and comparisons
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Boolean Expressions', () => {
  describe('Logical Negation (!)', () => {
    it('!true = false', async () => {
      expect(await run('!true')).toBe(false);
    });

    it('!false = true', async () => {
      expect(await run('!false')).toBe(true);
    });

    it('double negation', async () => {
      expect(await run('!!true')).toBe(true);
    });

    it('negation in conditional', async () => {
      expect(await run('(!true) ? "yes" ! "no"')).toBe('no');
    });

    it('negation of variable', async () => {
      expect(await run('true :> $x\n!$x')).toBe(false);
    });
  });

  describe('Comparison: Equality', () => {
    it('== equal numbers', async () => {
      expect(await run('1 == 1')).toBe(true);
    });

    it('== unequal numbers', async () => {
      expect(await run('1 == 2')).toBe(false);
    });

    it('== equal strings', async () => {
      expect(await run('"a" == "a"')).toBe(true);
    });

    it('== unequal strings', async () => {
      expect(await run('"a" == "b"')).toBe(false);
    });

    it('!= different values', async () => {
      expect(await run('1 != 2')).toBe(true);
    });

    it('!= same values', async () => {
      expect(await run('1 != 1')).toBe(false);
    });

    it('comparison in pipe', async () => {
      expect(await run('1 -> ($ == 1) ? "yes" ! "no"')).toBe('yes');
    });
  });

  describe('Comparison: Ordering', () => {
    it('< less than', async () => {
      expect(await run('1 < 2')).toBe(true);
    });

    it('< not less than', async () => {
      expect(await run('2 < 1')).toBe(false);
    });

    it('< equal values', async () => {
      expect(await run('1 < 1')).toBe(false);
    });

    it('> greater than', async () => {
      expect(await run('2 > 1')).toBe(true);
    });

    it('> not greater than', async () => {
      expect(await run('1 > 2')).toBe(false);
    });

    it('<= less than', async () => {
      expect(await run('1 <= 2')).toBe(true);
    });

    it('<= equal', async () => {
      expect(await run('2 <= 2')).toBe(true);
    });

    it('<= greater than', async () => {
      expect(await run('3 <= 2')).toBe(false);
    });

    it('>= greater than', async () => {
      expect(await run('3 >= 2')).toBe(true);
    });

    it('>= equal', async () => {
      expect(await run('2 >= 2')).toBe(true);
    });

    it('>= less than', async () => {
      expect(await run('1 >= 2')).toBe(false);
    });

    it('string comparison <', async () => {
      expect(await run('"a" < "b"')).toBe(true);
    });

    it('string comparison >', async () => {
      expect(await run('"b" > "a"')).toBe(true);
    });
  });

  describe('Logical AND (&&)', () => {
    it('true && true = true', async () => {
      expect(await run('(true && true)')).toBe(true);
    });

    it('true && false = false', async () => {
      expect(await run('(true && false)')).toBe(false);
    });

    it('false && true = false', async () => {
      expect(await run('(false && true)')).toBe(false);
    });

    it('false && false = false', async () => {
      expect(await run('(false && false)')).toBe(false);
    });

    it('chained &&', async () => {
      expect(await run('(true && true && true)')).toBe(true);
      expect(await run('(true && false && true)')).toBe(false);
    });

    it('&& with comparisons', async () => {
      expect(await run('(1 < 2 && 3 > 2)')).toBe(true);
      expect(await run('(1 < 2 && 3 < 2)')).toBe(false);
    });

    it('&& short-circuit evaluation', async () => {
      // false && (expression) should not evaluate the right side
      // We test this by using a variable that would error if accessed
      expect(await run('(false && $undefined)')).toBe(false);
    });
  });

  describe('Logical OR (||)', () => {
    it('true || true = true', async () => {
      expect(await run('(true || true)')).toBe(true);
    });

    it('true || false = true', async () => {
      expect(await run('(true || false)')).toBe(true);
    });

    it('false || true = true', async () => {
      expect(await run('(false || true)')).toBe(true);
    });

    it('false || false = false', async () => {
      expect(await run('(false || false)')).toBe(false);
    });

    it('chained ||', async () => {
      expect(await run('(false || false || true)')).toBe(true);
      expect(await run('(false || false || false)')).toBe(false);
    });

    it('|| with comparisons', async () => {
      expect(await run('(1 > 2 || 3 > 2)')).toBe(true);
      expect(await run('(1 > 2 || 3 < 2)')).toBe(false);
    });

    it('|| short-circuit evaluation', async () => {
      // true || (expression) should not evaluate the right side
      expect(await run('(true || $undefined)')).toBe(true);
    });
  });

  describe('Operator Precedence', () => {
    it('&& binds tighter than ||', async () => {
      // true || false && false = true || (false && false) = true
      expect(await run('(true || false && false)')).toBe(true);
      // false && true || true = (false && true) || true = true
      expect(await run('(false && true || true)')).toBe(true);
    });

    it('comparison binds tighter than &&', async () => {
      // 1 < 2 && 3 > 2 = (1 < 2) && (3 > 2) = true
      expect(await run('(1 < 2 && 3 > 2)')).toBe(true);
    });

    it('arithmetic binds tighter than comparison', async () => {
      // 1 + 1 > 1 = (1 + 1) > 1 = 2 > 1 = true
      expect(await run('(1 + 1 > 1)')).toBe(true);
    });

    it('! binds tightest', async () => {
      // !false && true = (!false) && true = true && true = true
      expect(await run('(!false && true)')).toBe(true);
    });
  });

  describe('Complex Expressions', () => {
    it('mixed operators with parentheses', async () => {
      expect(await run('((true || false) && (false || true))')).toBe(true);
    });

    it('negation with &&', async () => {
      expect(await run('(!false && !false)')).toBe(true);
      expect(await run('(!true && !false)')).toBe(false);
    });

    it('negation with ||', async () => {
      expect(await run('(!true || !false)')).toBe(true);
      expect(await run('(!true || !true)')).toBe(false);
    });

    it('comparison chain with logical ops', async () => {
      expect(await run('(1 < 2 && 2 < 3 && 3 < 4)')).toBe(true);
      expect(await run('(1 > 2 || 2 > 3 || 3 < 4)')).toBe(true);
    });

    it('as conditional condition', async () => {
      expect(await run('(true && true) ? "yes" ! "no"')).toBe('yes');
      expect(await run('(true && false) ? "yes" ! "no"')).toBe('no');
      expect(await run('(false || true) ? "yes" ! "no"')).toBe('yes');
    });

    it('in loop condition', async () => {
      // Uses pipe value ($) as accumulator since blocks have isolated scope
      expect(
        await run(`
        0 -> ($ < 3 && $ >= 0) @ { $ + 1 }
      `)
      ).toBe(3);
    });
  });

  describe('Type Safety: Negation Operator', () => {
    it('rejects string operand', async () => {
      await expect(run('! "text"')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got string'
      );
    });

    it('rejects number operand', async () => {
      await expect(run('! 42')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got number'
      );
    });

    it('rejects list operand', async () => {
      await expect(run('! [1, 2]')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got list'
      );
    });

    it('rejects empty string', async () => {
      await expect(run('! ""')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got string'
      );
    });

    it('rejects zero', async () => {
      await expect(run('! 0')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got number'
      );
    });
  });
});
