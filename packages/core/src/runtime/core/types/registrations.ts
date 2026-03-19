/**
 * Type Registration Definitions
 *
 * Defines the TypeDefinition interface, TypeProtocol interface, and
 * BUILT_IN_TYPES registration array. Each of the 12 built-in types
 * carries identity predicates, protocol functions (format, eq, compare,
 * convertTo, serialize), and a methods record populated from BUILTIN_METHODS.
 *
 * Dispatch functions (inferType, formatValue, deepEquals, serializeValue,
 * deserializeValue) iterate registrations and delegate to per-type
 * protocol implementations.
 *
 * Registration order:
 *   primitives -> discriminator-based -> structural -> list -> dict fallback
 *
 * @internal
 */

import type {
  TypeStructure,
  RillValue,
  RillFieldDef,
  RillTuple,
  RillOrdered,
  RillVector,
  RillTypeValue,
  RillIterator,
  RillStream,
} from './structures.js';
import type { RillFunction } from '../callable.js';
import {
  isStream,
  isTuple,
  isVector,
  isOrdered,
  isTypeValue,
  isIterator,
} from './guards.js';
import { createTuple, createOrdered, createVector } from './constructors.js';
import { formatStructure, structureEquals } from './operations.js';
import {
  isCallable,
  isDict,
  isScriptCallable,
  callableEquals,
} from '../callable.js';
import { RuntimeError } from '../../../types.js';

// ============================================================
// TYPE PROTOCOL INTERFACE
// ============================================================

/**
 * Protocol functions that define per-type behavior.
 * Every type must provide `format`. All other protocols are optional.
 */
export interface TypeProtocol {
  format: (v: RillValue) => string;
  structure?: ((v: RillValue) => TypeStructure) | undefined;
  eq?: ((a: RillValue, b: RillValue) => boolean) | undefined;
  compare?: ((a: RillValue, b: RillValue) => number) | undefined;
  convertTo?: Record<string, (v: RillValue) => RillValue> | undefined;
  serialize?: ((v: RillValue) => unknown) | undefined;
  deserialize?: ((data: unknown) => RillValue) | undefined;
}

// ============================================================
// TYPE DEFINITION INTERFACE
// ============================================================

/**
 * A single type registration record. Each of the 12 built-in types
 * has exactly one TypeDefinition in the BUILT_IN_TYPES array.
 */
export interface TypeDefinition {
  name: string;
  identity: (v: RillValue) => boolean;
  isLeaf: boolean;
  immutable: boolean;
  methods: Record<string, RillFunction>;
  protocol: TypeProtocol;
}

// ============================================================
// IDENTITY HELPERS
// ============================================================

/** Identity predicate for field_descriptor values. */
function isFieldDescriptor(value: RillValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_field_descriptor' in value &&
    (value as Record<string, unknown>)['__rill_field_descriptor'] === true
  );
}

/** Identity predicate for closure values. */
function isClosure(value: RillValue): boolean {
  return isCallable(value);
}

// ============================================================
// PROTOCOL IMPLEMENTATIONS: FORMAT
// ============================================================

function formatString(v: RillValue): string {
  if (v === null) return 'type(null)';
  return v as string;
}

