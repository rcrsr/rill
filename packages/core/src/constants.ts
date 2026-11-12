/**
 * Rill Language Constants
 * Single source of truth for shared constant values used across parser and runtime.
 */

import { ERROR_ATOMS, ERROR_IDS } from './error-registry.js';

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
  ERROR_ATOMS[ERROR_IDS.RILL_R016],
  ERROR_ATOMS[ERROR_IDS.RILL_R002],
  ERROR_ATOMS[ERROR_IDS.RILL_R003],
  ERROR_ATOMS[ERROR_IDS.RILL_R010],
  ERROR_ATOMS[ERROR_IDS.RILL_R036],
  ERROR_ATOMS[ERROR_IDS.RILL_R037],
  ERROR_ATOMS[ERROR_IDS.RILL_R038],
  ERROR_ATOMS[ERROR_IDS.RILL_R040],
  ERROR_ATOMS[ERROR_IDS.RILL_R041],
  ERROR_ATOMS[ERROR_IDS.RILL_R042],
  ERROR_ATOMS[ERROR_IDS.RILL_R044],
  ERROR_ATOMS[ERROR_IDS.RILL_R054],
  ERROR_ATOMS[ERROR_IDS.RILL_R055],
  ERROR_ATOMS[ERROR_IDS.RILL_R056],
  ERROR_ATOMS[ERROR_IDS.RILL_R057],
  ERROR_ATOMS[ERROR_IDS.RILL_R058],
  ERROR_ATOMS[ERROR_IDS.RILL_R061],
  ERROR_ATOMS[ERROR_IDS.RILL_R082],
  ERROR_ATOMS[ERROR_IDS.RILL_R083],
  ERROR_ATOMS[ERROR_IDS.RILL_R012],
  ERROR_ATOMS[ERROR_IDS.RILL_R088],
  ERROR_ATOMS[ERROR_IDS.RILL_R089],
  ERROR_ATOMS[ERROR_IDS.RILL_R090],
  ERROR_ATOMS[ERROR_IDS.RILL_R064],
  ERROR_ATOMS[ERROR_IDS.RILL_R065],
  ERROR_ATOMS[ERROR_IDS.RILL_R066],
  ERROR_ATOMS[ERROR_IDS.RILL_R085],
  ERROR_ATOMS[ERROR_IDS.RILL_R043],
  ERROR_ATOMS[ERROR_IDS.RILL_R060],
  ERROR_ATOMS[ERROR_IDS.RILL_R001],
  ERROR_ATOMS[ERROR_IDS.RILL_R005],
  ERROR_ATOMS[ERROR_IDS.RILL_R006],
  ERROR_ATOMS[ERROR_IDS.RILL_R007],
  ERROR_ATOMS[ERROR_IDS.RILL_R008],
  ERROR_ATOMS[ERROR_IDS.RILL_R009],
  ERROR_ATOMS[ERROR_IDS.RILL_R015],
]);

/**
 * The closed set of error codes a halt or `ctx.invalidate` may carry,
 * and the only names `on:` accepts: every builtin atom except the
 * `#ok` sentinel and `#IGNORE`.
 */
export const ERROR_CODE_NAMES: readonly string[] = Object.freeze(
  BUILTIN_ATOM_NAMES.filter((name) => name !== 'ok' && name !== 'IGNORE')
);
