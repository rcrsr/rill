/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */

import type { RillTypeName } from '../../types.js';
import { RuntimeError } from '../../types.js';
import {
  callableEquals,
  isCallable,
  isDict,
  isScriptCallable,
} from './callable.js';

// Forward declaration - actual callable types defined in callable.ts
// This avoids circular dependency
interface CallableMarker {
  readonly __type: 'callable';
}

// Forward declaration for field descriptors
interface FieldDescriptorMarker {
  readonly __rill_field_descriptor: true;
}

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
 */
export interface RillOrdered {
  readonly __rill_ordered: true;
  readonly entries: [string, RillValue][];
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
 * Structural type descriptor - describes the shape of a value in the type system.
 * Used by RillTypeValue to carry type structure information at runtime.
 */
export type RillStructuralType =
  | { kind: 'primitive'; name: RillTypeName }
  | { kind: 'list'; element: RillStructuralType }
  | { kind: 'dict'; fields: Record<string, RillStructuralType> }
  | { kind: 'tuple'; elements: RillStructuralType[] }
  | { kind: 'ordered'; fields: [string, RillStructuralType][] }
  | {
      kind: 'closure';
      params: [string, RillStructuralType][];
      ret: RillStructuralType;
    }
  | { kind: 'any' };

/**
 * Type value - represents a first-class type name at runtime.
 * Created when a type name expression (e.g. `string`, `number`) is evaluated.
 */
export interface RillTypeValue {
  readonly __rill_type: true;
  readonly typeName: RillTypeName;
  readonly structure: RillStructuralType;
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

/** Type guard for RillOrdered (named spread args) */
export function isOrdered(value: RillValue): value is RillOrdered {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as RillOrdered).__rill_ordered === true
  );
}

/** Type guard for RillTypeValue */
export function isTypeValue(value: RillValue): value is RillTypeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_type' in value &&
    (value as RillTypeValue).__rill_type === true
  );
}

/** Create ordered from entries array (named, preserves insertion order) */
export function createOrdered(entries: [string, RillValue][]): RillOrdered {
  return Object.freeze({ __rill_ordered: true, entries: [...entries] });
}

/** Create tuple from entries array (positional, preserves order) */
export function createTuple(entries: RillValue[]): RillTuple {
  return Object.freeze({ __rill_tuple: true, entries: [...entries] });
}

/**
 * Create vector from Float32Array with model name.
 * @throws {Error} if data.length is 0 (zero-dimension vectors not allowed)
 */
export function createVector(data: Float32Array, model: string): RillVector {
  if (data.length === 0) {
    throw new Error('Vector data must have at least one dimension');
  }
  return { __rill_vector: true, data, model };
}

/** Infer the Rill type from a runtime value */
export function inferType(value: RillValue): RillTypeName {
  if (value === null) return 'string'; // null treated as empty string
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (isTuple(value)) return 'tuple';
  if (isOrdered(value)) return 'ordered';
  if (isVector(value)) return 'vector';
  if (Array.isArray(value)) return 'list';
  if (isTypeValue(value)) return 'type';
  if (
    typeof value === 'object' &&
    '__type' in value &&
    value.__type === 'callable'
  ) {
    return 'closure';
  }
  if (typeof value === 'object') return 'dict';
  return 'string'; // fallback
}

/**
 * Infer the element type for a homogeneous list.
 * Empty arrays return { kind: 'any' }.
 * Mixed types throw RILL-R002.
 */
export function inferElementType(elements: RillValue[]): RillStructuralType {
  if (elements.length === 0) return { kind: 'any' };
  const firstElem = elements[0]!;
  const firstType = inferStructuralType(firstElem);
  for (let i = 1; i < elements.length; i++) {
    const elem = elements[i]!;
    const elemType = inferStructuralType(elem);
    if (!structuralTypeEquals(firstType, elemType)) {
      throw new RuntimeError(
        'RILL-R002',
        `List elements must be the same type: expected ${formatStructuralType(firstType)}, got ${formatStructuralType(elemType)} at index ${i}`
      );
    }
  }
  return firstType;
}

