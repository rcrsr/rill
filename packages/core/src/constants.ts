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
 *
 * Note: 'type' is included here but excluded from VALID_RETURN_TYPES
 * in parser/helpers.ts because it is not a valid closure return type.
 */
export const VALID_TYPE_NAMES = [
  'string',
  'number',
  'bool',
  'closure',
  'list',
  'dict',
  'tuple',
  'vector',
  'shape',
  'any',
  'type',
] as const;