/** Quote strings when nested inside containers for unambiguous display. */
function formatNested(v: RillValue): string {
  if (typeof v === 'string') {
    const escaped = (v as string).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return formatValue(v);
}

function formatNumber(v: RillValue): string {
  return String(v as number);
}

function formatBool(v: RillValue): string {
  return (v as boolean) ? 'true' : 'false';
}

function formatTuple(v: RillValue): string {
  const t = v as unknown as RillTuple;
  return `tuple[${t.entries.map(formatNested).join(', ')}]`;
}

function formatOrdered(v: RillValue): string {
  const o = v as unknown as RillOrdered;
  const parts = o.entries.map(([k, val]) => `${k}: ${formatNested(val)}`);
  return `ordered[${parts.join(', ')}]`;
}

function formatVector(v: RillValue): string {
  const vec = v as unknown as RillVector;
  return `vector(${vec.model}, ${vec.data.length}d)`;
}

function formatTypeValue(v: RillValue): string {
  const tv = v as unknown as RillTypeValue;
  return formatStructure(tv.structure);
}

function formatClosure(_v: RillValue): string {
  return 'type(closure)';
}

function formatFieldDescriptor(_v: RillValue): string {
  return 'type(field_descriptor)';
}

function formatIterator(_v: RillValue): string {
  return 'type(iterator)';
}

function formatStream(_v: RillValue): string {
  return 'type(stream)';
}

function formatList(v: RillValue): string {
  const arr = v as RillValue[];
  return `list[${arr.map(formatNested).join(', ')}]`;
}

function formatDict(v: RillValue): string {
  const dict = v as Record<string, RillValue>;
  const parts = Object.entries(dict).map(
    ([k, val]) => `${k}: ${formatNested(val)}`
  );
  return `dict[${parts.join(', ')}]`;
}

// ============================================================
// PROTOCOL IMPLEMENTATIONS: EQ
// ============================================================

function eqString(a: RillValue, b: RillValue): boolean {
  return a === b;
}

function eqNumber(a: RillValue, b: RillValue): boolean {
  return a === b;
}

function eqBool(a: RillValue, b: RillValue): boolean {
  return a === b;
}

/**
 * Parameterized element-wise comparison for collections.
 * Replaces duplicated loops in eqTuple, eqList, eqOrdered.
 *
 * AC-40: Zero-length collections return true.
 * AC-19: eqTuple, eqList, eqOrdered delegate loop body here.
 */
function compareElements(
  aEntries: readonly unknown[],
  bEntries: readonly unknown[],
  comparator: (a: unknown, b: unknown) => boolean
): boolean {
  if (aEntries.length !== bEntries.length) return false;
  for (let i = 0; i < aEntries.length; i++) {
    if (!comparator(aEntries[i], bEntries[i])) return false;
  }
  return true;
}

/** Element comparator for tuple and list entries: handles undefined, delegates to deepEquals. */
function compareByDeepEquals(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return deepEquals(a as RillValue, b as RillValue);
}

/** Entry comparator for ordered: keys by identity, values by deepEquals. */
function compareOrderedEntry(a: unknown, b: unknown): boolean {
  const aEntry = a as [string, RillValue] | undefined;
  const bEntry = b as [string, RillValue] | undefined;
  if (aEntry === undefined || bEntry === undefined) return false;
  if (aEntry[0] !== bEntry[0]) return false;
  return deepEquals(aEntry[1], bEntry[1]);
}

function eqTuple(a: RillValue, b: RillValue): boolean {
  if (!isTuple(a) || !isTuple(b)) return false;
  return compareElements(a.entries, b.entries, compareByDeepEquals);
}

function eqOrdered(a: RillValue, b: RillValue): boolean {
  if (!isOrdered(a) || !isOrdered(b)) return false;
  return compareElements(a.entries, b.entries, compareOrderedEntry);
}

function eqVector(a: RillValue, b: RillValue): boolean {
  if (!isVector(a) || !isVector(b)) return false;
  if (a.model !== b.model) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function eqTypeValue(a: RillValue, b: RillValue): boolean {
  if (!isTypeValue(a) || !isTypeValue(b)) return false;
  return structureEquals(a.structure, b.structure);
}

function eqClosure(a: RillValue, b: RillValue): boolean {
  if (!isCallable(a) || !isCallable(b)) return false;
  // Script callables: structural equality
  if (isScriptCallable(a) && isScriptCallable(b)) {
    return callableEquals(a, b, deepEquals);
  }
  // Runtime/application callables: reference equality
  return a === b;
}

function eqFieldDescriptor(a: RillValue, b: RillValue): boolean {
  // Field descriptors use reference equality
  return a === b;
}

function eqList(a: RillValue, b: RillValue): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return compareElements(a, b, compareByDeepEquals);
}

function eqDict(a: RillValue, b: RillValue): boolean {
  const aDict = a as Record<string, RillValue>;
  const bDict = b as Record<string, RillValue>;
  const aKeys = Object.keys(aDict);
  const bKeys = Object.keys(bDict);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in bDict)) return false;
    const aVal = aDict[key];
    const bVal = bDict[key];
    if (aVal === undefined || bVal === undefined) {
      if (aVal !== bVal) return false;
    } else if (!deepEquals(aVal, bVal)) {
      return false;
    }
  }
  return true;
}

