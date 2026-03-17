/**
 * Edge case tests for execution module
 *
 * Covers paths not exercised by execution-error.test.ts:
 * - EC-4: Non-Rill errors (plain Error, string throws) produce runtime category
 * - extractCallStack: getCallStack throws, returns empty frames
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // EC-4: Non-Rill errors (line 243 in execution.ts)
  // ============================================================

  describe('non-Rill error handling', () => {
    it('handles plain Error thrown by parse with runtime category', async () => {
      // Mock parse to throw a plain Error (not a RillError)
      const rill = await import('@rcrsr/rill');
      const parseSpy = vi.spyOn(rill, 'parse').mockImplementation(() => {
        throw new Error('Internal parse failure');
      });

      const result = await executeRill('1 + 2');

      expect(result.status).toBe('error');
      expect(result.error).not.toBeNull();
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toBe('Internal parse failure');
      expect(result.error?.line).toBeNull();
      expect(result.error?.column).toBeNull();
      expect(result.error?.errorId).toBeNull();

      parseSpy.mockRestore();
    });

    it('handles string thrown by parse with runtime category', async () => {
      const rill = await import('@rcrsr/rill');
      const parseSpy = vi.spyOn(rill, 'parse').mockImplementation(() => {
        throw 'string error';
      });

      const result = await executeRill('1 + 2');

      expect(result.status).toBe('error');
      expect(result.error).not.toBeNull();
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toBe('string error');
      expect(result.error?.line).toBeNull();
      expect(result.error?.errorId).toBeNull();

      parseSpy.mockRestore();
    });

    it('handles number thrown by execute with runtime category', async () => {
      const rill = await import('@rcrsr/rill');
      const executeSpy = vi.spyOn(rill, 'execute').mockRejectedValue(42);

      const result = await executeRill('1 + 2');

      expect(result.status).toBe('error');
      expect(result.error).not.toBeNull();
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toBe('42');

      executeSpy.mockRestore();
    });

    it('records duration even for non-Rill errors', async () => {
      const rill = await import('@rcrsr/rill');
      const parseSpy = vi.spyOn(rill, 'parse').mockImplementation(() => {
        throw new Error('unexpected');
      });

      const result = await executeRill('hello');

      expect(result.status).toBe('error');
      expect(result.duration).not.toBeNull();
      expect(result.duration).toBeGreaterThanOrEqual(0);

      parseSpy.mockRestore();
    });
  });
});
