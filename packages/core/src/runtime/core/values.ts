/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 *
 * Dispatch functions (inferType, formatValue, deepEquals, serializeValue,
 * copyValue) re-export from type-registrations.ts protocol implementations.
 */

import type { RillTypeName } from '../../types.js';
import { RuntimeError } from '../../types.js';
import { VALID_TYPE_NAMES } from '../../constants.js';
import { isCallable, isDict } from './callable.js';
import {
  inferType as registryInferType,
  formatValue as registryFormatValue,
  deepEquals as registryDeepEquals,
  serializeValue as registrySerializeValue,
  copyValue as registryCopyValue,
} from './type-registrations.js';
import type { CallableMarker, FieldDescriptorMarker } from './markers.js';

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
  type: TypeStructure;
  defaultValue?: RillValue;
}

/**
 * Structural type descriptor - describes the shape of a value in the type system.
 * Discriminated by `.kind`. Used by RillTypeValue to carry type structure information at runtime.
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
      fields?: Record<string, RillFieldDef>;
      valueType?: TypeStructure;
    }
  | { kind: 'list'; element?: TypeStructure }
  | {
      kind: 'closure';
      params?: RillFieldDef[];
      ret?: TypeStructure;
    }
  | { kind: 'tuple'; elements?: RillFieldDef[]; valueType?: TypeStructure }
  | { kind: 'ordered'; fields?: RillFieldDef[]; valueType?: TypeStructure }
  | { kind: 'union'; members: TypeStructure[] }
  | { kind: 'iterator' }
  | { kind: string; data?: unknown };

// Narrowed variant types for use after kind-discrimination.
// The catch-all `{ kind: string; data?: unknown }` prevents TypeScript from
// narrowing to specific variants. After a `kind` check, cast to the matching
// variant type so field access compiles without errors.
type ListStructure = { kind: 'list'; element?: TypeStructure };
export type DictStructure = {
  kind: 'dict';
  fields?: Record<string, RillFieldDef>;
  valueType?: TypeStructure;
};
export type TupleStructure = {
  kind: 'tuple';
  elements?: RillFieldDef[];
  valueType?: TypeStructure;
};
export type OrderedStructure = {
  kind: 'ordered';
  fields?: RillFieldDef[];
  valueType?: TypeStructure;
};
type UnionStructure = { kind: 'union'; members: TypeStructure[] };
type ClosureStructure = {
  kind: 'closure';
  params?: RillFieldDef[];
  ret?: TypeStructure;
};

/**
 * Normalize a TypeStructure that may use the legacy `.type` discriminator.
 * During migration, some code (builtins.ts, ext/) constructs objects with
 * `{ type: 'string' }` instead of `{ kind: 'string' }`. This function
 * converts legacy format to current format on the fly.
 */
function normalizeStructure(ts: TypeStructure): TypeStructure {
  if (ts.kind !== undefined) return ts;
  // Legacy format: { type: 'string' } → { kind: 'string' }
  const legacy = ts as unknown as Record<string, unknown>;
  if (typeof legacy['type'] === 'string') {
    return { ...legacy, kind: legacy['type'] as string } as TypeStructure;
  }
  return ts;
}

/** @deprecated Use TypeStructure instead. */
export type RillType = TypeStructure;

/**
 * Type value - represents a first-class type name at runtime.
 * Created when a type name expression (e.g. `string`, `number`) is evaluated.
 */
