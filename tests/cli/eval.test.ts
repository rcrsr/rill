/**
 * Rill CLI Tests: rill-eval command
 */

import { describe, expect, it } from 'vitest';
import {
  ParseError,
  RuntimeError,
  callable,
  isCallable,
} from '../../src/index.js';
import { formatOutput } from '../../src/cli-shared.js';
import { evaluateExpression } from '../../src/cli-eval.js';

describe('rill-eval', () => {
  describe('evaluateExpression', () => {
    it('evaluates string methods', async () => {
      expect((await evaluateExpression('"hello".len')).value).toBe(5);
      expect((await evaluateExpression('"hello".upper')).value).toBe('HELLO');
      expect((await evaluateExpression('"  hi  ".trim')).value).toBe('hi');
    });

    it('evaluates arithmetic', async () => {
      expect((await evaluateExpression('5 + 3')).value).toBe(8);
      expect((await evaluateExpression('10 - 4')).value).toBe(6);
      expect((await evaluateExpression('6 * 7')).value).toBe(42);
    });

    it('evaluates pipes', async () => {
      expect((await evaluateExpression('"hello" -> .upper')).value).toBe(
        'HELLO'
      );
    });

    it('evaluates collections', async () => {
      expect((await evaluateExpression('[1, 2, 3] -> .len')).value).toBe(3);
      expect(
        (await evaluateExpression('[1, 2, 3] -> map |x|($x * 2)')).value
      ).toEqual([2, 4, 6]);
      expect((await evaluateExpression('[a: 1].a')).value).toBe(1);
    });

    it('evaluates closures', async () => {
      const result = await evaluateExpression('|x| { $x }');
      expect(isCallable(result.value)).toBe(true);
      expect(formatOutput(result.value)).toBe('[closure]');
    });

    it('handles empty values', async () => {
      expect((await evaluateExpression('""')).value).toBe('');
      expect((await evaluateExpression('[]')).value).toEqual([]);
      expect((await evaluateExpression('0')).value).toBe(0);
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
        expect((err as RuntimeError).code).toBe('RUNTIME_UNDEFINED_VARIABLE');
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
