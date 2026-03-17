/**
 * Value Constructors
 *
 * Factory functions for creating Rill compound values (tuples, ordered,
 * vectors) and collection utilities (emptyForType, copyValue).
 *
 * Import constraints:
 * - Imports ONLY from ./structures.js and ./registrations.js
 * - No imports from values.ts or callable.ts
 */

import type {
  RillOrdered,
  RillTuple,
  RillValue,
  RillVector,
  TypeStructure,
} from './structures.js';
import { copyValue as registryCopyValue } from './registrations.js';
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

/** Copy a RillValue. Delegates to type-registrations. */
export const copyValue: (value: RillValue) => RillValue = registryCopyValue;