/** Compare two structural types for equality. */
export function structuralTypeEquals(
  a: RillStructuralType,
  b: RillStructuralType
): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === 'any' && b.kind === 'any') return true;

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return a.name === b.name;
  }

  if (a.kind === 'list' && b.kind === 'list') {
    return structuralTypeEquals(a.element, b.element);
  }

  if (a.kind === 'dict' && b.kind === 'dict') {
    const aKeys = Object.keys(a.fields).sort();
    const bKeys = Object.keys(b.fields).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i]!;
      if (key !== bKeys[i]) return false;
      const aField = a.fields[key]!;
      const bField = b.fields[key]!;
      if (!structuralTypeEquals(aField, bField)) return false;
    }
    return true;
  }

  if (a.kind === 'tuple' && b.kind === 'tuple') {
    if (a.elements.length !== b.elements.length) return false;
    for (let i = 0; i < a.elements.length; i++) {
      if (!structuralTypeEquals(a.elements[i]!, b.elements[i]!)) return false;
    }
    return true;
  }

  if (a.kind === 'ordered' && b.kind === 'ordered') {
    if (a.fields.length !== b.fields.length) return false;
    for (let i = 0; i < a.fields.length; i++) {
      const aField = a.fields[i]!;
      const bField = b.fields[i]!;
      if (aField[0] !== bField[0]) return false;
      if (!structuralTypeEquals(aField[1], bField[1])) return false;
    }
    return true;
  }

  if (a.kind === 'closure' && b.kind === 'closure') {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) {
      const aParam = a.params[i]!;
      const bParam = b.params[i]!;
      if (aParam[0] !== bParam[0]) return false;
      if (!structuralTypeEquals(aParam[1], bParam[1])) return false;
    }
    return structuralTypeEquals(a.ret, b.ret);
  }

  return false;
}

/** Infer the structural type descriptor for any Rill value. */
export function inferStructuralType(value: RillValue): RillStructuralType {
  if (value === null || typeof value === 'string') {
    return { kind: 'primitive', name: 'string' };
  }
  if (typeof value === 'number') {
    return { kind: 'primitive', name: 'number' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'primitive', name: 'bool' };
  }
  if (isTypeValue(value)) {
    return { kind: 'primitive', name: 'type' };
  }
  if (Array.isArray(value)) {
    return { kind: 'list', element: inferElementType(value) };
  }
  if (isTuple(value)) {
    return {
      kind: 'tuple',
      elements: value.entries.map(inferStructuralType),
    };
  }
  if (isOrdered(value)) {
    return {
      kind: 'ordered',
      fields: value.entries.map(([k, v]) => [k, inferStructuralType(v)]),
    };
  }
  if (isVector(value)) {
    return { kind: 'primitive', name: 'vector' };
  }
  if (isCallable(value)) {
    if (isScriptCallable(value)) {
      const params: [string, RillStructuralType][] = value.params.map((p) => [
        p.name,
        p.typeName !== null
          ? { kind: 'primitive', name: p.typeName }
          : { kind: 'any' },
      ]);
      let ret: RillStructuralType = { kind: 'any' };
      if (isTypeValue(value.returnShape as RillValue)) {
        ret = (value.returnShape as RillTypeValue).structure;
      }
      return { kind: 'closure', params, ret };
    }
    // Non-script callables have no annotations
    return { kind: 'closure', params: [], ret: { kind: 'any' } };
  }
  if (typeof value === 'object') {
    const dict = value as Record<string, RillValue>;
    const fields: Record<string, RillStructuralType> = {};
    for (const [k, v] of Object.entries(dict)) {
      fields[k] = inferStructuralType(v);
    }
    return { kind: 'dict', fields };
  }
  throw new RuntimeError(
    'RILL-R004',
    `Cannot infer structural type for ${formatValue(value as RillValue)}`
  );
}

/**
 * Check if a value matches a structural type descriptor.
 * Used for runtime type checking (`:?` operator).
 */
