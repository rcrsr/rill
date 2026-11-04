/**
 * Integration tests for context resolver execution (Task 3.5)
 *
 * Tests executeRill with context scheme resolver wired to DEMO_CONTEXT_VALUES.
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

/** Build a resolver that returns a fixed value. */
function valueResolver(value: unknown): SchemeResolver {
  return (_resource: string) => ({
    kind: 'value' as const,
    value: value as import('@rcrsr/rill').RillValue,
  });
}

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('executeRill with context resolver', () => {
  describe('use<context:key> with present key resolves value', () => {
    it('resolves flat key timeout to its number value', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:timeout>:number => $t\n$t',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toHaveProperty(
        'value',
        DEMO_CONTEXT_VALUES['timeout']
      );
    });

    it('resolves flat key environment to its string value', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:environment>:string => $e\n$e',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toHaveProperty(
        'value',
        DEMO_CONTEXT_VALUES['environment']
      );
    });
  });

  describe('use<ext:mount.path> with wired resolver executes', () => {
    it('ext resolver with resource path resolves successfully', async () => {
      const config: FiddleResolverConfig = {
        resolvers: {
          ext: valueResolver('mount-path-value'),
        },
        configurations: { resolvers: {} },
      };
      const result = await executeRill(
        'use<ext:mount.path>:string => $p\n$p',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!)).toHaveProperty(
        'value',
        'mount-path-value'
      );
    });
  });

  describe('nested dot-path context key resolves correctly', () => {
    it('resolves limits.max_tokens via dot-path traversal', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:limits.max_tokens>:number => $m\n$m',
        config
      );
      expect(result.status).toBe('success');
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(JSON.parse(result.result!)).toHaveProperty(
        'value',
        limits['max_tokens']
      );
    });

    it('resolves limits.max_retries via dot-path traversal', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:limits.max_retries>:number => $r\n$r',
        config
      );
      expect(result.status).toBe('success');
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(JSON.parse(result.result!)).toHaveProperty(
        'value',
        limits['max_retries']
      );
    });
  });
});