export interface RillTypeValue {
  readonly __rill_type: true;
  readonly typeName: RillTypeName;
  readonly structure: TypeStructure;
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

/** Infer the Rill type from a runtime value. Delegates to type-registrations. */
export const inferType: (value: RillValue) => string = registryInferType;

/**
 * Infer the element type for a homogeneous list.
 * Empty arrays return { kind: 'any' }.
 * Mixed types throw RILL-R002.
 */
export function inferElementType(elements: RillValue[]): TypeStructure {
  if (elements.length === 0) return { kind: 'any' };
  const firstElem = elements[0]!;
  let accType = inferStructure(firstElem);
  for (let i = 1; i < elements.length; i++) {
    const elem = elements[i]!;
    const elemType = inferStructure(elem);
    const merged = commonType(accType, elemType);
    if (merged === null) {
      throw new RuntimeError(
        'RILL-R002',
        `List elements must be the same type: expected ${formatStructure(accType)}, got ${formatStructure(elemType)} at index ${i}`
      );
    }
    accType = merged;
  }
  return accType;
}

/**
 * Merge uniform value types from two sides of the same compound type.
 * Sub-case A: both carry valueType -> recurse commonType.
 * Sub-case B: both carry structural fields -> extract value types, merge all.
 * Returns the merged TypeStructure on success, undefined when no uniform merge applies.
 */
function mergeUniformValueType(
  aValue: TypeStructure | undefined,
  bValue: TypeStructure | undefined,
  aFields: RillFieldDef[] | undefined,
  bFields: RillFieldDef[] | undefined
): TypeStructure | undefined {
  // Sub-case A: both carry valueType
  if (aValue !== undefined && bValue !== undefined) {
    const merged = commonType(aValue, bValue);
    if (merged !== null) return merged;
    return undefined;
  }

  // Sub-case B: both carry structural fields
  if (aFields !== undefined && bFields !== undefined) {
    const allTypes = [
      ...aFields.map((f) => f.type),
      ...bFields.map((f) => f.type),
    ];
    if (allTypes.length === 0) return undefined;
    let merged: TypeStructure = allTypes[0]!;
    for (let i = 1; i < allTypes.length; i++) {
      const next = commonType(merged, allTypes[i]!);
      if (next === null) return undefined;
      merged = next;
    }
    return merged;
  }

  return undefined;
}

/**
 * Return the most specific shared type for two TypeStructure values.
 * Returns null when types are incompatible at the top level.
 *
 * Cascade priority:
 * 1. Any-narrowing: if either side is `any`, return the other
 * 2. Structural match: delegate to structureEquals; on true, return a
 * 3. Recursive list: merge inner element types
 * 3b. Uniform valueType: merge dict/tuple/ordered value types
 * 4. Bare type fallback: same compound type but structural mismatch
 * 5. Incompatible: different top-level types return null
 */
export function commonType(
  a: TypeStructure,
  b: TypeStructure
): TypeStructure | null {
  // 1. Any-narrowing
  if (a.kind === 'any') return b;
  if (b.kind === 'any') return a;

  // 5. Incompatible top-level types (checked early to short-circuit)
  if (a.kind !== b.kind) return null;

  // 2. Structural match
  if (structureEquals(a, b)) return a;

  // 3. Recursive list element merging
  if (a.kind === 'list' && b.kind === 'list') {
    const aList = a as ListStructure;
    const bList = b as ListStructure;
    if (aList.element !== undefined && bList.element !== undefined) {
      const inner = commonType(aList.element, bList.element);
      if (inner !== null) return { kind: 'list', element: inner };
    }
    return { kind: 'list' };
  }

  // 3b. Uniform valueType merging for dict/tuple/ordered
  if (a.kind === 'dict' && b.kind === 'dict') {
    const aDict = a as DictStructure;
    const bDict = b as DictStructure;
    const merged = mergeUniformValueType(
      aDict.valueType,
      bDict.valueType,
      aDict.fields ? Object.values(aDict.fields) : undefined,
      bDict.fields ? Object.values(bDict.fields) : undefined
    );
    if (merged !== undefined) return { kind: 'dict', valueType: merged };
  }

  if (a.kind === 'tuple' && b.kind === 'tuple') {
    const aTuple = a as TupleStructure;
    const bTuple = b as TupleStructure;
    const merged = mergeUniformValueType(
      aTuple.valueType,
      bTuple.valueType,
      aTuple.elements,
      bTuple.elements
    );
    if (merged !== undefined) return { kind: 'tuple', valueType: merged };
  }

  if (a.kind === 'ordered' && b.kind === 'ordered') {
    const aOrd = a as OrderedStructure;
    const bOrd = b as OrderedStructure;
    const merged = mergeUniformValueType(
      aOrd.valueType,
      bOrd.valueType,
      aOrd.fields,
      bOrd.fields
    );
    if (merged !== undefined) return { kind: 'ordered', valueType: merged };
  }

  // 4. Bare type fallback for compound types.
  // The cast is safe for closure/dict/tuple/ordered (all sub-fields optional).
  // For union, members is required by TypeStructure but omitted here intentionally:
  // bare union signals structural incompatibility without enumerating members.
  if (
    a.kind === 'closure' ||
    a.kind === 'dict' ||
    a.kind === 'tuple' ||
    a.kind === 'ordered' ||
    a.kind === 'union'
  ) {
    return { kind: a.kind } as TypeStructure;
  }

  return null;
}

/** Compare two structural types for equality. */
export function structureEquals(a: TypeStructure, b: TypeStructure): boolean {
  if (a.kind !== b.kind) return false;

  // Leaf variants compare by kind alone
  if (
    a.kind === 'number' ||
    a.kind === 'string' ||
    a.kind === 'bool' ||
    a.kind === 'vector' ||
    a.kind === 'type' ||
    a.kind === 'any'
  ) {
    return true;
  }

  if (a.kind === 'list' && b.kind === 'list') {
    const aList = a as ListStructure;
    const bList = b as ListStructure;
    if (aList.element === undefined && bList.element === undefined) return true;
    if (aList.element === undefined || bList.element === undefined)
      return false;
    return structureEquals(aList.element, bList.element);
  }

  if (a.kind === 'dict' && b.kind === 'dict') {
    const aDict = a as DictStructure;
    const bDict = b as DictStructure;
    // Uniform valueType comparison
    const aHasValue = aDict.valueType !== undefined;
    const bHasValue = bDict.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return false;
      return structureEquals(aDict.valueType!, bDict.valueType!);
    }

    // Structural fields comparison
    if (aDict.fields === undefined && bDict.fields === undefined) return true;
    if (aDict.fields === undefined || bDict.fields === undefined) return false;
    const aKeys = Object.keys(aDict.fields).sort();
    const bKeys = Object.keys(bDict.fields).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i]!;
      if (key !== bKeys[i]) return false;
      const aField = aDict.fields[key]!;
      const bField = bDict.fields[key]!;
      const aHasDefault = aField.defaultValue !== undefined;
      const bHasDefault = bField.defaultValue !== undefined;
      if (aHasDefault !== bHasDefault) return false;
      if (!structureEquals(aField.type, bField.type)) return false;
      if (aHasDefault && bHasDefault) {
        if (!deepEquals(aField.defaultValue!, bField.defaultValue!))
          return false;
      }
    }
    return true;
  }

  if (a.kind === 'tuple' && b.kind === 'tuple') {
    const aTuple = a as TupleStructure;
    const bTuple = b as TupleStructure;
    // Uniform valueType comparison
    const aHasValue = aTuple.valueType !== undefined;
    const bHasValue = bTuple.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return false;
      return structureEquals(aTuple.valueType!, bTuple.valueType!);
    }

    // Structural elements comparison
    if (aTuple.elements === undefined && bTuple.elements === undefined)
      return true;
    if (aTuple.elements === undefined || bTuple.elements === undefined)
      return false;
    if (aTuple.elements.length !== bTuple.elements.length) return false;
    for (let i = 0; i < aTuple.elements.length; i++) {
      const aElem = aTuple.elements[i]!;
      const bElem = bTuple.elements[i]!;
      if (!structureEquals(aElem.type, bElem.type)) return false;
      const aDefault = aElem.defaultValue;
      const bDefault = bElem.defaultValue;
      if (aDefault === undefined && bDefault === undefined) continue;
      if (aDefault === undefined || bDefault === undefined) return false;
      if (!deepEquals(aDefault, bDefault)) return false;
    }
    return true;
  }

  if (a.kind === 'ordered' && b.kind === 'ordered') {
    const aOrd = a as OrderedStructure;
    const bOrd = b as OrderedStructure;
    // Uniform valueType comparison
    const aHasValue = aOrd.valueType !== undefined;
    const bHasValue = bOrd.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return false;
      return structureEquals(aOrd.valueType!, bOrd.valueType!);
    }

    // Structural fields comparison
    if (aOrd.fields === undefined && bOrd.fields === undefined) return true;
    if (aOrd.fields === undefined || bOrd.fields === undefined) return false;
    if (aOrd.fields.length !== bOrd.fields.length) return false;
    for (let i = 0; i < aOrd.fields.length; i++) {
      const aField = aOrd.fields[i]!;
      const bField = bOrd.fields[i]!;
      if (aField.name !== bField.name) return false;
      if (!structureEquals(aField.type, bField.type)) return false;
      const aDefault = aField.defaultValue;
      const bDefault = bField.defaultValue;
      if (aDefault === undefined && bDefault === undefined) continue;
      if (aDefault === undefined || bDefault === undefined) return false;
      if (!deepEquals(aDefault, bDefault)) return false;
    }
    return true;
  }

  if (a.kind === 'union' && b.kind === 'union') {
    const aUnion = a as UnionStructure;
    const bUnion = b as UnionStructure;
    if (aUnion.members.length !== bUnion.members.length) return false;
    for (let i = 0; i < aUnion.members.length; i++) {
      if (!structureEquals(aUnion.members[i]!, bUnion.members[i]!))
        return false;
    }
    return true;
  }

  if (a.kind === 'closure' && b.kind === 'closure') {
    const aCls = a as ClosureStructure;
    const bCls = b as ClosureStructure;
    if (aCls.params === undefined && bCls.params === undefined) {
      // Both absent: compare ret
    } else if (aCls.params === undefined || bCls.params === undefined) {
      return false;
    } else {
      if (aCls.params.length !== bCls.params.length) return false;
      for (let i = 0; i < aCls.params.length; i++) {
        const aParam = aCls.params[i]!;
        const bParam = bCls.params[i]!;
        if (aParam.name !== bParam.name) return false;
        if (!structureEquals(aParam.type, bParam.type)) return false;
        const aDefault = aParam.defaultValue;
        const bDefault = bParam.defaultValue;
        if (aDefault === undefined && bDefault === undefined) continue;
        if (aDefault === undefined || bDefault === undefined) return false;
        if (!deepEquals(aDefault, bDefault)) return false;
      }
    }
    if (aCls.ret === undefined && bCls.ret === undefined) return true;
    if (aCls.ret === undefined || bCls.ret === undefined) return false;
    return structureEquals(aCls.ret, bCls.ret);
  }

  return false;
}

