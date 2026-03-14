/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */

import type { RillTypeName } from '../../types.js';
import { RuntimeError } from '../../types.js';
import { VALID_TYPE_NAMES } from '../../constants.js';
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
 * Field definition - describes a single field in a structural type.
 * Used by dict, tuple, ordered, and closure type descriptors.
 * Default detection: `field.defaultValue !== undefined`.
 */
export interface RillFieldDef {
  name?: string;
  type: RillType;
  defaultValue?: RillValue;
}

/**
 * Structural type descriptor - describes the shape of a value in the type system.
 * Used by RillTypeValue to carry type structure information at runtime.
 */
export type RillType =
  | { type: 'number' }
  | { type: 'string' }
  | { type: 'bool' }
  | { type: 'vector' }
  | { type: 'type' }
  | { type: 'any' }
  | { type: 'dict'; fields?: Record<string, RillFieldDef> }
  | { type: 'list'; element?: RillType }
  | {
      type: 'closure';
      params?: RillFieldDef[];
      ret?: RillType;
    }
  | { type: 'tuple'; elements?: RillFieldDef[] }
  | { type: 'ordered'; fields?: RillFieldDef[] }
  | { type: 'union'; members: RillType[] };

/**
 * @deprecated Use RillType instead. Will be removed in the next major version.
 */
export type RillStructuralType = RillType;

/**
 * Type value - represents a first-class type name at runtime.
 * Created when a type name expression (e.g. `string`, `number`) is evaluated.
 */
