/**
 * Fiddle parity tests for anonymous typed closure parameters
 *
 * Verifies executeRill handles |type|{ body } syntax identically to other
 * closure forms. Tests success, error, and boundary cases per spec IR-8.
 *
 * AC = Acceptance Criterion, EC = Error Contract
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('anonymous typed closure — success cases', () => {
    it('AC-12: |number| closure doubles piped number input', async () => {
      const result = await executeRill('5 -> |number|{ $ * 2 }');

      expect(result.status).toBe('success');
      expect(result.result).toBe('10');
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('AC-13: |string| closure uppercases piped string input', async () => {
      const result = await executeRill('"hello" -> |string|{ $ -> .upper }');

      expect(result.status).toBe('success');
      expect(result.result).toBe('HELLO');
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('AC-14: |string| closure in full pipe chain with log executes completely', async () => {
      const result = await executeRill(
        '"hello" -> |string|{ $ -> .upper } -> log'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toContain('HELLO');
      expect(result.error).toBe(null);
    });

    it('AC-15: bare { $ * 2 } and |any|{ $ * 2 }:any produce identical ExecutionState', async () => {
      const bareResult = await executeRill('5 -> { $ * 2 }');
      const typedResult = await executeRill('5 -> |any|{ $ * 2 }:any');

      expect(bareResult.status).toBe(typedResult.status);
      expect(bareResult.result).toBe(typedResult.result);
      expect(bareResult.logs).toEqual(typedResult.logs);
      expect(bareResult.error).toBe(typedResult.error);
    });

    it('AC-23: bare block and |any|:any forms match on string input', async () => {
      const bareResult = await executeRill('"hi" -> { $ }');
      const typedResult = await executeRill('"hi" -> |any|{ $ }:any');

      expect(bareResult.status).toBe(typedResult.status);
      expect(bareResult.result).toBe(typedResult.result);
      expect(bareResult.logs).toEqual(typedResult.logs);
    });
  });

  describe('anonymous typed closure — error cases', () => {
    it('AC-16/EC-7: |number| closure rejects string input with RILL-R001', async () => {
      const result = await executeRill('"hello" -> |number|{ $ * 2 }');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-17/EC-8: zero-param closure ||{ $ } referencing $ throws RILL-R005', async () => {
      const result = await executeRill('||{ $ } => $fn\n$fn()');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R005');
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-18/EC-8: named-param closure |x: string|{ $ } referencing $ throws RILL-R005', async () => {
      const result = await executeRill('|x: string|{ $ } => $fn\n$fn("hello")');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R005');
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-19: RILL-R001 error includes non-null helpUrl, cause, and resolution', async () => {
      const result = await executeRill('"hello" -> |number|{ $ * 2 }');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.helpUrl).toBeTruthy();
      expect(result.error?.cause).toBeTruthy();
      expect(result.error?.resolution).toBeTruthy();
    });

    it('EC-9: reserved type keyword as parameter name produces parse error', async () => {
      const result = await executeRill('|string: string|{ $string }');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('parse');
    });
  });

  describe('anonymous typed closure — boundary cases', () => {
    it('AC-20: |string| closure accepts empty string and returns empty result', async () => {
      const result = await executeRill('"" -> |string|{ $ }');

      expect(result.status).toBe('success');
      expect(result.result).toBe('');
      expect(result.error).toBe(null);
    });

    it('AC-21: |number| closure with return type annotation :number succeeds', async () => {
      const result = await executeRill('5 -> |number|{ $ * 2 }:number');

      expect(result.status).toBe('success');
      expect(result.result).toBe('10');
      expect(result.error).toBe(null);
    });

    it('AC-22: |number|{ "hello" }:number returns error for return type violation', async () => {
      const result = await executeRill('5 -> |number|{ "hello" }:number');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
    });
  });
});
