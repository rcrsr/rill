/**
 * Shared positional-index helper for list, tuple, ordered, and string access.
 *
 * Callers check that the index is a number; this module validates that it is
 * an integer, wraps negative positions, and raises the out-of-bounds halt.
 */

import { ERROR_ATOMS, ERROR_IDS } from '../../../error-registry.js';
import { throwCatchableHostHalt, type TypeHaltSite } from './halt.js';

// ============================================================
// TYPES
// ============================================================

/** Container kind named in index error messages. */
export type IndexKind = 'List' | 'Tuple' | 'Ordered' | 'String';

// ============================================================
// INDEX RESOLUTION
// ============================================================

/**
 * Resolve a positional index against a container length.
 *
 * Halts catchably with #INVALID_INPUT when `index` is not an integer
 * (NaN and +/-Infinity included). A negative index counts from the end.
 *
 * @returns The in-range position, or `undefined` when out of range.
 */
export function findIndexPosition(
  index: number,
  length: number,
  kind: IndexKind,
  site: TypeHaltSite
): number | undefined {
  if (!Number.isInteger(index)) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `${kind} index must be an integer, got ${index}`
    );
  }
  const position = index < 0 ? length + index : index;
  return position >= 0 && position < length ? position : undefined;
}

/**
 * Raise a catchable out-of-bounds halt (RILL-R009) for a positional index.
 * The message reports the original, unwrapped index.
 */
export function throwIndexOutOfBounds(
  index: number,
  length: number,
  kind: IndexKind,
  site: TypeHaltSite
): never {
  return throwCatchableHostHalt(
    site,
    ERROR_ATOMS[ERROR_IDS.RILL_R009],
    `${kind} index out of bounds: ${index}`,
    { index, length }
  );
}
