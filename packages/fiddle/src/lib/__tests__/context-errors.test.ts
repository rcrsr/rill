/**
 * Error case tests for context resolver execution (Task 3.5)
 *
 * Tests FiddleError outcomes for missing keys, unknown schemes,
 * throwing resolvers, empty resolver maps, and undefined config.
 * Covers AC-34, AC-35, AC-36, AC-37, AC-38.
 */

import { describe, it, expect } from 'vitest';
import { contextResolver } from '@rcrsr/rill';
import type { SchemeResolver } from '@rcrsr/rill';
import { executeRill, type FiddleResolverConfig } from '../execution.js';
import { DEMO_CONTEXT_VALUES } from '../context.js';

// ============================================================
// HELPERS
// ============================================================

/** Build a FiddleResolverConfig with the context resolver wired to DEMO_CONTEXT_VALUES. */
function buildContextConfig(): FiddleResolverConfig {
  return {
    resolvers: {
      context: (resource: string) =>
        contextResolver(resource, DEMO_CONTEXT_VALUES),
    },
    configurations: { resolvers: { context: DEMO_CONTEXT_VALUES } },
  };
}

// ============================================================
// ERROR CASE TESTS
// ============================================================

describe('executeRill context resolver — error cases', () => {
  describe('AC-FDL-5 (AC-34): use<context:nonexistent> → FiddleError category runtime', () => {
    it('missing key produces status error with category runtime', async () => {
      const config = buildContextConfig();
      const result = await executeRill('use<context:nonexistent_key>', config);
      expect(result.status).toBe('error');
      expect(result.error).not.toBeNull();
      expect(result.error!.category).toBe('runtime');
    });

    it('missing key error message names the missing key', async () => {
      const config = buildContextConfig();
      const result = await executeRill('use<context:missing_key>', config);
      expect(result.error!.message).toMatch(/missing_key/);
    });
  });

  describe('AC-FDL-6 (AC-35): use<unknown_scheme:resource> → FiddleError "No resolver registered"', () => {
    it('unregistered scheme produces FiddleError', async () => {
      const result = await executeRill('use<unknown_scheme:resource>');
      expect(result.status).toBe('error');
      expect(result.error).not.toBeNull();
      expect(result.error!.category).toBe('runtime');
    });

    it('unregistered scheme error message contains "No resolver registered"', async () => {
      const config: FiddleResolverConfig = {
        resolvers: {},
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<unknown_scheme:resource>', config);
      expect(result.error!.message).toMatch(/No resolver registered/);
    });
  });

  describe('AC-FDL-7 (AC-36): resolver callback throws → FiddleError via convertError', () => {
    it('throwing resolver produces FiddleError with category runtime', async () => {
      const throwingResolver: SchemeResolver = () => {
        throw new Error('resolver-failure-sentinel');
      };
      const config: FiddleResolverConfig = {
        resolvers: { ext: throwingResolver },
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<ext:example>', config);
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
    });

    it('throwing resolver error message contains the thrown message', async () => {
      const throwingResolver: SchemeResolver = () => {
        throw new Error('resolver-failure-sentinel');
      };
      const config: FiddleResolverConfig = {
        resolvers: { ext: throwingResolver },
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<ext:example>', config);
      expect(result.error!.message).toContain('resolver-failure-sentinel');
    });
  });

  describe('AC-FDL-8 (AC-37): empty resolvers record → FiddleError for unregistered scheme', () => {
    it('empty resolvers with use<context:key> produces FiddleError', async () => {
      const config: FiddleResolverConfig = {
        resolvers: {},
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<context:timeout>', config);
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
    });
  });

  describe('AC-FDL-9 (AC-38): undefined resolverConfig, no use<> → identical behavior', () => {
    it('undefined config produces same result as omitting config', async () => {
      const withUndefined = await executeRill('"hello"', undefined);
      const withOmit = await executeRill('"hello"');
      expect(withUndefined.status).toBe(withOmit.status);
      expect(withUndefined.result).toBe(withOmit.result);
    });

    it('undefined config script runs without error', async () => {
      const result = await executeRill('1 + 1', undefined);
      expect(result.status).toBe('success');
    });
  });
});
