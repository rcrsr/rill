/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 *
 * Structural operations (structureEquals, structureMatches, formatStructure,
 * inferStructure, commonType) live in types/operations.ts and are re-exported.
 *
 * Dispatch functions (inferType, formatValue) live in
 * types/registrations.ts and are exported from the package index.
 */

import type { RillTypeName } from '../../types.js';
import { isRillTypeName } from '../../types.js';
import {
  isCallable,
  isDatetime,
  isDict,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isStructureKind,
  isTuple,
  getStreamTypeSidecar,
  isTypeValue,
  isVector,
} from './types/guards.js';
export { isEmpty } from './types/status.js';
import { inferType } from './types/registrations.js';
import { setDictField } from './types/dict-keys.js';
import type {
  RillTypeValue,
  RillValue,
  TypeStructure,
} from './types/structures.js';

import { formatStructure, inferStructure } from './types/operations.js';
import { throwTypeHalt } from './types/halt.js';

/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export function checkType(value: RillValue, expected: RillTypeName): boolean {
  if (expected === 'any') return true;
  return inferType(value) === expected;
}

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
 * Dict keys are always strings.
 */
export type NativePlainObject = { [key: string]: NativeValue };

/** Structured result from toNative conversion */
export interface NativeResult {
  /** Rill type name -- matches RillTypeName, or 'iterator' for lazy sequences */
  rillTypeName: string;
  /** Human-readable type signature, e.g. "string", "list(number)", "fn(x: number):string" */
  rillTypeSignature: string;
  /**
   * Native JS representation. Non-native types produce descriptor objects.
   */
  value: NativeValue;
}

/**
 * Convert a RillValue to a NativeResult for host consumption.
 * Non-representable types (closures, vectors, type values, iterators) produce descriptor objects.
 * Tuples convert to native arrays. Ordered values convert to plain objects.
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
    const chunkType = getStreamTypeSidecar(value, 'chunk');
    const retType = getStreamTypeSidecar(value, 'ret');
    descriptor['chunkType'] = chunkType ? formatStructure(chunkType) : null;
    descriptor['resolutionType'] = retType ? formatStructure(retType) : null;
    return descriptor;
  }

  if (isIterator(value)) {
    return { done: value.done };
  }

  // Plain dict. Every other shape was handled above.
  if (!isDict(value)) {
    return throwTypeHalt(
      { fn: 'toNativeValue' },
      'INVALID_INPUT',
      `Cannot convert ${formatStructure(inferStructure(value))} to a native value`,
      'runtime',
      undefined,
      'host'
    );
  }
  const dict = value;
  const result: { [key: string]: NativeValue } = {};
  for (const [k, v] of Object.entries(dict)) {
    setDictField(result, k, toNativeValue(v));
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
 * (atom, tuple, vector, datetime, duration, ordered, type value, callable,
 * field descriptor). A dict key colliding with one of these would let user
 * data masquerade as a branded runtime value, so scripts cannot write them
 * as dict literal keys, type-constructor field names, or annotation keys.
 */
export const RESERVED_BRAND_KEYS = [
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
  '__rill_stream_head',
  '__rill_stream_dispose',
  '__rill_stream_chunk_type',
  '__rill_stream_ret_type',
  '__rill_field_descriptor',
] as const;

export { anyTypeValue } from './types/any-type.js';

/**
 * Convert a TypeStructure descriptor to a RillTypeValue.
 * Uses the TypeStructure's `kind` field as the `typeName`.
 * Falls back to 'any' for compound types that lack a direct RillTypeName mapping.
 */
export function structureToTypeValue(type: TypeStructure): RillTypeValue {
  return Object.freeze({
    __rill_type: true as const,
    typeName: isRillTypeName(type.kind) ? type.kind : 'any',
    structure: type,
  });
}

/**
 * Check if a type is a collection (dict, ordered, tuple) with defined
 * fields or elements. Used to decide if an empty collection can be
 * synthesized and hydrated.
 */
export function hasCollectionFields(type: TypeStructure): boolean {
  if (isStructureKind(type, 'dict')) return !!type.fields || !!type.valueType;
  if (isStructureKind(type, 'ordered')) {
    return !!type.fields || !!type.valueType;
  }
  if (isStructureKind(type, 'tuple')) {
    return !!type.elements;
  }
  return false;
}

/** Check if a key name is reserved */
export function isReservedMethod(name: string): boolean {
  return (RESERVED_DICT_METHODS as readonly string[]).includes(name);
}

/** Check if a key name collides with a reserved brand key */
export function isReservedBrandKey(name: string): boolean {
  return (RESERVED_BRAND_KEYS as readonly string[]).includes(name);
}
