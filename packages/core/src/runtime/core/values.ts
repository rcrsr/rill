/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 *
 * Structural operations (structureEquals, structureMatches, formatStructure,
 * inferStructure, commonType) live in types/operations.ts and are re-exported.
 *
 * Dispatch functions (inferType, formatValue) re-export from
 * types/registrations.ts protocol implementations.
 */

import type { RillTypeName } from '../../types.js';
import { VALID_TYPE_NAMES } from '../../constants.js';
import type { RillCallable } from './callable.js';
import {
  isCallable as _isCallableGuard,
  isDatetime,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isTypeValue,
  isVector,
} from './types/guards.js';
export { isEmpty } from './types/status.js';

/** isCallable guard widened to narrow to full RillCallable (not just CallableMarker) */
const isCallable = _isCallableGuard as (
  value: RillValue
) => value is RillCallable;
import {
  inferType as registryInferType,
  formatValue as registryFormatValue,
} from './types/registrations.js';
import { setDictField, typedKeyEntries } from './types/dict-keys.js';
import type {
  RillTypeValue,
  RillValue,
  TypeStructure,
} from './types/structures.js';

import type {
  DictStructure,
  OrderedStructure,
  TupleStructure,
} from './types/operations.js';
import { formatStructure, inferStructure } from './types/operations.js';

/** Infer the Rill type from a runtime value. Delegates to types/registrations. */
export const inferType: (value: RillValue) => string = registryInferType;

/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export function checkType(value: RillValue, expected: RillTypeName): boolean {
  return inferType(value) === expected;
}

/** Format a value for display. Delegates to types/registrations. */
export const formatValue: (value: RillValue) => string = registryFormatValue;

/**
 * Recursive native (host-side) value type.
 * Represents values that can cross the host/script boundary.
 */
export type NativeValue =
  | string
  | number
  | boolean
  | null
  | NativeArray
  | NativePlainObject;

/** Array of NativeValue */
export type NativeArray = NativeValue[];

/**
 * Plain object with string keys and NativeValue values.
 *
 * A dict with number or boolean keys additionally carries a reserved
 * `__rill_typed_keys` field: an array of `{ key, value }` entries holding the
 * original number/boolean key alongside its native value. String keys of the
 * same spelling (e.g. `"1"`) are unaffected and still surface as ordinary own
 * fields on the object. The field is omitted entirely when the dict has no
 * number/boolean keys.
 */
export type NativePlainObject = { [key: string]: NativeValue };

/** Structured result from toNative conversion */
export interface NativeResult {
  /** Rill type name -- matches RillTypeName, or 'iterator' for lazy sequences */
  rillTypeName: string;
  /** Human-readable type signature, e.g. "string", "list(number)", "|x: number| :string" */
  rillTypeSignature: string;
  /**
   * Native JS representation. Non-native types produce descriptor objects.
   * Dicts with number/boolean keys carry those keys under the reserved
   * `__rill_typed_keys` field; see {@link NativePlainObject}.
   */
  value: NativeValue;
}

/**
 * Convert a RillValue to a NativeResult for host consumption.
 * Non-representable types (closures, vectors, type values, iterators) produce descriptor objects.
 * Tuples convert to native arrays. Ordered values convert to plain objects.
 * Dict number/boolean keys surface under the reserved `__rill_typed_keys` field
 * (see {@link NativePlainObject}); string keys are unaffected.
 */
export function toNative(value: RillValue): NativeResult {
  const rillTypeName = inferType(value);
  const rillTypeSignature = formatStructure(inferStructure(value));
  const nativeValue = toNativeValue(value);
  return { rillTypeName, rillTypeSignature, value: nativeValue };
}

