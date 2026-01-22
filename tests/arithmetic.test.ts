/**
 * Rill Runtime Tests: Arithmetic Expressions
 * Tests for arithmetic syntax (standalone and grouped)
 */

import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

describe('Rill Runtime: Arithmetic', () => {
  describe('Standalone Arithmetic', () => {
    it('adds two numbers without parens', async () => {
      expect(await run('5 + 3')).toBe(8);
    });

    it('respects operator precedence without parens', async () => {
      expect(await run('2 + 3 * 4')).toBe(14);
    });

    it('chains operations without parens', async () => {
      expect(await run('10 - 4 - 2')).toBe(4);
    });

    it('arithmetic result can be piped', async () => {
      expect(await run('5 + 3 :> $x\n$x * 2')).toBe(16);
    });

    it('comparison as standalone expression', async () => {
      expect(await run('5 > 3')).toBe(true);
    });

    it('equality as standalone expression', async () => {
      expect(await run('5 == 5')).toBe(true);
    });

    it('arithmetic in block without parens', async () => {
      expect(await run('{ 5 + 3 }')).toBe(8);
    });
  });

  describe('Basic Operations', () => {
    it('adds two numbers', async () => {
      expect(await run('(5 + 3)')).toBe(8);
    });

    it('subtracts two numbers', async () => {
      expect(await run('(10 - 4)')).toBe(6);
    });

    it('multiplies two numbers', async () => {
      expect(await run('(6 * 7)')).toBe(42);
    });

    it('divides two numbers', async () => {
      expect(await run('(20 / 4)')).toBe(5);
    });

    it('handles modulo', async () => {
      expect(await run('(17 % 5)')).toBe(2);
    });

    it('handles single number', async () => {
      expect(await run('(42)')).toBe(42);
    });
  });

  describe('Operator Precedence', () => {
    it('multiplication before addition', async () => {
      expect(await run('(2 + 3 * 4)')).toBe(14);
    });

    it('division before subtraction', async () => {
      expect(await run('(10 - 8 / 2)')).toBe(6);
    });

    it('respects parentheses', async () => {
      expect(await run('((2 + 3) * 4)')).toBe(20);
    });

    it('handles complex expression', async () => {
      expect(await run('((10 + 5) / 3 * 2)')).toBe(10);
    });
  });

  describe('Unary Minus', () => {
    it('negates a number', async () => {
      expect(await run('(-5)')).toBe(-5);
    });

    it('negates in expression', async () => {
      expect(await run('(10 + -3)')).toBe(7);
    });

    it('double negation', async () => {
      expect(await run('(--5)')).toBe(5);
    });
  });

  describe('With Variables', () => {
    it('uses pipe variable', async () => {
      expect(await run('10 -> ($ + 5)')).toBe(15);
    });

    it('uses named variable', async () => {
      expect(await run('5 :> $x\n($x * 2)')).toBe(10);
    });

    it('uses multiple variables', async () => {
      expect(await run('3 :> $a\n4 :> $b\n($a + $b)')).toBe(7);
    });

    it('combines pipe and named variable', async () => {
      expect(await run('5 :> $x\n10 -> ($ + $x)')).toBe(15);
    });
  });

  describe('Chaining', () => {
    it('chains arithmetic expressions', async () => {
      expect(await run('(5 + 5) -> ($ * 2)')).toBe(20);
    });

    it('chains with capture', async () => {
      expect(await run('(3 + 4) :> $result\n$result')).toBe(7);
    });

    it('uses result in method call', async () => {
      expect(await run('(5 + 5) -> .str')).toBe('10');
    });
  });

  describe('Floating Point', () => {
    it('handles decimals', async () => {
      expect(await run('(3.5 + 2.5)')).toBe(6);
    });

    it('handles decimal division', async () => {
      expect(await run('(7 / 2)')).toBe(3.5);
    });
  });

  describe('Error Handling', () => {
    it('errors on division by zero', async () => {
      await expect(run('(10 / 0)')).rejects.toThrow('Division by zero');
    });

    it('errors on modulo by zero', async () => {
      await expect(run('(10 % 0)')).rejects.toThrow('Modulo by zero');
    });

    it('errors on non-number variable', async () => {
      await expect(run('"hello" :> $x\n($x + 1)')).rejects.toThrow(
        'Arithmetic requires number, got string'
      );
    });

    it('errors on non-number pipe value', async () => {
      await expect(run('"hello" -> ($ + 1)')).rejects.toThrow(
        'Arithmetic requires number, got string'
      );
    });
  });

  describe('In Conditionals', () => {
    it('uses arithmetic in condition', async () => {
      expect(await run('5 -> (($ + 3) > 7) ? "big" ! "small"')).toBe('big');
    });

    it('uses arithmetic result in comparison', async () => {
      expect(await run('(5 + 5) -> ($ == 10) ? "ten" ! "other"')).toBe('ten');
    });
  });

  describe('In Loops', () => {
    it('uses arithmetic in loop', async () => {
      // For loop returns array of results
      expect(await run('[1, 2, 3] -> each { ($ * 2) }')).toEqual([2, 4, 6]);
    });

    it('captures last element from loop', async () => {
      // Use while loop to get last value
      expect(
        await run('[1, 2, 3] -> each { ($ * 2) } :> $result\n$result')
      ).toEqual([2, 4, 6]);
    });
  });
});
