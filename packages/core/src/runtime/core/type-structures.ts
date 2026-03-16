/**
 * Type Structure Definitions
 *
 * Defines the TypeStructure union (discriminated by `.kind`) and
 * associated value interfaces. These types form the foundation for
 * the type registration and dispatch system.
 *
 * The TypeStructure union mirrors the existing RillType union but uses
 * `.kind` as its discriminator instead of `.type`, enabling future
 * coexistence during migration.
 */

import type { RillTypeName } from '../../types.js';
import type { CallableMarker, FieldDescriptorMarker } from './markers.js';

/**
 * Field definition - describes a single field in a structural type.
 * Used by dict, tuple, ordered, and closure type descriptors.
 * Default detection: `field.defaultValue !== undefined`.
 *
 * Uses TypeStructure (not RillType) for the field's type descriptor.
 */
export interface RillFieldDef {
  name?: string | undefined;
  type: TypeStructure;
  defaultValue?: RillValue | undefined;
}

/**
 * Structural type descriptor - describes the shape of a value in the type system.
 * Discriminated by `.kind` (not `.type`).
 *
 * Includes all 12 built-in variants plus a catch-all for types without
 * parameterized structure (e.g. iterator).
 */
export type TypeStructure =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'bool' }
  | { kind: 'vector' }
  | { kind: 'type' }
  | { kind: 'any' }
  | {
      kind: 'dict';
      fields?: Record<string, RillFieldDef> | undefined;
      valueType?: TypeStructure | undefined;
    }
  | { kind: 'list'; element?: TypeStructure | undefined }
  | {
      kind: 'closure';
      params?: RillFieldDef[] | undefined;
      ret?: TypeStructure | undefined;
    }
  | {
      kind: 'tuple';
      elements?: RillFieldDef[] | undefined;
      valueType?: TypeStructure | undefined;
    }
  | {
      kind: 'ordered';
      fields?: RillFieldDef[] | undefined;
      valueType?: TypeStructure | undefined;
    }
  | { kind: 'union'; members: TypeStructure[] }
  | { kind: 'iterator' }
  | { kind: string; data?: unknown };

/**
 * Tuple type - represents positional unpacked arguments for closure invocation.
 * Created by the * (spread) operator from lists.
 * Entries are positional only.
 *
 * Note: In Rill, "tuple" refers to fixed-size argument packing (like function signatures),
 * while "list" refers to dynamic ordered collections ([1, 2, 3]).
 */
export interface RillTuple {
  readonly __rill_tuple: true;
  readonly entries: RillValue[];
}

/**
 * Ordered type - represents named key-value pairs with preserved insertion order.
 * Created by the * (spread) operator from dicts.
 * Entries may carry an optional third element (default value) when representing
 * closure parameter reflection via `.^input`.
 */
export interface RillOrdered {
  readonly __rill_ordered: true;
  readonly entries: [string, RillValue, RillValue?][];
}

/**
 * Vector type - represents dense numeric embeddings.
 * Immutable Float32Array with associated model name.
 */
export interface RillVector {
  readonly __rill_vector: true;
  readonly data: Float32Array;
  readonly model: string;
}

/**
 * Type value - represents a first-class type name at runtime.
 * Created when a type name expression (e.g. `string`, `number`) is evaluated.
 */
export interface RillTypeValue {
  readonly __rill_type: true;
  readonly typeName: RillTypeName;
  readonly structure: TypeStructure;
}

/**
 * Iterator type - represents a lazy sequence.
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value?: any - current value (absent when done)
 */
export interface RillIterator extends Record<string, RillValue> {
  readonly done: boolean;
  readonly next: CallableMarker;
  readonly value?: RillValue;
}

/** Any value that can flow through Rill */
export type RillValue =
  | string
  | number
  | boolean
  | null
  | RillValue[]
  | { [key: string]: RillValue }
  | CallableMarker
  | RillTuple
  | RillOrdered
  | RillVector
  | FieldDescriptorMarker
  | RillTypeValue;
