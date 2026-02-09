/**
 * Tests for executeRill success paths
 */

import { describe, it, expect } from 'vitest';
import { executeRill, formatResult } from '../execution.js';

describe('executeRill', () => {
  describe('success paths', () => {
    it('executes simple arithmetic and returns success', async () => {
      const result = await executeRill('1 + 2');

      expect(result.status).toBe('success');
      expect(result.result).toBe('3');
      expect(result.error).toBe(null);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.logs).toEqual([]);
    });

    it('executes string literal and returns unquoted value', async () => {
      const result = await executeRill('"hello world"');

      expect(result.status).toBe('success');
      expect(result.result).toBe('hello world');
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('executes variable capture and returns final value', async () => {
      const result = await executeRill('42 => $x\n$x * 2');

      expect(result.status).toBe('success');
      expect(result.result).toBe('84');
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('captures log output via callbacks.onLog', async () => {
      const result = await executeRill('"test" -> log\n"final"');

      expect(result.status).toBe('success');
      expect(result.result).toBe('final');
      expect(result.logs).toEqual(['test']);
      expect(result.error).toBe(null);
    });

    it('captures multiple log calls', async () => {
      const result = await executeRill(
        '"first" -> log\n"second" -> log\n"third"'
      );

      expect(result.status).toBe('success');
      expect(result.result).toBe('third');
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
      expect(result.result).toBe('yes');
    });

    it('executes loops', async () => {
      const result = await executeRill('range(1, 3) -> each { $ }');

      expect(result.status).toBe('success');
      expect(result.result).toContain('1');
    });

    it('executes closures', async () => {
      const result = await executeRill(
        '|x| { $x * 2 } => $double\n21 -> $double'
      );

      expect(result.status).toBe('success');
      expect(result.result).toBe('42');
    });

    it('formats arrays as JSON', async () => {
      const result = await executeRill('[1, 2, 3]');

      expect(result.status).toBe('success');
      expect(result.result).toBe('[\n  1,\n  2,\n  3\n]');
    });

    it('formats dicts as JSON', async () => {
      const result = await executeRill('[a: 1, b: 2]');

      expect(result.status).toBe('success');
      expect(result.result).toContain('"a": 1');
      expect(result.result).toContain('"b": 2');
    });

    it('executes piped operations', async () => {
      const result = await executeRill('[1, 2, 3] -> map { $ * 2 }');

      expect(result.status).toBe('success');
      expect(result.result).toContain('2');
      expect(result.result).toContain('4');
      expect(result.result).toContain('6');
    });
  });
});

describe('formatResult', () => {
  it('formats null as "null"', () => {
    expect(formatResult(null)).toBe('null');
  });

  it('formats string unquoted', () => {
    expect(formatResult('hello')).toBe('hello');
  });

  it('formats number as string', () => {
    expect(formatResult(42)).toBe('42');
    expect(formatResult(3.14)).toBe('3.14');
  });

  it('formats boolean as string', () => {
    expect(formatResult(true)).toBe('true');
    expect(formatResult(false)).toBe('false');
  });

  it('formats array as JSON', () => {
    const result = formatResult([1, 2, 3]);
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('formats dict as JSON', () => {
    const result = formatResult({ a: 1, b: 'test' });
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b": "test"');
  });

  it('formats nested structures as JSON', () => {
    const result = formatResult({ arr: [1, 2], obj: { x: 10 } });
    expect(result).toContain('"arr"');
    expect(result).toContain('"obj"');
  });

  it('formats empty array as JSON', () => {
    expect(formatResult([])).toBe('[]');
  });

  it('formats empty dict as JSON', () => {
    expect(formatResult({})).toBe('{}');
  });
});