/** @deprecated Use structureEquals instead. */
export const structuralTypeEquals = structureEquals;

/** Infer the structural type descriptor for any Rill value. */
export function inferStructure(value: RillValue): TypeStructure {
  if (value === null || typeof value === 'string') {
    return { kind: 'string' };
  }
  if (typeof value === 'number') {
    return { kind: 'number' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'bool' };
  }
  if (isTypeValue(value)) {
    return { kind: 'type' };
  }
  if (Array.isArray(value)) {
    return { kind: 'list', element: inferElementType(value) };
  }
  if (isTuple(value)) {
    return {
      kind: 'tuple',
      elements: value.entries.map(
        (e): RillFieldDef => ({
          type: inferStructure(e),
        })
      ),
    };
  }
  if (isOrdered(value)) {
    return {
      kind: 'ordered',
      fields: value.entries.map(
        ([k, v]): RillFieldDef => ({
          name: k,
          type: inferStructure(v),
        })
      ),
    };
  }
  if (isVector(value)) {
    return { kind: 'vector' };
  }
  if (isCallable(value)) {
    const params = (value.params ?? []).map((p) =>
      paramToFieldDef(p.name, p.type ?? { kind: 'any' }, p.defaultValue)
    );
    const ret: TypeStructure = value.returnType.structure;
    return { kind: 'closure', params, ret };
  }
  if (typeof value === 'object') {
    const dict = value as Record<string, RillValue>;
    const fields: Record<string, RillFieldDef> = {};
    for (const [k, v] of Object.entries(dict)) {
      fields[k] = { type: inferStructure(v) };
    }
    return { kind: 'dict', fields };
  }
  throw new RuntimeError(
    'RILL-R004',
    `Cannot infer structural type for ${formatValue(value as RillValue)}`
  );
}