function toNativeValue(value: RillValue): NativeValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map(toNativeValue);
  }

  if (isCallable(value)) {
    return { signature: formatStructure(inferStructure(value)) };
  }

  if (isTuple(value)) {
    return value.entries.map(toNativeValue);
  }

  if (isOrdered(value)) {
    const result: { [key: string]: NativeValue } = {};
    for (const [k, v] of value.entries) {
      setDictField(result, k, toNativeValue(v));
    }
    return result;
  }

  if (isVector(value)) {
    return { model: value.model, dimensions: value.data.length };
  }

  if (isDatetime(value)) {
    return { unix: value.unix, iso: new Date(value.unix).toISOString() };
  }

  if (isDuration(value)) {
    return { months: value.months, ms: value.ms };
  }

  if (isTypeValue(value)) {
    return {
      name: value.typeName,
      signature: formatStructure(value.structure),
    };
  }

  if (isStream(value)) {
    const descriptor: NativePlainObject = {
      __type: 'stream',
      done: value.done,
    };
    const chunkType = (value as unknown as Record<string, unknown>)[
      '__rill_stream_chunk_type'
    ] as TypeStructure | undefined;
    const retType = (value as unknown as Record<string, unknown>)[
      '__rill_stream_ret_type'
    ] as TypeStructure | undefined;
    descriptor['chunkType'] = chunkType ? formatStructure(chunkType) : null;
    descriptor['resolutionType'] = retType ? formatStructure(retType) : null;
    return descriptor;
  }

  if (isIterator(value)) {
    return { done: value.done };
  }

  // Plain dict
  const dict = value as Record<string, RillValue>;
  const result: { [key: string]: NativeValue } = {};
  for (const [k, v] of Object.entries(dict)) {
    setDictField(result, k, toNativeValue(v));
  }
  // Number/boolean keys are held in a non-enumerable sidecar, so
  // Object.entries above skips them. Surface them, with their original
  // number/boolean key, under a reserved sidecar field.
  const typedEntries = typedKeyEntries(dict).map(({ key, value: v }) => ({
    key,
    value: toNativeValue(v),
  }));
  if (typedEntries.length > 0) {
    setDictField(result, '__rill_typed_keys', typedEntries);
  }
  return result;
}

/**
 * Reserved dict method names that cannot be overridden.
 * Must match the full key set of DICT_METHODS in
 * runtime/ext/builtins/methods/tables.ts (len, first, empty, eq, ne, keys,
 * values, entries). Kept as a literal array rather than an import because
 * core/ must not import from ext/; a runtime-level parity test guards
 * against drift between the two.
 */
export const RESERVED_DICT_METHODS = [
  'len',
  'first',
  'empty',
  'eq',
  'ne',
  'keys',
  'values',
  'entries',
] as const;

/**
 * Brand keys used internally to discriminate runtime value shapes
 * (atom, tuple, vector, datetime, duration, ordered, type value, callable).
 * A dict key colliding with one of these would let user data masquerade
 * as a branded runtime value, so dict literals reject them as keys.
 */
const RESERVED_BRAND_KEYS = [
  '__type',
  '__rill_atom',
  '__rill_tuple',
  '__rill_vector',
  '__rill_datetime',
  '__rill_duration',
  '__rill_ordered',
  '__rill_type',
  '__rill_stream',
  '__rill_stream_resolve',
  '__rill_stream_dispose',
  '__rill_stream_chunk_type',
  '__rill_stream_ret_type',
  '__rill_typed_keys',
] as const;

export { anyTypeValue } from './types/any-type.js';

/**
 * Convert a TypeStructure descriptor to a RillTypeValue.
 * Uses the TypeStructure's `kind` field as the `typeName`.
 * Falls back to 'any' for compound types that lack a direct RillTypeName mapping.
 */
export function structureToTypeValue(type: TypeStructure): RillTypeValue {
  const validNames: readonly string[] = VALID_TYPE_NAMES;
  return Object.freeze({
    __rill_type: true as const,
    typeName: (validNames.includes(type.kind)
      ? type.kind
      : 'any') as RillTypeName,
    structure: type,
  });
}

/**
 * Check if a type is a collection (dict, ordered, tuple) with defined
 * fields or elements. Used to decide if an empty collection can be
 * synthesized and hydrated.
 */
export function hasCollectionFields(type: TypeStructure): boolean {
  return (
    (type.kind === 'dict' &&
      (!!(type as DictStructure).fields ||
        !!(type as DictStructure).valueType)) ||
    (type.kind === 'ordered' &&
      (!!(type as OrderedStructure).fields ||
        !!(type as OrderedStructure).valueType)) ||
    (type.kind === 'tuple' &&
      (!!(type as TupleStructure).elements ||
        !!(type as TupleStructure).valueType))
  );
}

/** Check if a key name is reserved */
export function isReservedMethod(name: string): boolean {
  return (RESERVED_DICT_METHODS as readonly string[]).includes(name);
}

/** Check if a key name collides with a reserved brand key */
export function isReservedBrandKey(name: string): boolean {
  return (RESERVED_BRAND_KEYS as readonly string[]).includes(name);
}