export interface RillTypeValue {
  readonly __rill_type: true;
  readonly typeName: RillTypeName;
  readonly structure: RillType;
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
  if (isRillIterator(value)) return 'iterator';
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
 * Empty arrays return { type: 'any' }.
 * Mixed types throw RILL-R002.
 */
export function inferElementType(elements: RillValue[]): RillType {
  if (elements.length === 0) return { type: 'any' };
  const firstElem = elements[0]!;
  let accType = inferStructuralType(firstElem);
  for (let i = 1; i < elements.length; i++) {
    const elem = elements[i]!;
    const elemType = inferStructuralType(elem);
    const merged = commonType(accType, elemType);
    if (merged === null) {
      throw new RuntimeError(
        'RILL-R002',
        `List elements must be the same type: expected ${formatStructuralType(accType)}, got ${formatStructuralType(elemType)} at index ${i}`
      );
    }
    accType = merged;
  }
  return accType;
}

/**
 * Return the most specific shared type for two RillType values.
 * Returns null when types are incompatible at the top level.
 *
 * Cascade priority:
 * 1. Any-narrowing: if either side is `any`, return the other
 * 2. Structural match: delegate to structuralTypeEquals; on true, return a
 * 3. Recursive list: merge inner element types
 * 4. Bare type fallback: same compound type but structural mismatch
 * 5. Incompatible: different top-level types return null
 */
export function commonType(a: RillType, b: RillType): RillType | null {
  // 1. Any-narrowing
  if (a.type === 'any') return b;
  if (b.type === 'any') return a;

  // 5. Incompatible top-level types (checked early to short-circuit)
  if (a.type !== b.type) return null;

  // 2. Structural match
  if (structuralTypeEquals(a, b)) return a;

  // 3. Recursive list element merging
  if (a.type === 'list' && b.type === 'list') {
    if (a.element !== undefined && b.element !== undefined) {
      const inner = commonType(a.element, b.element);
      if (inner !== null) return { type: 'list', element: inner };
    }
    return { type: 'list' };
  }

  // 4. Bare type fallback for compound types.
  // The cast is safe for closure/dict/tuple/ordered (all sub-fields optional).
  // For union, members is required by RillType but omitted here intentionally:
  // bare union signals structural incompatibility without enumerating members.
  if (
    a.type === 'closure' ||
    a.type === 'dict' ||
    a.type === 'tuple' ||
    a.type === 'ordered' ||
    a.type === 'union'
  ) {
    return { type: a.type } as RillType;
  }

  return null;
}

/** Compare two structural types for equality. */
export function structuralTypeEquals(a: RillType, b: RillType): boolean {
  if (a.type !== b.type) return false;

  // Leaf variants compare by type alone
  if (
    a.type === 'number' ||
    a.type === 'string' ||
    a.type === 'bool' ||
    a.type === 'vector' ||
    a.type === 'type' ||
    a.type === 'any'
  ) {
    return true;
  }

  if (a.type === 'list' && b.type === 'list') {
    if (a.element === undefined && b.element === undefined) return true;
    if (a.element === undefined || b.element === undefined) return false;
    return structuralTypeEquals(a.element, b.element);
  }

  if (a.type === 'dict' && b.type === 'dict') {
    if (a.fields === undefined && b.fields === undefined) return true;
    if (a.fields === undefined || b.fields === undefined) return false;
    const aKeys = Object.keys(a.fields).sort();
    const bKeys = Object.keys(b.fields).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i]!;
      if (key !== bKeys[i]) return false;
      const aField = a.fields[key]!;
      const bField = b.fields[key]!;
      const aHasDefault = aField.defaultValue !== undefined;
      const bHasDefault = bField.defaultValue !== undefined;
      if (aHasDefault !== bHasDefault) return false;
      if (!structuralTypeEquals(aField.type, bField.type)) return false;
      if (aHasDefault && bHasDefault) {
        if (!deepEquals(aField.defaultValue!, bField.defaultValue!))
          return false;
      }
    }
    return true;
  }

  if (a.type === 'tuple' && b.type === 'tuple') {
    if (a.elements === undefined && b.elements === undefined) return true;
    if (a.elements === undefined || b.elements === undefined) return false;
    if (a.elements.length !== b.elements.length) return false;
    for (let i = 0; i < a.elements.length; i++) {
      const aElem = a.elements[i]!;
      const bElem = b.elements[i]!;
      if (!structuralTypeEquals(aElem.type, bElem.type)) return false;
      const aDefault = aElem.defaultValue;
      const bDefault = bElem.defaultValue;
      if (aDefault === undefined && bDefault === undefined) continue;
      if (aDefault === undefined || bDefault === undefined) return false;
      if (!deepEquals(aDefault, bDefault)) return false;
    }
    return true;
  }

  if (a.type === 'ordered' && b.type === 'ordered') {
    if (a.fields === undefined && b.fields === undefined) return true;
    if (a.fields === undefined || b.fields === undefined) return false;
    if (a.fields.length !== b.fields.length) return false;
    for (let i = 0; i < a.fields.length; i++) {
      const aField = a.fields[i]!;
      const bField = b.fields[i]!;
      if (aField.name !== bField.name) return false;
      if (!structuralTypeEquals(aField.type, bField.type)) return false;
      const aDefault = aField.defaultValue;
      const bDefault = bField.defaultValue;
      if (aDefault === undefined && bDefault === undefined) continue;
      if (aDefault === undefined || bDefault === undefined) return false;
      if (!deepEquals(aDefault, bDefault)) return false;
    }
    return true;
  }

  if (a.type === 'union' && b.type === 'union') {
    if (a.members.length !== b.members.length) return false;
    for (let i = 0; i < a.members.length; i++) {
      if (!structuralTypeEquals(a.members[i]!, b.members[i]!)) return false;
    }
    return true;
  }

  if (a.type === 'closure' && b.type === 'closure') {
    if (a.params === undefined && b.params === undefined) {
      // Both absent: compare ret
    } else if (a.params === undefined || b.params === undefined) {
      return false;
    } else {
      if (a.params.length !== b.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        const aParam = a.params[i]!;
        const bParam = b.params[i]!;
        if (aParam.name !== bParam.name) return false;
        if (!structuralTypeEquals(aParam.type, bParam.type)) return false;
        const aDefault = aParam.defaultValue;
        const bDefault = bParam.defaultValue;
        if (aDefault === undefined && bDefault === undefined) continue;
        if (aDefault === undefined || bDefault === undefined) return false;
        if (!deepEquals(aDefault, bDefault)) return false;
      }
    }
    if (a.ret === undefined && b.ret === undefined) return true;
    if (a.ret === undefined || b.ret === undefined) return false;
    return structuralTypeEquals(a.ret, b.ret);
  }

  return false;
}

