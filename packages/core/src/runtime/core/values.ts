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
  isAtom,
  isIterator,
  isMap,
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
  | NativePlainObject
  | NativeMap;

/** Map with scalar keys (atom keys by name) and NativeValue values. */
export type NativeMap = Map<NativeValue, NativeValue>;

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
 * Maps convert to a JS Map with atom keys as their names.
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

  if (isMap(value)) {
    return new Map(
      value.entries.map(([k, v]): [NativeValue, NativeValue] => [
        isAtom(k) ? k.atom.name : toNativeValue(k),
        toNativeValue(v),
      ])
    );
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

export {
  RESERVED_DICT_METHODS,
  RESERVED_BRAND_KEYS,
  isReservedMethod,
  isReservedBrandKey,
} from './types/dict-keys.js';

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