// ============================================================
// PROTOCOL IMPLEMENTATIONS: COMPARE
// ============================================================

function compareString(a: RillValue, b: RillValue): number {
  const sa = a as string;
  const sb = b as string;
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function compareNumber(a: RillValue, b: RillValue): number {
  return (a as number) - (b as number);
}

// ============================================================
// PROTOCOL IMPLEMENTATIONS: CONVERT-TO
// ============================================================

/**
 * String convertTo targets.
 * - string -> number: parse numeric string
 * - string -> bool: "true"/"false" only
 */
const stringConvertTo: Record<string, (v: RillValue) => RillValue> = {
  number: (v: RillValue): RillValue => {
    const str = v as string;
    const parsed = Number(str);
    if (isNaN(parsed) || str.trim() === '') {
      throw new RuntimeError(
        'RILL-R064',
        `cannot convert string "${str}" to number`
      );
    }
    return parsed;
  },
  bool: (v: RillValue): RillValue => {
    const s = v as string;
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new RuntimeError('RILL-R065', `cannot convert string "${s}" to bool`);
  },
};

/**
 * Number convertTo targets.
 * - number -> string: via String()
 * - number -> bool: 0 -> false, 1 -> true
 */
const numberConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => String(v as number),
  bool: (v: RillValue): RillValue => {
    const n = v as number;
    if (n === 0) return false;
    if (n === 1) return true;
    throw new RuntimeError('RILL-R066', `cannot convert number ${n} to bool`);
  },
};

/**
 * Bool convertTo targets.
 * - bool -> string: "true"/"false"
 * - bool -> number: true -> 1, false -> 0
 */
const boolConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => ((v as boolean) ? 'true' : 'false'),
  number: (v: RillValue): RillValue => ((v as boolean) ? 1 : 0),
};

/**
 * Tuple convertTo targets.
 * - tuple -> list: extract entries
 */
const tupleConvertTo: Record<string, (v: RillValue) => RillValue> = {
  list: (v: RillValue): RillValue => (v as unknown as RillTuple).entries,
  string: (v: RillValue): RillValue => formatTuple(v),
};

/**
 * Ordered convertTo targets.
 * - ordered -> dict: convert entries to plain object
 */
const orderedConvertTo: Record<string, (v: RillValue) => RillValue> = {
  dict: (v: RillValue): RillValue => {
    const o = v as unknown as RillOrdered;
    const result: Record<string, RillValue> = {};
    for (const [key, value] of o.entries) {
      result[key] = value;
    }
    return result;
  },
  string: (v: RillValue): RillValue => formatOrdered(v),
};

/**
 * List convertTo targets.
 * - list -> tuple: wrap in tuple
 * - list -> string: format
 */
const listConvertTo: Record<string, (v: RillValue) => RillValue> = {
  tuple: (v: RillValue): RillValue => createTuple(v as RillValue[]),
  string: (v: RillValue): RillValue => formatList(v),
};

/**
 * Dict convertTo targets.
 * - dict -> string: format
 */
const dictConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatDict(v),
};

/**
 * Vector convertTo targets.
 * - vector -> string: format
 */
const vectorConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatVector(v),
};

/**
 * Type value convertTo targets.
 * - type -> string: format
 */
const typeConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatTypeValue(v),
};

/**
 * Closure convertTo targets.
 * - closure -> string: format
 */
const closureConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(closure)',
};

/**
 * Iterator convertTo targets.
 * - iterator -> string: format
 */
const iteratorConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(iterator)',
};

/**
 * Stream convertTo targets.
 * - stream -> string: format
 */
const streamConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(stream)',
};

// ============================================================
// PROTOCOL IMPLEMENTATIONS: SERIALIZE
// ============================================================

function serializeString(v: RillValue): unknown {
  if (v === null) return null;
  return v;
}

