/**
 * Error case tests for context resolver execution (Task 3.5)
 *
 * Tests FiddleError outcomes for missing keys, unknown schemes,
 * and throwing resolvers.
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
  describe('use<context:nonexistent> → FiddleError category runtime', () => {
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

  describe('use<unknown_scheme:resource> → FiddleError "No resolver registered"', () => {
    it('unregistered scheme error message contains "No resolver registered"', async () => {
      const config: FiddleResolverConfig = {
        resolvers: {},
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<unknown_scheme:resource>', config);
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
      expect(result.error!.message).toMatch(/No resolver registered/);
    });
  });

  describe('resolver callback throws → FiddleError via convertError', () => {
    it('throwing resolver error message contains the thrown message', async () => {
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
      expect(result.error!.message).toContain('resolver-failure-sentinel');
    });
  });
});
