/**
 * Tests for RILL-R001 (parameter type mismatch) on built-in function calls.
 *
 * Fiddle displays RUNTIME_TYPE_ERROR (RILL-R001) for wrong-typed arg
 *        to built-in, matching CLI output.
 * Fiddle error output matches production runtime error output for host
 *        function type errors (both CLI and fiddle consume the same RuntimeError
 *        from @rcrsr/rill core).
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('built-in type enforcement — RILL-R001', () => {
    it('range("hello", 5) produces RILL-R001 with category runtime', async () => {
      const result = await executeRill('range("hello", 5)');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toMatch(/number/);
      expect(result.error?.message).toMatch(/string/);
    });
  });
});
