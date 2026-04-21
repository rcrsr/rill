/**
 * Tests for executeRill success paths
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('success paths', () => {
    it('executes simple arithmetic and returns success', async () => {
      const result = await executeRill('1 + 2');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 3,
      });
      expect(result.error).toBe(null);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.logs).toEqual([]);
    });

    it('executes string literal and returns unquoted value', async () => {
      const result = await executeRill('"hello world"');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: 'hello world',
      });
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('executes variable capture and returns final value', async () => {
      const result = await executeRill('42 => $x\n$x * 2');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 84,
      });
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('captures log output via callbacks.onLog', async () => {
      const result = await executeRill('"test" -> log\n"final"');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: 'final',
      });
      expect(result.logs).toEqual(['test']);
      expect(result.error).toBe(null);
    });

    it('captures multiple log calls', async () => {
      const result = await executeRill(
        '"first" -> log\n"second" -> log\n"third"'
      );

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: 'third',
      });
      expect(result.logs).toEqual(['first', 'second']);
      expect(result.error).toBe(null);
    });

    it('times execution correctly', async () => {
      const result = await executeRill('1 + 1');

      expect(result.duration).not.toBe(null);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThan(1000); // Should be fast
    });

    it('returns idle status for empty source', async () => {
      const result = await executeRill('');

      expect(result.status).toBe('idle');
      expect(result.result).toBe(null);
      expect(result.error).toBe(null);
      expect(result.duration).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('returns idle status for whitespace-only source', async () => {
      const result = await executeRill('   \n\t  ');

      expect(result.status).toBe('idle');
      expect(result.result).toBe(null);
      expect(result.error).toBe(null);
      expect(result.duration).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('executes conditional blocks', async () => {
      const result = await executeRill('true ? "yes" ! "no"');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: 'yes',
      });
    });

    it('executes loops', async () => {
      const result = await executeRill('range(1, 3) -> seq({ $ })');

      expect(result.status).toBe('success');
      expect(result.result).toContain('"value"');
    });

    it('executes closures', async () => {
      const result = await executeRill(
        '|x| { $x * 2 } => $double\n21 -> $double'
      );

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 42,
      });
    });

    it('returns arrays as JSON output', async () => {
      const result = await executeRill('[1, 2, 3]');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'list',
        rillTypeSignature: 'list(number)',
        value: [1, 2, 3],
      });
    });

    it('returns dicts as success', async () => {
      const result = await executeRill('[a: 1, b: 2]');

      expect(result.status).toBe('success');
      expect(result.result).not.toBe(null);
    });

    it('executes piped operations', async () => {
      const result = await executeRill('[1, 2, 3] -> fan({ $ * 2 })');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'list',
        rillTypeSignature: 'list(number)',
        value: [2, 4, 6],
      });
    });
  });
});