export function structuralTypeMatches(
  value: RillValue,
  type: RillStructuralType
): boolean {
  if (typeof value === 'undefined') {
    throw new RuntimeError('RILL-R004', 'Cannot type-check non-value');
  }

  if (type.kind === 'any') return true;

  if (type.kind === 'primitive') {
    return inferType(value) === type.name;
  }

  if (type.kind === 'list') {
    if (!Array.isArray(value)) return false;
    if (type.element.kind === 'any') return true;
    return value.every((elem) => structuralTypeMatches(elem, type.element));
  }

  if (type.kind === 'dict') {
    if (!isDict(value)) return false;
    const dictKeys = Object.keys(type.fields);
    // Empty dict type matches any dict
    if (dictKeys.length === 0) return true;
    const dict = value as Record<string, RillValue>;
    for (const key of dictKeys) {
      if (!(key in dict)) return false;
      if (!structuralTypeMatches(dict[key]!, type.fields[key]!)) return false;
    }
    return true;
  }

  if (type.kind === 'tuple') {
    if (!isTuple(value)) return false;
    if (type.elements.length === 0) return value.entries.length === 0;
    if (value.entries.length !== type.elements.length) return false;
    for (let i = 0; i < type.elements.length; i++) {
      if (!structuralTypeMatches(value.entries[i]!, type.elements[i]!))
        return false;
    }
    return true;
  }

  if (type.kind === 'ordered') {
    if (!isOrdered(value)) return false;
    if (type.fields.length === 0) return value.entries.length === 0;
    if (value.entries.length !== type.fields.length) return false;
    for (let i = 0; i < type.fields.length; i++) {
      const [expectedName, expectedType] = type.fields[i]!;
      const [actualName, actualValue] = value.entries[i]!;
      if (actualName !== expectedName) return false;
      if (!structuralTypeMatches(actualValue, expectedType)) return false;
    }
    return true;
  }

  if (type.kind === 'closure') {
    if (!isCallable(value)) return false;
    if (!isScriptCallable(value)) {
      // Non-script callables: match if type has no param constraints
      return (
        type.params.every((_, i) => type.params[i]![1].kind === 'any') &&
        type.ret.kind === 'any'
      );
    }
    if (value.params.length !== type.params.length) return false;
    for (let i = 0; i < type.params.length; i++) {
      const [expectedName, expectedType] = type.params[i]!;
      const param = value.params[i]!;
      if (param.name !== expectedName) return false;
      const paramType: RillStructuralType =
        param.typeName !== null
          ? { kind: 'primitive', name: param.typeName }
          : { kind: 'any' };
      if (!structuralTypeEquals(paramType, expectedType)) return false;
    }
    let retType: RillStructuralType = { kind: 'any' };
    if (isTypeValue(value.returnShape as RillValue)) {
      retType = (value.returnShape as RillTypeValue).structure;
    }
    return structuralTypeEquals(retType, type.ret);
  }

  return false;
}

/** Format a structural type descriptor as a human-readable string. */
export function formatStructuralType(type: RillStructuralType): string {
  if (type.kind === 'any') return 'any';

  if (type.kind === 'primitive') return type.name;

  if (type.kind === 'list') {
    return `list(${formatStructuralType(type.element)})`;
  }

  if (type.kind === 'dict') {
    const parts = Object.keys(type.fields)
      .sort()
      .map((k) => `${k}: ${formatStructuralType(type.fields[k]!)}`);
    return `dict(${parts.join(', ')})`;
  }

  if (type.kind === 'tuple') {
    const parts = type.elements.map(formatStructuralType);
    return `tuple(${parts.join(', ')})`;
  }

  if (type.kind === 'ordered') {
    const parts = type.fields.map(
      ([k, t]) => `${k}: ${formatStructuralType(t)}`
    );
    return `ordered(${parts.join(', ')})`;
  }

  if (type.kind === 'closure') {
    const params = type.params
      .map(([name, t]) => `${name}: ${formatStructuralType(t)}`)
      .join(', ');
    return `|${params}| :${formatStructuralType(type.ret)}`;
  }

  return 'any';
}

/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export function checkType(value: RillValue, expected: RillTypeName): boolean {
  return inferType(value) === expected;
}

