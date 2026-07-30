/**
 * Fiddle parity tests for anonymous typed closure parameters
 *
 * Verifies executeRill handles |type|{ body } syntax identically to other
 * closure forms. Tests success, error, and boundary cases.
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('anonymous typed closure — success cases', () => {
    it('|number| closure doubles piped number input', async () => {
      const result = await executeRill('5 -> |number|{ $ * 2 }');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 10,
      });
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('|string| closure uppercases piped string input', async () => {
      const result = await executeRill('"hello" -> |string|{ $ -> .upper }');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: 'HELLO',
      });
      expect(result.error).toBe(null);
      expect(result.logs).toEqual([]);
    });

    it('|string| closure in full pipe chain with log executes completely', async () => {
      const result = await executeRill(
        '"hello" -> |string|{ $ -> .upper } -> log'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toContain('HELLO');
      expect(result.error).toBe(null);
    });

    it('bare { $ * 2 } and |any|{ $ * 2 }:any produce identical ExecutionState', async () => {
      const bareResult = await executeRill('5 -> { $ * 2 }');
      const typedResult = await executeRill('5 -> |any|{ $ * 2 }:any');

      expect(bareResult.status).toBe(typedResult.status);
      expect(bareResult.result).toBe(typedResult.result);
      expect(bareResult.logs).toEqual(typedResult.logs);
      expect(bareResult.error).toBe(typedResult.error);
    });

    it('bare block and |any|:any forms match on string input', async () => {
      const bareResult = await executeRill('"hi" -> { $ }');
      const typedResult = await executeRill('"hi" -> |any|{ $ }:any');

      expect(bareResult.status).toBe(typedResult.status);
      expect(bareResult.result).toBe(typedResult.result);
      expect(bareResult.logs).toEqual(typedResult.logs);
    });
  });

  describe('anonymous typed closure — error cases', () => {
    it('|number| closure rejects string input with RILL-R001', async () => {
      const result = await executeRill('"hello" -> |number|{ $ * 2 }');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.category).toBe('runtime');
    });

    it('zero-param closure ||{ $ } referencing $ throws RILL-R005', async () => {
      const result = await executeRill('||{ $ } => $fn\n$fn()');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R005');
      expect(result.error?.category).toBe('runtime');
    });

    it('named-param closure |x: string|{ $ } referencing $ throws RILL-R005', async () => {
      const result = await executeRill('|x: string|{ $ } => $fn\n$fn("hello")');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R005');
      expect(result.error?.category).toBe('runtime');
    });

    it('RILL-R001 error includes non-null helpUrl, cause, and resolution', async () => {
      const result = await executeRill('"hello" -> |number|{ $ * 2 }');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.errorId).toBe('RILL-R001');
      expect(result.error?.helpUrl).toBeTruthy();
      expect(result.error?.cause).toBeTruthy();
      expect(result.error?.resolution).toBeTruthy();
    });

    it('reserved type keyword as parameter name produces parse error', async () => {
      const result = await executeRill('|string: string|{ $string }');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('parse');
    });
  });

  describe('anonymous typed closure — boundary cases', () => {
    it('|string| closure accepts empty string and returns empty result', async () => {
      const result = await executeRill('"" -> |string|{ $ }');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'string',
        rillTypeSignature: 'string',
        value: '',
      });
      expect(result.error).toBe(null);
    });

    it('|number| closure with return type annotation :number succeeds', async () => {
      const result = await executeRill('5 -> |number|{ $ * 2 }:number');

      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 10,
      });
      expect(result.error).toBe(null);
    });

    it('|number|{ "hello" }:number returns error for return type violation', async () => {
      const result = await executeRill('5 -> |number|{ "hello" }:number');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
    });
  });
});
