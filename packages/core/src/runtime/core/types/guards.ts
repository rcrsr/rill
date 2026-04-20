/**
 * Type Guards
 *
 * Centralized type guard functions for all Rill value types.
 * Extracted from values.ts and callable.ts to break the circular
 * dependency between those modules.
 *
 * Import constraints:
 * - Imports ONLY from ./markers.js and ./structures.js
 * - No imports from values.ts or callable.ts
 */

import type { CallableMarker } from './markers.js';
import type {
  RillCodeValue,
  RillDatetime,
  RillDuration,
  RillIterator,
  RillOrdered,
  RillStream,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
} from './structures.js';

/**
 * Type guard for RillCodeValue (`:code` primitive).
 *
 * A `:code` value carries an interned atom from the atom registry.
 * Compared by atom identity via `deepEquals`.
 */
export function isCode(value: RillValue): value is RillCodeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_code' in value &&
    (value as RillCodeValue).__rill_code === true
  );
}

/** Type guard for RillTuple (spread args) */
export function isTuple(value: RillValue): value is RillTuple {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_tuple' in value &&
    value.__rill_tuple === true
  );
}

/** Type guard for RillVector */
export function isVector(value: RillValue): value is RillVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_vector' in value &&
    value.__rill_vector === true
  );
}

/** Type guard for RillDatetime */
export function isDatetime(value: RillValue): value is RillDatetime {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_datetime' in value &&
    (value as RillDatetime).__rill_datetime === true
  );
}

/** Type guard for RillDuration */
export function isDuration(value: RillValue): value is RillDuration {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_duration' in value &&
    (value as RillDuration).__rill_duration === true
  );
}

/** Type guard for RillOrdered (named spread args) */
export function isOrdered(value: RillValue): value is RillOrdered {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as RillOrdered).__rill_ordered === true
  );
}

/** Type guard for RillTypeValue */
export function isTypeValue(value: RillValue): value is RillTypeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_type' in value &&
    (value as RillTypeValue).__rill_type === true
  );
}

/** Type guard for any callable */
export function isCallable(value: RillValue): value is CallableMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    (value as CallableMarker).__type === 'callable'
  );
}

/** Type guard for dict (plain object, not array, not callable, not tuple) */
export function isDict(value: RillValue): value is Record<string, RillValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isCallable(value) &&
    !isTuple(value)
  );
}

/**
 * Type guard for RillStream (async lazy sequence with resolution).
 * A stream has the __rill_stream discriminator set to true.
 * Must precede isIterator in dispatch order because streams
 * satisfy the iterator structural shape.
 */
export function isStream(value: RillValue): value is RillStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_stream' in value &&
    (value as RillStream).__rill_stream === true
  );
}

/** Public API alias for isStream */
export const isRillStream: (value: RillValue) => value is RillStream = isStream;

/**
 * Type guard for Rill iterator (lazy sequence).
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value: any (only required when not done) - current element
 */
export function isIterator(value: RillValue): value is RillIterator {
  if (!isDict(value)) return false;
  const dict = value as Record<string, RillValue>;
  if (!('done' in dict && typeof dict['done'] === 'boolean')) return false;
  if (!('next' in dict && isCallable(dict['next']))) return false;
  // 'value' field only required when not done
  if (!dict['done'] && !('value' in dict)) return false;
  return true;
}

// ============================================================
// STATUS-AWARE PREDICATES (re-exported from status.ts)
// ============================================================

/**
 * Re-exports for `isInvalid`, `isVacant`, and `getStatus`.
 *
 * Canonical implementations live in `./status.js` (task 1.1). This
 * module re-exports them so downstream consumers import status-aware
 * predicates from the central guards module alongside the structural
 * type guards.
 */
export { isInvalid, isVacant, getStatus, emptyStatus } from './status.js';
