/**
 * Tests for executeRill error paths and edge cases
 *
 * errorId not in ERROR_REGISTRY renders basic error without enrichment fields
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ERROR_REGISTRY, getHelpUrl, VERSION } from '@rcrsr/rill';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('error paths', () => {
    it('handles invalid syntax with LexerError', async () => {
      const result = await executeRill('"test\\x"');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.logs).toEqual([]);
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
      const result = await executeRill('range(1, 5) -> seq({ $undefined })');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });

    it('reports an undefined variable inside a called closure', async () => {
      const result = await executeRill('|| { $undefined } => $bad\n$bad()');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.errorId).toBe('RILL-R005');
    });
  });

  describe('error enrichment', () => {
    it('generates helpUrl for a runtime error whose errorId is in the registry', async () => {
      const result = await executeRill('$undefined_variable');

      expect(result.status).toBe('error');
      expect(result.error?.errorId).toBe('RILL-R005');
      expect(ERROR_REGISTRY.has('RILL-R005')).toBe(true);
      expect(result.error?.helpUrl).toBe(getHelpUrl('RILL-R005', VERSION));
      expect(result.error?.helpUrl).toMatch(/#rill-r005$/);
    });

    it('populates cause and resolution from the registry definition', async () => {
      const result = await executeRill('$undefined_variable');
      const definition = ERROR_REGISTRY.get('RILL-R005');

      expect(result.status).toBe('error');
      expect(definition).toBeDefined();
      expect(result.error?.cause).toBe(definition!.cause);
      expect(result.error?.resolution).toBe(definition!.resolution);
    });

    it('includes the registry examples', async () => {
      const result = await executeRill('$undefined_variable');
      const definition = ERROR_REGISTRY.get('RILL-R005');

      expect(result.status).toBe('error');
      expect(definition).toBeDefined();
      expect(definition!.examples?.length).toBeGreaterThan(0);
      expect(result.error?.examples).toEqual(definition!.examples);
    });

    it('enriches lexer errors with the registry help url', async () => {
      const result = await executeRill('"test\\x"');
      const errorId = result.error?.errorId;

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('lexer');
      expect(errorId).toMatch(/^RILL-L/);
      expect(ERROR_REGISTRY.has(errorId!)).toBe(true);
      expect(result.error?.helpUrl).toBe(getHelpUrl(errorId!, VERSION));
    });

    it('enriches parse errors with the registry help url', async () => {
      const result = await executeRill('1 +');
      const errorId = result.error?.errorId;

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('parse');
      expect(errorId).toMatch(/^RILL-P/);
      expect(ERROR_REGISTRY.has(errorId!)).toBe(true);
      expect(result.error?.helpUrl).toBe(getHelpUrl(errorId!, VERSION));
    });
  });

  // errorId not in ERROR_REGISTRY produces FiddleError without enrichment fields
  describe('registry-miss fallback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('produces FiddleError without enrichment fields when errorId is not in registry', async () => {
      // $undefined_variable triggers RILL-R005 ("Variable {name} is not defined").
      //
      // The core calls ERROR_REGISTRY.get('RILL-R005') during error construction in
      // error-classes.ts, and convertError calls it again for enrichment.
      // We allow the first call to pass through (so the core can build the error),
      // then return undefined on all subsequent calls for RILL-R005.
      // This simulates a registry miss exclusively in convertError's enrichment lookup
      // (execution.ts:148-161), without breaking error construction.
      const realGet = ERROR_REGISTRY.get.bind(ERROR_REGISTRY);
      let constructionCallSeen = false;
      vi.spyOn(ERROR_REGISTRY, 'get').mockImplementation((errorId: string) => {
        if (errorId === 'RILL-R005') {
          if (!constructionCallSeen) {
            constructionCallSeen = true;
            return realGet(errorId);
          }
          // Subsequent calls simulate the registry miss in convertError
          return undefined;
        }
        return realGet(errorId);
      });

      const result = await executeRill('$undefined_variable');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);

      // Basic fields must be present
      expect(result.error?.message).toBeTruthy();
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.errorId).toBe('RILL-R005');

      // Enrichment fields must be absent on registry miss
      expect(result.error?.helpUrl).toBeUndefined();
      expect(result.error?.cause).toBeUndefined();
      expect(result.error?.resolution).toBeUndefined();
      expect(result.error?.examples).toBeUndefined();
    });
  });
});
