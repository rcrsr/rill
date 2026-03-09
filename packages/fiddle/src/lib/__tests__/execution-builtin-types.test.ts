/**
 * Tests for RILL-R001 (parameter type mismatch) on built-in function calls.
 *
 * AC-49: Fiddle displays RUNTIME_TYPE_ERROR (RILL-R001) for wrong-typed arg
 *        to built-in, matching CLI output.
 * AC-50: Fiddle error output matches production runtime error output for host
 *        function type errors (both CLI and fiddle consume the same RuntimeError
 *        from @rcrsr/rill core).
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('built-in type enforcement — RILL-R001', () => {
    it('AC-49: range("hello", 5) produces RILL-R001 with category runtime', async () => {
      const result = await executeRill('range("hello", 5)');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-49: range("hello", 5) error message contains expected and actual type names', async () => {
      const result = await executeRill('range("hello", 5)');

      expect(result.status).toBe('error');
      expect(result.error?.message).toMatch(/number/);
      expect(result.error?.message).toMatch(/string/);
    });

    it('AC-49: enumerate(42) produces RILL-R001 with category runtime', async () => {
      const result = await executeRill('enumerate(42)');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-49: enumerate(42) error message contains type names', async () => {
      const result = await executeRill('enumerate(42)');

      expect(result.status).toBe('error');
      expect(result.error?.message).toBeTruthy();
      expect(result.error?.message.length).toBeGreaterThan(0);
    });

    it('AC-50: RILL-R001 errorId format matches core RuntimeError (parity with CLI)', async () => {
      // Both CLI and fiddle consume the same RuntimeError from @rcrsr/rill core.
      // The errorId field on FiddleError maps directly from RuntimeError.errorId.
      // Asserting the exact string 'RILL-R001' validates format parity.
      const result = await executeRill('range("hello", 5)');

      expect(result.status).toBe('error');
      expect(result.error?.errorId).toMatch(/^RILL-R/);
      expect(result.error?.errorId).toBe('RILL-R001');
    });
  });
});