/** Check if a value is truthy in Rill semantics */
export function isTruthy(value: RillValue): boolean {
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

/** Check if a value is empty (inverse of truthy) */
export function isEmpty(value: RillValue): boolean {
  return !isTruthy(value);
}

/** Format a value for display */
export function formatValue(value: RillValue): string {
  if (value === null) return 'type(null)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (isCallable(value)) {
    return 'type(closure)';
  }

  if (isTuple(value)) {
    return `tuple(${value.entries.map(formatValue).join(', ')})`;
  }

  if (isOrdered(value)) {
    const parts = value.entries.map(([k, v]) => `${k}: ${formatValue(v)}`);
    return `*[${parts.join(', ')}]`;
  }

  if (isRillIterator(value)) {
    return 'type(iterator)';
  }

  if (Array.isArray(value)) {
    return `list(${value.map(formatValue).join(', ')})`;
  }

  if (isVector(value)) {
    return `vector(${value.model}, ${value.data.length}d)`;
  }

  if (isTypeValue(value)) {
    return formatStructuralType(value.structure);
  }

  // Plain dict
  if (typeof value === 'object') {
    const dict = value as Record<string, RillValue>;
    const parts = Object.entries(dict).map(
      ([k, v]) => `${k}: ${formatValue(v)}`
    );
    return `dict(${parts.join(', ')})`;
  }

  return String(value);
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

/** Plain object with string keys and NativeValue values */
export type NativePlainObject = { [key: string]: NativeValue };

/** Structured result from toNative conversion */
export interface NativeResult {
  /** Rill type kind — matches RillTypeName, or 'iterator' for lazy sequences */
  kind: string;
  /** Human-readable type signature, e.g. "string", "list<number>", "|x: number| :string" */
  typeSig: string;
  /** Native JS representation, or null if the value is not natively representable */
  native: NativeValue | null;
}

/**
 * Convert a RillValue to a JSON-serializable value.
 * @throws {Error} plain Error (not RuntimeError) for non-serializable types
 */
export function valueToJSON(value: RillValue): unknown {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map(valueToJSON);
  }

  if (isCallable(value)) {
    throw new Error('closures are not JSON-serializable');
  }

  if (isTuple(value)) {
    throw new Error('tuples are not JSON-serializable');
  }

  if (isOrdered(value)) {
    throw new Error('ordered values are not JSON-serializable');
  }

  if (isVector(value)) {
    throw new Error('vectors are not JSON-serializable');
  }

  if (isTypeValue(value)) {
    throw new Error('type values are not JSON-serializable');
  }

  if (isRillIterator(value)) {
    throw new Error('iterators are not JSON-serializable');
  }

  // Plain dict
  const dict = value as Record<string, RillValue>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dict)) {
    result[k] = valueToJSON(v);
  }
  return result;
}

/**
 * Convert a RillValue to a NativeResult for host consumption.
 * Non-representable types (closures, vectors, type values, iterators) return native: null.
 * Tuples convert to native arrays. Ordered values convert to plain objects.
 */
export function toNative(value: RillValue): NativeResult {
  const kind = isRillIterator(value) ? 'iterator' : inferType(value);
  const typeSig = formatStructuralType(inferStructuralType(value));
  const native = toNativeValue(value);
  return { kind, typeSig, native };
}

function toNativeValue(value: RillValue): NativeValue | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map(toNativeValue);
  }

  if (isCallable(value)) {
    return null;
  }

  if (isTuple(value)) {
    return value.entries.map(toNativeValue);
  }

  if (isOrdered(value)) {
    const result: { [key: string]: NativeValue } = {};
    for (const [k, v] of value.entries) {
      result[k] = toNativeValue(v) as NativeValue;
    }
    return result;
  }

  if (isVector(value)) {
    return null;
  }

  if (isTypeValue(value)) {
    return null;
  }

  if (isRillIterator(value)) {
    return null;
  }

  // Plain dict
  const dict = value as Record<string, RillValue>;
  const result: { [key: string]: NativeValue } = {};
  for (const [k, v] of Object.entries(dict)) {
    result[k] = toNativeValue(v) as NativeValue;
  }
  return result;
}

/**
 * Deep structural equality for all Rill values.
 * - Primitives: value equality
 * - Tuples: length + recursive element equality
 * - Dicts: same keys + recursive value equality (order-independent)
 */
