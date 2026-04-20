/**
 * Rill Language Constants
 * Single source of truth for shared constant values used across parser and runtime.
 */

// ============================================================
// VALID TYPE NAMES
// ============================================================

/**
 * All valid Rill type names accepted in type annotations, assertions,
 * shape field definitions, closure parameter types, and capture resolvers.
 *
 * Used by both:
 * - Parser: array iteration for token validation
 * - Runtime: Set-based O(1) membership lookup
 */
export const VALID_TYPE_NAMES = [
  'string',
  'number',
  'bool',
  'closure',
  'list',
  'dict',
  'tuple',
  'ordered',
  'vector',
  'any',
  'type',
  'iterator',
  'stream',
  'datetime',
  'duration',
  'code',
] as const;