/** @deprecated Use inferStructure instead. */
export const inferStructuralType = inferStructure;

/**
 * Check if a value matches a structural type descriptor.
 * Used for runtime type checking (`:?` operator).
 */
export function structureMatches(
  value: RillValue,
  type: TypeStructure
): boolean {
  type = normalizeStructure(type);
  if (typeof value === 'undefined') {
    throw new RuntimeError('RILL-R004', 'Cannot type-check non-value');
  }

  if (type.kind === 'any') return true;

  // Leaf primitive variants: match by inferred type name
  if (
    type.kind === 'number' ||
    type.kind === 'string' ||
    type.kind === 'bool' ||
    type.kind === 'vector' ||
    type.kind === 'type'
  ) {
    return inferType(value) === type.kind;
  }

  if (type.kind === 'list') {
    const t = type as ListStructure;
    if (!Array.isArray(value)) return false;
    if (t.element === undefined) return true;
    if (t.element.kind === 'any') return true;
    return value.every((elem) => structureMatches(elem, t.element!));
  }

  if (type.kind === 'dict') {
    const t = type as DictStructure;
    if (!isDict(value)) return false;
    if (t.valueType !== undefined) {
      const vals = Object.values(value as Record<string, RillValue>);
      return vals.every((v) => structureMatches(v, t.valueType!));
    }
    if (t.fields === undefined) return true;
    const dictKeys = Object.keys(t.fields);
    if (dictKeys.length === 0) return true;
    const dict = value as Record<string, RillValue>;
    for (const key of dictKeys) {
      if (!(key in dict)) {
        const field = t.fields[key]!;
        if (field.defaultValue !== undefined) continue;
        return false;
      }
      const field = t.fields[key]!;
      if (!structureMatches(dict[key]!, field.type)) return false;
    }
    return true;
  }

  if (type.kind === 'tuple') {
    const t = type as TupleStructure;
    if (!isTuple(value)) return false;
    if (t.valueType !== undefined) {
      return value.entries.every((v) => structureMatches(v, t.valueType!));
    }
    if (t.elements === undefined) return true;
    if (t.elements.length === 0) return value.entries.length === 0;
    if (value.entries.length > t.elements.length) return false;
    if (value.entries.length < t.elements.length) {
      for (let i = value.entries.length; i < t.elements.length; i++) {
        const field = t.elements[i]!;
        if (field.defaultValue === undefined) return false;
      }
    }
    for (let i = 0; i < value.entries.length; i++) {
      if (!structureMatches(value.entries[i]!, t.elements[i]!.type))
        return false;
    }
    return true;
  }

  if (type.kind === 'ordered') {
    const t = type as OrderedStructure;
    if (!isOrdered(value)) return false;
    if (t.valueType !== undefined) {
      return value.entries.every(([, v]) => structureMatches(v, t.valueType!));
    }
    if (t.fields === undefined) return true;
    if (t.fields.length === 0) return value.entries.length === 0;
    if (value.entries.length > t.fields.length) return false;
    if (value.entries.length < t.fields.length) {
      for (let i = value.entries.length; i < t.fields.length; i++) {
        const field = t.fields[i]!;
        if (field.defaultValue === undefined) return false;
      }
    }
    for (let i = 0; i < value.entries.length; i++) {
      const field = t.fields[i]!;
      const [actualName, actualValue] = value.entries[i]!;
      if (actualName !== field.name) return false;
      if (!structureMatches(actualValue, field.type)) return false;
    }
    return true;
  }

  if (type.kind === 'closure') {
    const t = type as ClosureStructure;
    if (!isCallable(value)) return false;
    if (t.params === undefined) return true;
    const valueParams = value.params ?? [];
    if (valueParams.length !== t.params.length) return false;
    for (let i = 0; i < t.params.length; i++) {
      const field = t.params[i]!;
      const param = valueParams[i]!;
      if (param.name !== field.name) return false;
      const paramType: TypeStructure = param.type ?? { kind: 'any' };
      if (!structureEquals(paramType, field.type)) return false;
    }
    const retType: TypeStructure = value.returnType.structure;
    if (t.ret === undefined) return true;
    return structureEquals(retType, t.ret);
  }

  if (type.kind === 'union') {
    const t = type as UnionStructure;
    return t.members.some((member) => structureMatches(value, member));
  }

  return false;
}