export function deepEquals(a: RillValue, b: RillValue): boolean {
  // Handle primitives and null
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  // Primitives (string, number, boolean) - covered by === above
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  // Both are non-null objects at this point
  const aObj = a as object;
  const bObj = b as object;

  // Check for tuples (positional spread args)
  const aIsTuple = isTuple(a);
  const bIsTuple = isTuple(b);
  if (aIsTuple !== bIsTuple) return false;
  if (aIsTuple && bIsTuple) {
    if (a.entries.length !== b.entries.length) return false;
    for (let i = 0; i < a.entries.length; i++) {
      const aVal = a.entries[i];
      const bVal = b.entries[i];
      if (aVal === undefined || bVal === undefined) {
        if (aVal !== bVal) return false;
      } else if (!deepEquals(aVal, bVal)) {
        return false;
      }
    }
    return true;
  }

  // Check for ordered (named spread args)
  const aIsOrdered = isOrdered(a);
  const bIsOrdered = isOrdered(b);
  if (aIsOrdered !== bIsOrdered) return false;
  if (aIsOrdered && bIsOrdered) {
    if (a.entries.length !== b.entries.length) return false;
    for (let i = 0; i < a.entries.length; i++) {
      const aEntry = a.entries[i];
      const bEntry = b.entries[i];
      if (aEntry === undefined || bEntry === undefined) return false;
      if (aEntry[0] !== bEntry[0]) return false;
      if (!deepEquals(aEntry[1], bEntry[1])) return false;
    }
    return true;
  }

  // Check for vectors
  const aIsVector = isVector(a);
  const bIsVector = isVector(b);
  if (aIsVector !== bIsVector) return false;
  if (aIsVector && bIsVector) {
    // Vectors equal when model matches AND all float elements match
    if (a.model !== b.model) return false;
    if (a.data.length !== b.data.length) return false;
    for (let i = 0; i < a.data.length; i++) {
      const aVal = a.data[i];
      const bVal = b.data[i];
      if (aVal !== bVal) return false;
    }
    return true;
  }

  // Check for type values (first-class type names)
  const aIsTypeValue = isTypeValue(a);
  const bIsTypeValue = isTypeValue(b);
  if (aIsTypeValue !== bIsTypeValue) return false;
  if (aIsTypeValue && bIsTypeValue) {
    return structuralTypeEquals(a.structure, b.structure);
  }

  // Check for arrays (lists)
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const aElem = a[i];
      const bElem = b[i];
      if (aElem === undefined || bElem === undefined) {
        if (aElem !== bElem) return false;
      } else if (!deepEquals(aElem, bElem)) {
        return false;
      }
    }
    return true;
  }

  // Both are dicts (plain objects) or callables
  // For script callables, use structural equality (params + body AST + captured values)
  // For runtime/application callables, use reference equality
  if ('__type' in aObj || '__type' in bObj) {
    // Both must be callables to be equal
    if (!('__type' in aObj) || !('__type' in bObj)) return false;
    if (aObj.__type !== 'callable' || bObj.__type !== 'callable') return false;

    // Script callables: structural equality
    if (isScriptCallable(a) && isScriptCallable(b)) {
      return callableEquals(a, b, deepEquals);
    }

    // Runtime/application callables: reference equality
    return a === b;
  }

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

/** Reserved dict method names that cannot be overridden */
export const RESERVED_DICT_METHODS = ['keys', 'values', 'entries'] as const;

/** Check if a key name is reserved */
export function isReservedMethod(name: string): boolean {
  return (RESERVED_DICT_METHODS as readonly string[]).includes(name);
}

/**
 * Iterator type - represents a lazy sequence.
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value: any (only required when not done) - current element
 */
export interface RillIterator extends Record<string, RillValue> {
  readonly done: boolean;
  readonly next: CallableMarker;
  readonly value?: RillValue;
}

/**
 * Type guard for Rill iterator (lazy sequence).
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value: any (only required when not done) - current element
 */
export function isRillIterator(value: RillValue): value is RillIterator {
  if (!isDict(value)) return false;
  const dict = value as Record<string, RillValue>;
  if (!('done' in dict && typeof dict['done'] === 'boolean')) return false;
  if (!('next' in dict && isCallable(dict['next']))) return false;
  // 'value' field only required when not done
  if (!dict['done'] && !('value' in dict)) return false;
  return true;
}