/** Infer the structural type descriptor for any Rill value. */
export function inferStructuralType(value: RillValue): RillType {
  if (value === null || typeof value === 'string') {
    return { type: 'string' };
  }
  if (typeof value === 'number') {
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'bool' };
  }
  if (isTypeValue(value)) {
    return { type: 'type' };
  }
  if (Array.isArray(value)) {
    return { type: 'list', element: inferElementType(value) };
  }
  if (isTuple(value)) {
    return {
      type: 'tuple',
      elements: value.entries.map(
        (e): RillFieldDef => ({
          type: inferStructuralType(e),
        })
      ),
    };
  }
  if (isOrdered(value)) {
    return {
      type: 'ordered',
      fields: value.entries.map(
        ([k, v]): RillFieldDef => ({
          name: k,
          type: inferStructuralType(v),
        })
      ),
    };
  }
  if (isVector(value)) {
    return { type: 'vector' };
  }
  if (isCallable(value)) {
    const params = (value.params ?? []).map((p) =>
      paramToFieldDef(p.name, p.type ?? { type: 'any' }, p.defaultValue)
    );
    const ret: RillType = value.returnType.structure;
    return { type: 'closure', params, ret };
  }
  if (typeof value === 'object') {
    const dict = value as Record<string, RillValue>;
    const fields: Record<string, RillFieldDef> = {};
    for (const [k, v] of Object.entries(dict)) {
      fields[k] = { type: inferStructuralType(v) };
    }
    return { type: 'dict', fields };
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
  type: RillType
): boolean {
  if (typeof value === 'undefined') {
    throw new RuntimeError('RILL-R004', 'Cannot type-check non-value');
  }

  if (type.type === 'any') return true;

  // Leaf primitive variants: match by inferred type name
  if (
    type.type === 'number' ||
    type.type === 'string' ||
    type.type === 'bool' ||
    type.type === 'vector' ||
    type.type === 'type'
  ) {
    return inferType(value) === type.type;
  }

  if (type.type === 'list') {
    if (!Array.isArray(value)) return false;
    // Absent element sub-field: matches any list value
    if (type.element === undefined) return true;
    if (type.element.type === 'any') return true;
    return value.every((elem) => structuralTypeMatches(elem, type.element!));
  }

  if (type.type === 'dict') {
    if (!isDict(value)) return false;
    // Absent fields sub-field: matches any dict value
    if (type.fields === undefined) return true;
    const dictKeys = Object.keys(type.fields);
    // Empty fields object matches any dict
    if (dictKeys.length === 0) return true;
    const dict = value as Record<string, RillValue>;
    for (const key of dictKeys) {
      if (!(key in dict)) {
        const field = type.fields[key]!;
        if (field.defaultValue !== undefined) continue;
        return false;
      }
      const field = type.fields[key]!;
      if (!structuralTypeMatches(dict[key]!, field.type)) return false;
    }
    return true;
  }

  if (type.type === 'tuple') {
    if (!isTuple(value)) return false;
    // Absent elements sub-field: matches any tuple value
    if (type.elements === undefined) return true;
    if (type.elements.length === 0) return value.entries.length === 0;
    // Reject if value has more entries than type elements
    if (value.entries.length > type.elements.length) return false;
    // Reject if value is shorter and any trailing missing element lacks a default
    if (value.entries.length < type.elements.length) {
      for (let i = value.entries.length; i < type.elements.length; i++) {
        const field = type.elements[i]!;
        if (field.defaultValue === undefined) return false;
      }
    }
    for (let i = 0; i < value.entries.length; i++) {
      if (!structuralTypeMatches(value.entries[i]!, type.elements[i]!.type))
        return false;
    }
    return true;
  }

  if (type.type === 'ordered') {
    if (!isOrdered(value)) return false;
    // Absent fields sub-field: matches any ordered value
    if (type.fields === undefined) return true;
    if (type.fields.length === 0) return value.entries.length === 0;
    // Reject if value has more entries than type fields
    if (value.entries.length > type.fields.length) return false;
    // Reject if value is shorter and any trailing missing field lacks a default
    if (value.entries.length < type.fields.length) {
      for (let i = value.entries.length; i < type.fields.length; i++) {
        const field = type.fields[i]!;
        if (field.defaultValue === undefined) return false;
      }
    }
    for (let i = 0; i < value.entries.length; i++) {
      const field = type.fields[i]!;
      const [actualName, actualValue] = value.entries[i]!;
      if (actualName !== field.name) return false;
      if (!structuralTypeMatches(actualValue, field.type)) return false;
    }
    return true;
  }

  if (type.type === 'closure') {
    if (!isCallable(value)) return false;
    // Absent params sub-field: matches any closure value of that compound type
    if (type.params === undefined) return true;
    const valueParams = value.params ?? [];
    if (valueParams.length !== type.params.length) return false;
    for (let i = 0; i < type.params.length; i++) {
      const field = type.params[i]!;
      const param = valueParams[i]!;
      if (param.name !== field.name) return false;
      const paramType: RillType = param.type ?? { type: 'any' };
      if (!structuralTypeEquals(paramType, field.type)) return false;
    }
    const retType: RillType = value.returnType.structure;
    if (type.ret === undefined) return true;
    return structuralTypeEquals(retType, type.ret);
  }

  if (type.type === 'union') {
    return type.members.some((member) => structuralTypeMatches(value, member));
  }

  return false;
}

/** Build a closure param field definition from name, type, and optional default. */
export function paramToFieldDef(
  name: string,
  type: RillType,
  defaultValue: RillValue | undefined
): RillFieldDef {
  const field: RillFieldDef = { name, type };
  if (defaultValue !== undefined) field.defaultValue = defaultValue;
  return field;
}

/** Format a RillValue as a rill literal for use in type signatures. */
function formatRillLiteral(value: RillValue): string {
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  return formatValue(value);
}