/** @deprecated Use structureMatches instead. */
export const structuralTypeMatches = structureMatches;

/** Build a closure param field definition from name, type, and optional default. */
export function paramToFieldDef(
  name: string,
  type: TypeStructure,
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
export function formatStructure(type: TypeStructure): string {
  if (
    type.kind === 'any' ||
    type.kind === 'number' ||
    type.kind === 'string' ||
    type.kind === 'bool' ||
    type.kind === 'vector' ||
    type.kind === 'type'
  ) {
    return type.kind;
  }

  if (type.kind === 'list') {
    const t = type as ListStructure;
    if (t.element === undefined) return 'list';
    return `list(${formatStructure(t.element)})`;
  }

  if (type.kind === 'dict') {
    const t = type as DictStructure;
    if (t.valueType !== undefined && t.fields === undefined) {
      return `dict(${formatStructure(t.valueType)})`;
    }
    if (t.fields === undefined) return 'dict';
    const parts = Object.keys(t.fields)
      .sort()
      .map((k) => {
        const field = t.fields![k]!;
        const base = `${k}: ${formatStructure(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      });
    return `dict(${parts.join(', ')})`;
  }

  if (type.kind === 'tuple') {
    const t = type as TupleStructure;
    if (t.valueType !== undefined && t.elements === undefined) {
      return `tuple(${formatStructure(t.valueType)})`;
    }
    if (t.elements === undefined) return 'tuple';
    const parts = t.elements.map((field) => {
      const base = formatStructure(field.type);
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return `tuple(${parts.join(', ')})`;
  }

  if (type.kind === 'ordered') {
    const t = type as OrderedStructure;
    if (t.valueType !== undefined && t.fields === undefined) {
      return `ordered(${formatStructure(t.valueType)})`;
    }
    if (t.fields === undefined) return 'ordered';
    const parts = t.fields.map((field) => {
      const base = `${field.name}: ${formatStructure(field.type)}`;
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return `ordered(${parts.join(', ')})`;
  }

  if (type.kind === 'closure') {
    const t = type as ClosureStructure;
    if (t.params === undefined) return 'closure';
    const params = t.params
      .map((field) => {
        const base = `${field.name}: ${formatStructure(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      })
      .join(', ');
    const ret = t.ret !== undefined ? formatStructure(t.ret) : 'any';
    return `|${params}| :${ret}`;
  }

  if (type.kind === 'union') {
    const t = type as UnionStructure;
    return t.members.map(formatStructure).join('|');
  }

  return 'any';
}

/** @deprecated Use formatStructure instead. */
export const formatStructuralType = formatStructure;

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

/** @deprecated Use serializeValue instead. */
export const valueToJSON = serializeValue;

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

  if (isTypeValue(value)) {
    return {
      name: value.typeName,
      signature: formatStructure(value.structure),
    };
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

/** @deprecated Use structureToTypeValue instead. */
export const rillTypeToTypeValue = structureToTypeValue;

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
export function isIterator(value: RillValue): value is RillIterator {
  if (!isDict(value)) return false;
  const dict = value as Record<string, RillValue>;
  if (!('done' in dict && typeof dict['done'] === 'boolean')) return false;
  if (!('next' in dict && isCallable(dict['next']))) return false;
  // 'value' field only required when not done
  if (!dict['done'] && !('value' in dict)) return false;
  return true;
}

/** @deprecated Use isIterator instead. */
export const isRillIterator = isIterator;

/** Copy a RillValue. Delegates to type-registrations. */
export const copyValue: (value: RillValue) => RillValue = registryCopyValue;

/** @deprecated Use copyValue instead. */
export const deepCopyRillValue = copyValue;
