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

import type { CallableMarker, FieldDescriptorMarker } from './markers.js';
import type {
  RillAtomValue,
  RillDatetime,
  RillDuration,
  RillIterator,
  RillOrdered,
  RillStream,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
  TypeStructure,
} from './structures.js';

/**
 * Type guard for RillAtomValue (`:atom` primitive).
 *
 * A `:atom` value carries a frozen atom identified by its name.
 * Compared by name via `deepEquals`.
 */
export function isAtom(value: unknown): value is RillAtomValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_atom' in value &&
    value.__rill_atom === true
  );
}

/** Internal: object and non-null (arrays included). */
export function isObjectRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Internal: field descriptor marker check. */
export function isFieldDescriptor(
  value: unknown
): value is FieldDescriptorMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_field_descriptor' in value &&
    value.__rill_field_descriptor === true
  );
}

/** Internal: object with a string `kind` (matches any TypeStructure member). */
function isTypeStructure(value: unknown): value is TypeStructure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string'
  );
}

/**
 * Internal: read a stream's chunk or resolution type sidecar. A sidecar that
 * is not a TypeStructure is treated as absent.
 */
export function getStreamTypeSidecar(
  stream: RillStream,
  which: 'chunk' | 'ret'
): TypeStructure | undefined {
  const fields: Record<string, unknown> = stream;
  const raw =
    which === 'chunk'
      ? fields['__rill_stream_chunk_type']
      : fields['__rill_stream_ret_type'];
  return isTypeStructure(raw) ? raw : undefined;
}

/** Internal: narrow a TypeStructure to the variant with the given kind. */
export function isStructureKind<K extends TypeStructure['kind']>(
  s: TypeStructure,
  kind: K
): s is Extract<TypeStructure, { kind: K }> {
  return s.kind === kind;
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
    value.__rill_datetime === true
  );
}

/** Type guard for RillDuration */
export function isDuration(value: RillValue): value is RillDuration {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_duration' in value &&
    value.__rill_duration === true
  );
}

/** Type guard for RillOrdered (named spread args) */
export function isOrdered(value: RillValue): value is RillOrdered {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    value.__rill_ordered === true
  );
}

/** Type guard for RillTypeValue */
export function isTypeValue(value: RillValue): value is RillTypeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_type' in value &&
    value.__rill_type === true
  );
}

/**
 * Entries of a RillOrdered value as `[key, value]` pairs, dropping the
 * optional third element (default value). Use this for multi-entry reads (`.keys()`, `.values()`,
 * `.entries()`); single-key lookups scan `.entries` directly instead of
 * calling this helper, to avoid the O(n) allocation it produces.
 */
export function orderedValueEntries(value: RillOrdered): [string, RillValue][] {
  return value.entries.map(([key, v]) => [key, v]);
}

/** Type guard for any callable */
export function isCallable(value: RillValue): value is CallableMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    value.__type === 'callable'
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
 * True only for plain rill dict values. Callables, tuples, ordered values,
 * vectors, datetimes, durations, atoms, type values, field descriptors,
 * streams, lists, and raw JavaScript functions are excluded, so a path walk
 * never reaches a callable's internal `fn`. A dict that merely looks like an
 * iterator (`done` plus a callable `next`) is still a dict. Unlike `isDict`,
 * this is internal and not part of the public API.
 */
export function isPlainDict(
  value: RillValue
): value is Record<string, RillValue> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  return !(
    isCallable(value) ||
    isTuple(value) ||
    isOrdered(value) ||
    isVector(value) ||
    isDatetime(value) ||
    isDuration(value) ||
    isAtom(value) ||
    isTypeValue(value) ||
    isStream(value) ||
    '__rill_field_descriptor' in value
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
    value.__rill_stream === true
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
  if (!('done' in value && typeof value['done'] === 'boolean')) return false;
  if (!('next' in value && isCallable(value['next']))) return false;
  // 'value' field only required when not done
  if (!value['done'] && !('value' in value)) return false;
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
export { isInvalid, isVacant, getStatus } from './status.js';