function serializeNumber(v: RillValue): unknown {
  return v;
}

function serializeBool(v: RillValue): unknown {
  return v;
}

function serializeList(v: RillValue): unknown {
  return (v as RillValue[]).map(serializeListElement);
}

/** Recursive serialization for list elements. */
function serializeListElement(v: RillValue): unknown {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(serializeListElement);
  if (isCallable(v))
    throw new RuntimeError('RILL-R067', 'closures are not JSON-serializable');
  if (isTuple(v))
    throw new RuntimeError('RILL-R067', 'tuples are not JSON-serializable');
  if (isOrdered(v))
    throw new RuntimeError(
      'RILL-R067',
      'ordered values are not JSON-serializable'
    );
  if (isVector(v))
    throw new RuntimeError('RILL-R067', 'vectors are not JSON-serializable');
  if (isTypeValue(v))
    throw new RuntimeError(
      'RILL-R067',
      'type values are not JSON-serializable'
    );
  if (isIterator(v))
    throw new RuntimeError('RILL-R067', 'iterators are not JSON-serializable');
  if (isStream(v))
    throw new RuntimeError('RILL-R067', 'streams are not JSON-serializable');
  // Plain dict
  const dict = v as Record<string, RillValue>;
  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(dict)) {
    result[k] = serializeListElement(val);
  }
  return result;
}

function serializeDict(v: RillValue): unknown {
  const dict = v as Record<string, RillValue>;
  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(dict)) {
    result[k] = serializeListElement(val);
  }
  return result;
}

function throwNotSerializable(typeName: string): (v: RillValue) => never {
  return (_v: RillValue): never => {
    throw new RuntimeError(
      'RILL-R067',
      `${typeName}s are not JSON-serializable`
    );
  };
}

// ============================================================
// BUILT-IN TYPE REGISTRATIONS
// ============================================================

/**
 * All 13 built-in type registrations.
 *
 * Registration order:
 * 1. Primitives: string, number, bool
 * 2. Discriminator-based: tuple, ordered, vector, type, closure, field_descriptor
 * 3. Structural: iterator, stream
 * 4. list
 * 5. dict (fallback, must be last)
 *
 * AC-1: 13 registrations, one per type.
 * BC-2: Vector identity checked before dict fallback.
 * EC-3: Iterator has no protocol.eq.
 * EC-4: Bool has no protocol.compare.
 * EC-8: Non-serializable types throw RuntimeError (RILL-R067).
 */
