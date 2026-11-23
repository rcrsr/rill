/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Boolean Expressions
 * Tests for logical operators (&&, ||, !) and comparisons
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';

describe('Rill Runtime: Boolean Expressions', () => {
  describe('Logical Negation (!)', () => {
    rule('bool.literal').it('!true = false', async () => {
      expect(await run('!true')).toBe(false);
    });

    rule('bool.literal').it('!false = true', async () => {
      expect(await run('!false')).toBe(true);
    });

    it('double negation', async () => {
      expect(await run('!!true')).toBe(true);
    });

    it('negation in conditional', async () => {
      expect(await run('(!true) ? "yes" ! "no"')).toBe('no');
    });

    it('negation of variable', async () => {
      expect(await run('true => $x\n!$x')).toBe(false);
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

    rule('equality.not').it('!= different values', async () => {
      expect(await run('1 != 2')).toBe(true);
    });

    rule('equality.not').it('!= same values', async () => {
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
        0 -> while ($ < 3 && $ >= 0) do { $ + 1 }
      `)
      ).toBe(3);
    });
  });

  describe('Type Safety: Logical Operators', () => {
    it('&& rejects non-boolean left operand', async () => {
      await expect(run('5 && 3')).rejects.toThrow('requires boolean operand');
    });

    it('|| rejects non-boolean left operand', async () => {
      await expect(run('0 || 7')).rejects.toThrow('requires boolean operand');
    });

    it('|| rejects non-boolean string left operand', async () => {
      await expect(run('"" || "x"')).rejects.toThrow(
        'requires boolean operand'
      );
    });

    it('&& rejects non-boolean right operand', async () => {
      await expect(run('true && 5')).rejects.toThrow(
        'requires boolean operand'
      );
    });
  });

  describe('Type Safety: Negation Operator', () => {
    rule('bool.no-truthiness').it('rejects string operand', async () => {
      await expect(run('! "text"')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got string'
      );
    });

    rule('bool.no-truthiness').it('rejects number operand', async () => {
      await expect(run('! 42')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got number'
      );
    });

    rule('bool.no-truthiness').it('rejects list operand', async () => {
      await expect(run('! list[1, 2]')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got list'
      );
    });

    rule('bool.no-truthiness').it('rejects empty string', async () => {
      await expect(run('! ""')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got string'
      );
    });

    rule('bool.no-truthiness').it('rejects zero', async () => {
      await expect(run('! 0')).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got number'
      );
    });
  });

  describe('Bool values and conversion', () => {
    rule('bool.case').it.each(['TRUE', 'True'])(
      '%s is not a bool literal',
      async (src) => {
        await expect(run(src)).rejects.toHaveProperty('errorId', 'RILL-R006');
      }
    );

    rule('bool.print').it('a bool interpolates as its word', async () => {
      expect(await run('"{true}"')).toBe('true');
      expect(await run('(5 > 3) -> "is {$}"')).toBe('is true');
    });

    rule('bool.equality').it(
      'two bools are equal when both are the same value',
      async () => {
        expect(await run('true == true')).toBe(true);
        expect(await run('false == false')).toBe(true);
        expect(await run('true == false')).toBe(false);
      }
    );

    rule('bool.unordered').it.each(['true < false', 'true >= false'])(
      '%s halts RILL-R002',
      async (src) => {
        await expect(run(src)).rejects.toHaveProperty('errorId', 'RILL-R002');
      }
    );

    rule('bool.from-number').it(
      '0 and 1 convert to false and true',
      async () => {
        expect(await run('0 -> bool')).toBe(false);
        expect(await run('1 -> bool')).toBe(true);
      }
    );

    rule('bool.from-string').it(
      '"true" and "false" convert to bools',
      async () => {
        expect(await run('"true" -> bool')).toBe(true);
        expect(await run('"false" -> bool')).toBe(false);
      }
    );

    rule('bool.no-route').it.each(['2', '-1', '0.5'])(
      '%s -> bool halts RILL-R036',
      async (src) => {
        await expect(run(`${src} -> bool`)).rejects.toHaveProperty(
          'errorId',
          'RILL-R036'
        );
      }
    );

    rule('bool.no-route-string').it.each(['"True"', '""', '"1"'])(
      '%s -> bool halts RILL-R036',
      async (src) => {
        await expect(run(`${src} -> bool`)).rejects.toHaveProperty(
          'errorId',
          'RILL-R036'
        );
      }
    );

    rule('bool.no-route-type').it.each(['#true', 'list[]'])(
      '%s -> bool halts RILL-R036',
      async (src) => {
        await expect(run(`${src} -> bool`)).rejects.toHaveProperty(
          'errorId',
          'RILL-R036'
        );
      }
    );
  });
});
