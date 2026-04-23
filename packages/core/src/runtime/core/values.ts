/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 *
 * Structural operations (structureEquals, structureMatches, formatStructure,
 * inferStructure, commonType) live in types/operations.ts and are re-exported.
 *
 * Dispatch functions (inferType, formatValue, deepEquals, serializeValue,
 * copyValue) re-export from type-registrations.ts protocol implementations.
 */

import type { RillTypeName } from '../../types.js';
import { VALID_TYPE_NAMES } from '../../constants.js';
import type { RillCallable } from './callable.js';
import {
  isCallable as _isCallableGuard,
  isDatetime,
  isDuration,
  isInvalid,
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isTypeValue,
  isVector,
} from './types/guards.js';

/** isCallable guard widened to narrow to full RillCallable (not just CallableMarker) */
const isCallable = _isCallableGuard as (
  value: RillValue
) => value is RillCallable;
import {
  inferType as registryInferType,
  formatValue as registryFormatValue,
  deepEquals as registryDeepEquals,
  serializeValue as registrySerializeValue,
} from './types/registrations.js';
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

/** Infer the Rill type from a runtime value. Delegates to type-registrations. */
export const inferType: (value: RillValue) => string = registryInferType;

/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export function checkType(value: RillValue, expected: RillTypeName): boolean {
  return inferType(value) === expected;
}

/**
 * Check if a value is truthy in Rill semantics.
 *
 * Status-aware: invalid values are never truthy (their halt semantics
 * ensure they never reach boolean consumers in valid programs, but
 * callbacks and guard blocks may surface one here).
 */
export function isTruthy(value: RillValue): boolean {
  if (isInvalid(value)) return false;
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (isTuple(value)) return value.entries.length > 0;
  if (isOrdered(value)) return value.entries.length > 0;
  if (isVector(value)) return true; // Vectors always truthy (non-empty by construction)
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if ('__type' in value && value.__type === 'callable') return true;
    return Object.keys(value).length > 0;
  }
  return true;
}

/**
 * Check if a value is structurally empty.
 *
 * Status-aware: invalid values are a distinct category (not empty).
 * Use `isVacant` when the caller wants "empty OR invalid" semantics
 * (the `??` trigger and `.?` probe use `isVacant`).
 */
export function isEmpty(value: RillValue): boolean {
  if (isInvalid(value)) return false;
  return !isTruthy(value);
}

/** Format a value for display. Delegates to type-registrations. */
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

/** Plain object with string keys and NativeValue values */
export type NativePlainObject = { [key: string]: NativeValue };

/** Structured result from toNative conversion */
export interface NativeResult {
  /** Rill type name -- matches RillTypeName, or 'iterator' for lazy sequences */
  rillTypeName: string;
  /** Human-readable type signature, e.g. "string", "list(number)", "|x: number| :string" */
  rillTypeSignature: string;
  /** Native JS representation. Non-native types produce descriptor objects. */
  value: NativeValue;
}

/** Serialize a Rill value for JSON transport. Delegates to type-registrations. */
export const serializeValue: (value: RillValue) => unknown =
  registrySerializeValue;

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
      result[k] = toNativeValue(v);
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
    result[k] = toNativeValue(v);
  }
  return result;
}

/** Deep structural equality for all Rill values. Delegates to type-registrations. */
export const deepEquals: (a: RillValue, b: RillValue) => boolean =
  registryDeepEquals;

/** Reserved dict method names that cannot be overridden */
export const RESERVED_DICT_METHODS = ['keys', 'values', 'entries'] as const;

/**
 * Singleton RillTypeValue representing the 'any' type.
 * Used as the default returnType for callable() factory and ApplicationCallable.
 */
export const anyTypeValue: RillTypeValue = Object.freeze({
  __rill_type: true as const,
  typeName: 'any' as const,
  structure: { kind: 'any' as const },
});

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