export const BUILT_IN_TYPES: readonly TypeDefinition[] = Object.freeze([
  // ---- Primitives ----
  {
    name: 'string',
    identity: (v: RillValue): boolean => typeof v === 'string' || v === null,
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatString,
      eq: eqString,
      compare: compareString,
      convertTo: stringConvertTo,
      serialize: serializeString,
    },
  },
  {
    name: 'number',
    identity: (v: RillValue): boolean => typeof v === 'number',
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatNumber,
      eq: eqNumber,
      compare: compareNumber,
      convertTo: numberConvertTo,
      serialize: serializeNumber,
    },
  },
  {
    name: 'bool',
    // EC-4: no protocol.compare (ordering unsupported for bool)
    identity: (v: RillValue): boolean => typeof v === 'boolean',
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatBool,
      eq: eqBool,
      convertTo: boolConvertTo,
      serialize: serializeBool,
    },
  },

  // ---- Discriminator-based ----
  {
    name: 'tuple',
    identity: (v: RillValue): boolean => isTuple(v),
    isLeaf: false,
    immutable: true,
    methods: {},
    protocol: {
      format: formatTuple,
      eq: eqTuple,
      convertTo: tupleConvertTo,
      serialize: throwNotSerializable('tuple'),
    },
  },
  {
    name: 'ordered',
    identity: (v: RillValue): boolean => isOrdered(v),
    isLeaf: false,
    immutable: true,
    methods: {},
    protocol: {
      format: formatOrdered,
      eq: eqOrdered,
      convertTo: orderedConvertTo,
      serialize: throwNotSerializable('ordered value'),
    },
  },
  {
    // BC-2: Vector identity checked before dict fallback
    name: 'vector',
    identity: (v: RillValue): boolean => isVector(v),
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatVector,
      eq: eqVector,
      convertTo: vectorConvertTo,
      serialize: throwNotSerializable('vector'),
    },
  },
  {
    name: 'type',
    identity: (v: RillValue): boolean => isTypeValue(v),
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatTypeValue,
      eq: eqTypeValue,
      convertTo: typeConvertTo,
      serialize: throwNotSerializable('type value'),
    },
  },
  {
    name: 'closure',
    identity: (v: RillValue): boolean => isClosure(v),
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatClosure,
      eq: eqClosure,
      convertTo: closureConvertTo,
      serialize: throwNotSerializable('closure'),
    },
  },
  {
    name: 'field_descriptor',
    identity: isFieldDescriptor,
    isLeaf: true,
    immutable: true,
    methods: {},
    protocol: {
      format: formatFieldDescriptor,
      eq: eqFieldDescriptor,
      serialize: throwNotSerializable('field_descriptor'),
    },
  },

  // ---- Structural ----
  // Stream must precede iterator: streams satisfy the iterator shape
  // (done + next + value) but have the __rill_stream discriminator.
  {
    name: 'stream',
    identity: (v: RillValue): boolean => isStream(v),
    isLeaf: false,
    immutable: true,
    methods: {},
    protocol: {
      format: formatStream,
      convertTo: streamConvertTo,
      serialize: throwNotSerializable('stream'),
      structure: (v: RillValue): TypeStructure => {
        const raw = v as unknown as Record<string, TypeStructure | undefined>;
        const chunk = raw['__rill_stream_chunk_type'];
        const ret = raw['__rill_stream_ret_type'];
        const result: {
          kind: 'stream';
          chunk?: TypeStructure;
          ret?: TypeStructure;
        } = { kind: 'stream' };
        if (chunk !== undefined) result.chunk = chunk;
        if (ret !== undefined) result.ret = ret;
        return result;
      },
    },
  },
  {
    // EC-3: iterator has no protocol.eq (equality raises RILL-R002)
    name: 'iterator',
    identity: (v: RillValue): boolean => isIterator(v),
    isLeaf: false,
    immutable: false,
    methods: {},
    protocol: {
      format: formatIterator,
      convertTo: iteratorConvertTo,
      serialize: throwNotSerializable('iterator'),
    },
  },

  // ---- List ----
  {
    name: 'list',
    identity: (v: RillValue): boolean =>
      Array.isArray(v) && !isTuple(v) && !isOrdered(v),
    isLeaf: false,
    immutable: false,
    methods: {},
    protocol: {
      format: formatList,
      eq: eqList,
      convertTo: listConvertTo,
      serialize: serializeList,
    },
  },

  // ---- Dict fallback (must be last) ----
  {
    name: 'dict',
    identity: (v: RillValue): boolean => isDict(v),
    isLeaf: false,
    immutable: false,
    methods: {},
    protocol: {
      format: formatDict,
      eq: eqDict,
      convertTo: dictConvertTo,
      serialize: serializeDict,
    },
  },
]);

// ============================================================
// DISPATCH FUNCTIONS
// ============================================================

/**
 * Infer the Rill type name from a runtime value.
 * Iterates registrations in order; returns first matching name.
 * Returns 'string' as fallback (BC-1: null IS type string, not a coercion).
 *
 * IR-2: Return type widens from RillTypeName to string for extensibility.
 */
export function inferType(value: RillValue): string {
  for (const reg of BUILT_IN_TYPES) {
    if (reg.identity(value)) return reg.name;
  }
  return 'string';
}

/**
 * Format a value as a human-readable string.
 * Determines type via inferType, then calls protocol.format.
 * Falls back to String(value) when no registration matches.
 *
 * IR-3: Protocol dispatcher for formatting.
 */
export function formatValue(value: RillValue): string {
  for (const reg of BUILT_IN_TYPES) {
    if (reg.identity(value)) return reg.protocol.format(value);
  }
  return String(value);
}

