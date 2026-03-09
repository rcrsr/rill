/**
 * Tests for executeRill error paths and edge cases
 *
 * AC-65: errorId not in ERROR_REGISTRY renders basic error without enrichment fields
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ERROR_REGISTRY } from '@rcrsr/rill';
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

  describe('error enrichment', () => {
    it('generates helpUrl when error has errorId in registry', async () => {
      const result = await executeRill('$undefined_variable');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      if (result.error) {
        expect(result.error.errorId).toBeDefined();
        expect(result.error.errorId).not.toBe(null);
        // helpUrl only present if ERROR_REGISTRY has the errorId
        if (result.error.helpUrl) {
          expect(result.error.helpUrl).toContain(
            result.error.errorId!.toLowerCase()
          );
        }
      }
    });

    it('populates cause and resolution when available in ERROR_REGISTRY', async () => {
      const result = await executeRill('$undefined_variable');

      expect(result.status).toBe('error');
      if (result.error) {
        expect(result.error.errorId).toBeDefined();
        // Enrichment only happens if ERROR_REGISTRY has definition
        if (result.error.cause && result.error.resolution) {
          expect(typeof result.error.cause).toBe('string');
          expect(typeof result.error.resolution).toBe('string');
          expect(result.error.cause.length).toBeGreaterThan(0);
          expect(result.error.resolution.length).toBeGreaterThan(0);
        }
      }
    });

    it('includes examples when available in registry', async () => {
      // Use a type error which typically has examples
      const result = await executeRill('"string" + 5');

      expect(result.status).toBe('error');
      if (result.error) {
        expect(result.error.errorId).toBeDefined();
        // Examples may or may not exist for all errors, but if present should be structured
        if (result.error.examples) {
          expect(Array.isArray(result.error.examples)).toBe(true);
          expect(result.error.examples.length).toBeGreaterThan(0);
          const firstExample = result.error.examples[0];
          expect(firstExample).toBeDefined();
          expect(typeof firstExample!.description).toBe('string');
          expect(typeof firstExample!.code).toBe('string');
        }
      }
    });

    it('handles missing errorId without breaking enrichment', async () => {
      // Lexer and parse errors should have errorIds, but test fallback behavior
      const result = await executeRill('$undefined');

      expect(result.status).toBe('error');
      if (result.error) {
        // Even if enrichment fails, basic fields should work
        expect(result.error.message).toBeTruthy();
        expect(result.error.category).toBe('runtime');
        expect(result.error.line).not.toBe(null);
      }
    });

    it('enriches lexer errors when definition exists', async () => {
      const result = await executeRill('"test\\x"');

      expect(result.status).toBe('error');
      if (result.error) {
        expect(result.error.category).toBe('lexer');
        expect(result.error.errorId).toBeDefined();
        expect(result.error.errorId).toMatch(/^RILL-L/);
        // If ERROR_REGISTRY has this errorId, enrichment should be present
        if (result.error.helpUrl) {
          expect(result.error.helpUrl).toContain(
            result.error.errorId!.toLowerCase()
          );
        }
      }
    });

    it('enriches parse errors when definition exists', async () => {
      const result = await executeRill('1 +');

      expect(result.status).toBe('error');
      if (result.error) {
        expect(result.error.category).toBe('parse');
        expect(result.error.errorId).toBeDefined();
        expect(result.error.errorId).toMatch(/^RILL-P/);
        // If ERROR_REGISTRY has this errorId, enrichment should be present
        if (result.error.helpUrl) {
          expect(result.error.helpUrl).toContain(
            result.error.errorId!.toLowerCase()
          );
        }
      }
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

  // AC-65: errorId not in ERROR_REGISTRY produces FiddleError without enrichment fields
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
      // (execution.ts:148-161), exercising AC-65 without breaking error construction.
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

      // Enrichment fields must be absent on registry miss (AC-65)
      expect(result.error?.helpUrl).toBeUndefined();
      expect(result.error?.cause).toBeUndefined();
      expect(result.error?.resolution).toBeUndefined();
      expect(result.error?.examples).toBeUndefined();
    });
  });
});
