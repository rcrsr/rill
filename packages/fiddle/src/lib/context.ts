/**
 * Demo context values for Rill Fiddle playground.
 *
 * Provides hardcoded context data for use<context:key> expressions.
 * Keys use dot-path format matching contextResolver traversal semantics.
 * All values are rill-serializable (strings, numbers, booleans).
 *
 * This constant is the single source of truth for playground context data.
 */

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