/**
 * Deep equality comparison for two Rill values.
 * Short-circuit: a === b returns true.
 * Dispatches to left operand's protocol.eq.
 * No protocol.eq returns false.
 *
 * IR-4: Container protocol.eq calls deepEquals recursively.
 */
export function deepEquals(a: RillValue, b: RillValue): boolean {
  if (a === b) return true;
  for (const reg of BUILT_IN_TYPES) {
    if (reg.identity(a)) {
      if (!reg.protocol.eq) return false;
      return reg.protocol.eq(a, b);
    }
  }
  return false;
}

/**
 * Serialize a Rill value for JSON transport.
 * Dispatches to protocol.serialize; container types recurse.
 *
 * IR-7: Renamed from valueToJSON.
 */
export function serializeValue(value: RillValue): unknown {
  for (const reg of BUILT_IN_TYPES) {
    if (reg.identity(value)) {
      if (reg.protocol.serialize) return reg.protocol.serialize(value);
      break;
    }
  }
  return value;
}

/**
 * Deserialize raw data into a Rill value.
 * Dispatches to protocol.deserialize for the given type name.
 * Falls back to raw value when no protocol.deserialize exists (primitives).
 *
 * IR-8: Raw value fallback rejects null/undefined inputs with RILL-R004.
 * EC-9: Invalid data raises RILL-R004.
 * EC-10: null/undefined input raises RILL-R004.
 */
export function deserializeValue(data: unknown, typeName: string): RillValue {
  if (data === null || data === undefined) {
    throw new RuntimeError(
      'RILL-R004',
      `Cannot deserialize null as ${typeName}`
    );
  }
  for (const reg of BUILT_IN_TYPES) {
    if (reg.name === typeName) {
      if (reg.protocol.deserialize) return reg.protocol.deserialize(data);
      return data as RillValue;
    }
  }
  throw new RuntimeError('RILL-R004', `Cannot deserialize as ${typeName}`);
}

// ============================================================
// METHOD POPULATION
// ============================================================

/** Names of types that carry methods from BUILTIN_METHODS. */
const METHOD_BEARING_TYPES = new Set([
  'string',
  'number',
  'bool',
  'list',
  'dict',
  'vector',
]);

/**
 * Populate registration `methods` fields from BUILTIN_METHODS.
 *
 * Called after builtins.ts finishes initialization to avoid circular
 * dependency at module load time. The 6 method-bearing types (string,
 * number, bool, list, dict, vector) receive their methods records;
 * other types keep `methods: {}`.
 *
 * AC-3: Consolidates method data into registrations.
 *
 * MUTATION NOTE: BUILT_IN_TYPES is shallow-frozen (the array), but each
 * registration object is mutable. This function relies on that mutability.
 * If registration objects are ever deep-frozen (e.g. Object.freeze(reg)),
 * this assignment will throw in strict mode. The runtime guard below catches
 * that condition early with a clear error rather than a silent no-op.
 */
export function populateBuiltinMethods(
  builtinMethods: Record<string, Record<string, RillFunction>>
): void {
  for (const reg of BUILT_IN_TYPES) {
    if (METHOD_BEARING_TYPES.has(reg.name) && reg.name in builtinMethods) {
      if (Object.isFrozen(reg)) {
        throw new RuntimeError(
          'RILL-R068',
          `populateBuiltinMethods: registration '${reg.name}' is frozen; cannot assign methods`
        );
      }
      (reg as { methods: Record<string, RillFunction> }).methods =
        builtinMethods[reg.name]!;
    }
  }
}

// ============================================================
// RE-EXPORTED FACTORY FUNCTIONS
// ============================================================

export { createTuple, createOrdered, createVector };

// ============================================================
// RE-EXPORTED GUARD FUNCTIONS
// ============================================================

export { isStream, isTuple, isVector, isTypeValue, isOrdered, isIterator };

// ============================================================
// RE-EXPORTED TYPES
// ============================================================

export type { TypeStructure };
export type {
  RillValue,
  RillTuple,
  RillOrdered,
  RillVector,
  RillTypeValue,
  RillIterator,
  RillStream,
  RillFieldDef,
};
