/**
 * Integration tests for context resolver execution (Task 3.5)
 *
 * Tests executeRill with context scheme resolver wired to DEMO_CONTEXT_VALUES.
 * Covers AC-30, AC-31, AC-32, AC-33, AC-39.
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
  describe('AC-FDL-1 (AC-30): use<context:key> with present key resolves value', () => {
    it('resolves flat key timeout to its number value', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:timeout>:number => $t\n$t',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!).value).toBe(
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
      expect(JSON.parse(result.result!).value).toBe(
        DEMO_CONTEXT_VALUES['environment']
      );
    });
  });

  describe('AC-FDL-2 (AC-31): use<ext:mount.path> with wired resolver executes', () => {
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
      expect(JSON.parse(result.result!).value).toBe('mount-path-value');
    });
  });

  describe('AC-FDL-3 (AC-32): Fiddle loads and executes successfully', () => {
    it('executeRill returns success for a simple script', async () => {
      const result = await executeRill('1 + 2');
      expect(result.status).toBe('success');
    });

    it('executeRill with context config returns success for simple script', async () => {
      const config = buildContextConfig();
      const result = await executeRill('1 + 2', config);
      expect(result.status).toBe('success');
    });
  });

  describe('AC-FDL-4 (AC-33): script without use<> runs identically', () => {
    it('produces same result with and without context resolver config', async () => {
      const withoutConfig = await executeRill('42 => $x\n$x * 2');
      const withConfig = await executeRill(
        '42 => $x\n$x * 2',
        buildContextConfig()
      );
      expect(withConfig.status).toBe(withoutConfig.status);
      expect(withConfig.result).toBe(withoutConfig.result);
    });

    it('log capture works identically with context config present', async () => {
      const config = buildContextConfig();
      const result = await executeRill('log("hello")\n1', config);
      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['hello']);
    });
  });

  describe('AC-FDL-10 (AC-39): nested dot-path context key resolves correctly', () => {
    it('resolves limits.max_tokens via dot-path traversal', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:limits.max_tokens>:number => $m\n$m',
        config
      );
      expect(result.status).toBe('success');
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(JSON.parse(result.result!).value).toBe(limits['max_tokens']);
    });

    it('resolves limits.max_retries via dot-path traversal', async () => {
      const config = buildContextConfig();
      const result = await executeRill(
        'use<context:limits.max_retries>:number => $r\n$r',
        config
      );
      expect(result.status).toBe('success');
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(JSON.parse(result.result!).value).toBe(limits['max_retries']);
    });
  });
});
