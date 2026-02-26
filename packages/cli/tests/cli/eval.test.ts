/**
 * Rill CLI Tests: rill-eval command
 */

import { describe, expect, it } from 'vitest';
import { ParseError, RuntimeError, callable, isCallable } from '@rcrsr/rill';
import { formatOutput } from '../../src/cli-shared.js';
import { evaluateExpression } from '../../src/cli-eval.js';

describe('rill-eval', () => {
  describe('evaluateExpression', () => {
    it('evaluates string methods', async () => {
      expect((await evaluateExpression('"hello".len')).result).toBe(5);
      expect((await evaluateExpression('"hello".upper')).result).toBe('HELLO');
      expect((await evaluateExpression('"  hi  ".trim')).result).toBe('hi');
    });

    it('evaluates arithmetic', async () => {
      expect((await evaluateExpression('5 + 3')).result).toBe(8);
      expect((await evaluateExpression('10 - 4')).result).toBe(6);
      expect((await evaluateExpression('6 * 7')).result).toBe(42);
    });

    it('evaluates pipes', async () => {
      expect((await evaluateExpression('"hello" -> .upper')).result).toBe(
        'HELLO'
      );
    });

    it('evaluates collections', async () => {
      expect((await evaluateExpression('[1, 2, 3] -> .len')).result).toBe(3);
      expect(
        (await evaluateExpression('[1, 2, 3] -> map |x|($x * 2)')).result
      ).toEqual([2, 4, 6]);
      expect((await evaluateExpression('[a: 1].a')).result).toBe(1);
    });

    it('evaluates closures', async () => {
      const result = await evaluateExpression('|x| { $x }');
      expect(isCallable(result.result)).toBe(true);
      expect(formatOutput(result.result)).toBe('[closure]');
    });

    it('handles empty values', async () => {
      expect((await evaluateExpression('""')).result).toBe('');
      expect((await evaluateExpression('[]')).result).toEqual([]);
      expect((await evaluateExpression('0')).result).toBe(0);
    });

    it('throws parse errors', async () => {
      await expect(evaluateExpression('{')).rejects.toThrow(ParseError);
      await expect(evaluateExpression('|x| x }')).rejects.toThrow(ParseError);
    });

    it('throws runtime errors', async () => {
      await expect(evaluateExpression('$undefined')).rejects.toThrow(
        RuntimeError
      );
      await expect(evaluateExpression('"string" + 5')).rejects.toThrow(
        RuntimeError
      );
    });

    it('preserves error details', async () => {
      try {
        await evaluateExpression('$missing');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R005');
        expect((err as RuntimeError).location?.line).toBe(1);
      }
    });
  });

  describe('formatOutput for eval results', () => {
    it('formats closures from expressions', () => {
      expect(formatOutput(callable(() => 'x'))).toBe('[closure]');
    });
  });
});
