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
  'atom',
] as const;

// ============================================================
// ATOM NAMES
// ============================================================

/**
 * Names of the atoms core defines, without the `#` sigil.
 *
 * Covers the `#ok` status sentinel, the `#R001` and `#R999` registry
 * codes, the host-extension taxonomy (`#TIMEOUT`, `#AUTH`, ...),
 * `#IGNORE`, `#TYPE_MISMATCH`, and one halt-builder atom per `RILL-Rxxx`
 * error ID (underscore form). Shared by the parser and the runtime.
 */
export const BUILTIN_ATOM_NAMES: readonly string[] = Object.freeze([
  'ok',
  'R001',
  'TIMEOUT',
  'AUTH',
  'FORBIDDEN',
  'RATE_LIMIT',
  'QUOTA_EXCEEDED',
  'UNAVAILABLE',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_INPUT',
  'PROTOCOL',
  'DISPOSED',
  'IGNORE',
  'R999',
  'TYPE_MISMATCH',
  'RILL_R016',
  'RILL_R002',
  'RILL_R003',
  'RILL_R010',
  'RILL_R036',
  'RILL_R037',
  'RILL_R038',
  'RILL_R040',
  'RILL_R041',
  'RILL_R042',
  'RILL_R044',
  'RILL_R054',
  'RILL_R055',
  'RILL_R056',
  'RILL_R057',
  'RILL_R058',
  'RILL_R061',
  'RILL_R082',
  'RILL_R083',
  'RILL_R012',
  'RILL_R088',
  'RILL_R089',
  'RILL_R090',
  'RILL_R064',
  'RILL_R065',
  'RILL_R066',
  'RILL_R085',
  'RILL_R043',
  'RILL_R060',
  'RILL_R001',
  'RILL_R005',
  'RILL_R006',
  'RILL_R007',
  'RILL_R008',
  'RILL_R009',
  'RILL_R015',
]);

/**
 * The closed set of error codes a halt or `ctx.invalidate` may carry,
 * and the only names `on:` accepts: every builtin atom except the
 * `#ok` sentinel and `#IGNORE`.
 */
export const ERROR_CODE_NAMES: readonly string[] = Object.freeze(
  BUILTIN_ATOM_NAMES.filter((name) => name !== 'ok' && name !== 'IGNORE')
);