/** Format a structural type descriptor as a human-readable string. */
export function formatStructuralType(type: RillType): string {
  if (
    type.type === 'any' ||
    type.type === 'number' ||
    type.type === 'string' ||
    type.type === 'bool' ||
    type.type === 'vector' ||
    type.type === 'type'
  ) {
    return type.type;
  }

  if (type.type === 'list') {
    if (type.element === undefined) return 'list';
    return `list(${formatStructuralType(type.element)})`;
  }

  if (type.type === 'dict') {
    if (type.fields === undefined) return 'dict';
    const parts = Object.keys(type.fields)
      .sort()
      .map((k) => {
        const field = type.fields![k]!;
        const base = `${k}: ${formatStructuralType(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      });
    return `dict(${parts.join(', ')})`;
  }

  if (type.type === 'tuple') {
    if (type.elements === undefined) return 'tuple';
    const parts = type.elements.map((field) => {
      const base = formatStructuralType(field.type);
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return `tuple(${parts.join(', ')})`;
  }

  if (type.type === 'ordered') {
    if (type.fields === undefined) return 'ordered';
    const parts = type.fields.map((field) => {
      const base = `${field.name}: ${formatStructuralType(field.type)}`;
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return `ordered(${parts.join(', ')})`;
  }

  if (type.type === 'closure') {
    if (type.params === undefined) return 'closure';
    const params = type.params
      .map((field) => {
        const base = `${field.name}: ${formatStructuralType(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      })
      .join(', ');
    const ret = type.ret !== undefined ? formatStructuralType(type.ret) : 'any';
    return `|${params}| :${ret}`;
  }

  if (type.type === 'union') {
    return type.members.map(formatStructuralType).join('|');
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
    return `tuple[${value.entries.map(formatValue).join(', ')}]`;
  }

  if (isOrdered(value)) {
    const parts = value.entries.map(([k, v]) => `${k}: ${formatValue(v)}`);
    return `ordered[${parts.join(', ')}]`;
  }

  if (isRillIterator(value)) {
    return 'type(iterator)';
  }

  if (Array.isArray(value)) {
    return `list[${value.map(formatValue).join(', ')}]`;
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
    return `dict[${parts.join(', ')}]`;
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
  /** Rill type name — matches RillTypeName, or 'iterator' for lazy sequences */
  rillTypeName: string;
  /** Human-readable type signature, e.g. "string", "list(number)", "|x: number| :string" */
  rillTypeSignature: string;
  /** Native JS representation. Non-native types produce descriptor objects. */
  value: NativeValue;
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
 * Non-representable types (closures, vectors, type values, iterators) produce descriptor objects.
 * Tuples convert to native arrays. Ordered values convert to plain objects.
 */
export function toNative(value: RillValue): NativeResult {
  const rillTypeName = inferType(value);
  const rillTypeSignature = formatStructuralType(inferStructuralType(value));
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
    return { signature: formatStructuralType(inferStructuralType(value)) };
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

  if (isTypeValue(value)) {
    return {
      name: value.typeName,
      signature: formatStructuralType(value.structure),
    };
  }

  if (isRillIterator(value)) {
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

/**
 * Singleton RillTypeValue representing the 'any' type.
 * Used as the default returnType for callable() factory and ApplicationCallable.
 */
export const anyTypeValue: RillTypeValue = Object.freeze({
  __rill_type: true as const,
  typeName: 'any' as const,
  structure: { type: 'any' as const },
});

/**
 * Convert a RillType structural descriptor to a RillTypeValue.
 * Uses the RillType's `type` field as the `typeName`.
 * Falls back to 'any' for compound types that lack a direct RillTypeName mapping.
 */
export function rillTypeToTypeValue(type: RillType): RillTypeValue {
  const validNames: readonly string[] = VALID_TYPE_NAMES;
  return Object.freeze({
    __rill_type: true as const,
    typeName: (validNames.includes(type.type)
      ? type.type
      : 'any') as RillTypeName,
    structure: type,
  });
}

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

/**
 * Deep copy a RillValue, producing a new independent value.
 * Handles primitives, arrays, plain dicts, and null.
 * Special markers (closures, tuples, ordered, vectors, type values) are returned
 * as-is since they are immutable by contract.
 */
export function deepCopyRillValue(value: RillValue): RillValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepCopyRillValue);
  }
  // Plain dict: copy recursively. Special markers (RillTuple, RillOrdered, etc.)
  // carry __rill_* own properties and are treated as immutable; return as-is.
  if (
    !('__rill_tuple' in value) &&
    !('__rill_ordered' in value) &&
    !('__rill_vector' in value) &&
    !('__rill_type' in value) &&
    !('__type' in value) &&
    !('__rill_field_descriptor' in value)
  ) {
    const copy: Record<string, RillValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, RillValue>)) {
      copy[k] = deepCopyRillValue(v);
    }
    return copy;
  }
  return value;
}
