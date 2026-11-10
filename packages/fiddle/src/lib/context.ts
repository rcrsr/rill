/**
 * Demo context values for Rill Fiddle playground.
 *
 * Provides hardcoded context data for use<context:key> expressions.
 * Keys use dot-path format matching contextResolver traversal semantics.
 * All values are rill-serializable (strings, numbers, booleans).
 *
 * This constant is the single source of truth for playground context data.
 */

import { contextResolver } from '@rcrsr/rill';
import type { FiddleResolverConfig } from './execution.js';

// ============================================================
// DEMO CONTEXT VALUES
// ============================================================

/**
 * Hardcoded context values for the playground.
 *
 * Flat keys (e.g. "timeout") and nested dot-path keys (e.g. "limits.max_tokens")
 * are both supported by the contextResolver dot-path traversal.
 */
export const DEMO_CONTEXT_VALUES: Record<string, unknown> = {
  timeout: 30,
  debug: false,
  environment: 'playground',
  limits: {
    max_tokens: 4096,
    max_retries: 3,
  },
  model: 'gpt-4o',
};

// ============================================================
// RESOLVER CONFIG
// ============================================================

/**
 * Build the resolver config that wires the context scheme to
 * DEMO_CONTEXT_VALUES. The execution worker and the tests share this builder
 * so they cannot drift apart.
 */
export function buildContextResolverConfig(): FiddleResolverConfig {
  return {
    resolvers: {
      context: (resource: string) =>
        contextResolver(resource, DEMO_CONTEXT_VALUES),
    },
    configurations: { resolvers: { context: DEMO_CONTEXT_VALUES } },
  };
}
