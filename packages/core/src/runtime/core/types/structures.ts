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

import type { RillTypeName } from '../../../types.js';
import type { CallableMarker, FieldDescriptorMarker } from './markers.js';
import type { RillAtom } from './atom-registry.js';
import type { RillStatus } from './status.js';

export type { RillStatus } from './status.js';

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
  annotations?: Record<string, RillValue>;
}

/**
 * Structural type descriptor - describes the shape of a value in the type system.
 * Discriminated by `.kind` (not `.type`).
 *
 * Includes all 13 built-in variants plus a catch-all for types without
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
  | { kind: 'stream'; chunk?: TypeStructure; ret?: TypeStructure }
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
  readonly status?: RillStatus;
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
  readonly status?: RillStatus;
}

/**
 * Vector type - represents dense numeric embeddings.
 * Immutable Float32Array with associated model name.
 */
export interface RillVector {
  readonly __rill_vector: true;
  readonly data: Float32Array;
  readonly model: string;
  readonly status?: RillStatus;
}

/**
 * Datetime type - represents a UTC instant in time.
 * Stored as integer milliseconds since Unix epoch (1970-01-01T00:00:00Z).
 */
export interface RillDatetime {
  readonly __rill_datetime: true;
  readonly unix: number;
  readonly status?: RillStatus;
}

/**
 * Duration type - represents a calendar-aware time span.
 * Split into months (calendar) and ms (clock) components,
 * both non-negative integers.
 */
export interface RillDuration {
  readonly __rill_duration: true;
  readonly months: number;
  readonly ms: number;
  readonly status?: RillStatus;
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

/**
 * Atom primitive - represents a first-class error-code atom.
 * The 16th built-in primitive type.
 *
 * A `:atom` value holds a reference to a registered atom from the atom
 * registry. Authored in scripts as `#NAME` (uppercase). Compared by
 * identity: `#TIMEOUT === #TIMEOUT` because `resolveAtom` interns a
 * single frozen RillAtom instance per name.
 *
 * The optional `status` sidecar lets a `:atom` value carry invalidation
 * metadata (uncommon: atoms themselves are valid by default).
 */
export interface RillAtomValue {
  readonly __rill_atom: true;
  readonly atom: RillAtom;
  readonly status?: RillStatus;
}

/**
 * Stream type - represents an async lazy sequence with resolution.
 * A stream is a dict with:
 * - __rill_stream: true - discriminator for stream detection
 * - done: boolean - whether all chunks have been consumed
 * - next: callable - function to advance to the next stream step
 * - value?: any - current chunk value (present when done is false)
 */
export interface RillStream extends Record<string, RillValue> {
  readonly __rill_stream: true;
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
  | RillDatetime
  | RillDuration
  | FieldDescriptorMarker
  | RillTypeValue
  | RillStream
  | RillAtomValue;
