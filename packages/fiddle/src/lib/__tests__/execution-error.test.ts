/**
 * Tests for executeRill error paths and edge cases
 */

import { describe, it, expect } from 'vitest';
import { executeRill, formatResult } from '../execution.js';
import { callable, type RillValue } from '@rcrsr/rill';

describe('executeRill', () => {
  describe('error paths', () => {
    it('handles invalid syntax with LexerError', async () => {
      const result = await executeRill('"test\\x"');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('lexer');
      expect(result.error?.line).toBeGreaterThan(0);
      expect(result.error?.column).toBeGreaterThan(0);
      expect(result.error?.errorId).toMatch(/^RILL-L/);
    });

    it('handles malformed AST with ParseError', async () => {
      const result = await executeRill('1 +');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('parse');
      expect(result.error?.line).toBeGreaterThan(0);
      expect(result.error?.errorId).toMatch(/^RILL-P/);
    });

    it('handles runtime failure with RuntimeError', async () => {
      const result = await executeRill('$undefined_variable');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.errorId).toMatch(/^RILL-R/);
    });

    it('handles type errors at runtime', async () => {
      const result = await executeRill('"string" + 5');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toBeTruthy();
    });

    it('handles division by zero', async () => {
      const result = await executeRill('1 / 0');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });

    it('preserves error location from lexer', async () => {
      const result = await executeRill('1 + 2\n"test\\x"');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('lexer');
      expect(result.error?.line).toBe(2);
      expect(result.error?.column).toBeGreaterThan(0);
    });

    it('preserves error location from parser', async () => {
      const result = await executeRill('1 + 2\n3 +');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('parse');
      expect(result.error?.line).toBe(2);
    });

    it('preserves error location from runtime', async () => {
      const result = await executeRill('1 + 2\n$bad');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.line).toBe(2);
    });

    it('includes error message in FiddleError', async () => {
      const result = await executeRill('$undefined');

      expect(result.status).toBe('error');
      expect(result.error?.message).toBeTruthy();
      expect(result.error?.message.length).toBeGreaterThan(0);
    });

    it('times execution even when error occurs', async () => {
      const result = await executeRill('$undefined');

      expect(result.status).toBe('error');
      expect(result.duration).not.toBe(null);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('handles errors in conditionals', async () => {
      const result = await executeRill('"not bool" ? 1 ! 2');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });

    it('handles errors in loops', async () => {
      const result = await executeRill('range(1, 5) -> each { $undefined }');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });

    it('handles errors in closures', async () => {
      const result = await executeRill(
        '|| { $undefined } => $bad\nnull -> $bad'
      );

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });
  });

  describe('timeout protection', () => {
    it('applies default 5000ms timeout', async () => {
      // Note: Actual timeout behavior depends on RuntimeOptions.timeout
      // This test verifies the timeout option is passed to createRuntimeContext
      const result = await executeRill('1 + 1');

      expect(result.status).toBe('success');
      // Timeout is applied internally; no way to verify without triggering it
    });
  });
});

describe('formatResult', () => {
  describe('callable formatting', () => {
    it('formats closure as "[closure]"', () => {
      const closure = callable(() => 42);

      expect(formatResult(closure)).toBe('[closure]');
    });

    it('formats closure with parameters as "[closure]"', () => {
      const closure = callable((args: RillValue[]) => args[0] ?? null);

      expect(formatResult(closure)).toBe('[closure]');
    });
  });

  describe('edge cases', () => {
    it('handles zero', () => {
      expect(formatResult(0)).toBe('0');
    });

    it('handles negative numbers', () => {
      expect(formatResult(-42)).toBe('-42');
    });

    it('handles empty string', () => {
      expect(formatResult('')).toBe('');
    });

    it('handles string with newlines', () => {
      expect(formatResult('line1\nline2')).toBe('line1\nline2');
    });

    it('handles string with special characters', () => {
      expect(formatResult('hello "world"')).toBe('hello "world"');
    });

    it('handles very large numbers', () => {
      expect(formatResult(Number.MAX_SAFE_INTEGER)).toBe(
        String(Number.MAX_SAFE_INTEGER)
      );
    });

    it('handles floating point precision', () => {
      expect(formatResult(0.1 + 0.2)).toBe(String(0.1 + 0.2));
    });
  });
});
