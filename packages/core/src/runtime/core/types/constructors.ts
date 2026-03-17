/**
 * Value Constructors
 *
 * Factory functions for creating Rill compound values (tuples, ordered,
 * vectors) and collection utilities (emptyForType, copyValue).
 *
 * Import constraints:
 * - Imports from ./structures.js and ./guards.js
 * - No imports from values.ts or callable.ts
 */

import type {
  RillOrdered,
  RillTuple,
  RillValue,
  RillVector,
  TypeStructure,
} from './structures.js';
import {
  isCallable,
  isIterator,
  isOrdered,
  isTuple,
  isTypeValue,
  isVector,
} from './guards.js';
import { RuntimeError } from '../../../types.js';

/**
 * Create ordered from entries array (named, preserves insertion order).
 * Entries may be 2-element [name, value] or 3-element [name, value, default]
 * tuples; the third element carries a default value for `.^input` reflection.
 */
export function createOrdered(
  entries: [string, RillValue, RillValue?][]
): RillOrdered {
  return Object.freeze({ __rill_ordered: true, entries: [...entries] });
}

/** Create tuple from entries array (positional, preserves order) */
export function createTuple(entries: RillValue[]): RillTuple {
  return Object.freeze({ __rill_tuple: true, entries: [...entries] });
}

/**
 * Create vector from Float32Array with model name.
 * @throws {RuntimeError} RILL-R074 if data.length is 0 (zero-dimension vectors not allowed)
 */
export function createVector(data: Float32Array, model: string): RillVector {
  if (data.length === 0) {
    throw new RuntimeError(
      'RILL-R074',
      'Vector data must have at least one dimension'
    );
  }
  return { __rill_vector: true, data, model };
}

/**
 * Create an empty collection value matching the given TypeStructure.
 * Assumes the type is dict, ordered, or tuple.
 */
export function emptyForType(type: TypeStructure): RillValue {
  if (type.kind === 'dict') return {};
  if (type.kind === 'ordered') return createOrdered([]);
  if (type.kind === 'tuple') return createTuple([]);
  return {};
}

/**
 * Copy a RillValue.
 * Primitives and immutable compound values return the same reference.
 * Mutable values (list, dict) copy recursively.
 * Iterators return the same reference (not meaningfully copyable).
 */
export function copyValue(value: RillValue): RillValue {
  if (value === null || typeof value !== 'object') return value;
  // Immutable compound types
  if (
    isTuple(value) ||
    isOrdered(value) ||
    isVector(value) ||
    isTypeValue(value) ||
    isCallable(value)
  )
    return value;
  // field_descriptor: immutable (no guard exported from guards.ts)
  if (
    '__rill_field_descriptor' in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)['__rill_field_descriptor'] === true
  )
    return value;
  // Mutable list (Array but not tuple/ordered — those were checked above)
  if (Array.isArray(value)) return (value as RillValue[]).map(copyValue);
  // Iterator: mutable but opaque — return same reference
  if (isIterator(value)) return value;
  // Mutable dict
  const dict = value as Record<string, RillValue>;
  const copy: Record<string, RillValue> = {};
  for (const [k, v] of Object.entries(dict)) copy[k] = copyValue(v);
  return copy;
}
