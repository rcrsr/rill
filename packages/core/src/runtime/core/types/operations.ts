/**
 * Type Structure Operations
 *
 * Structural comparison, matching, inference, and formatting functions
 * extracted from values.ts. Provides `compareStructuredFields()` to
 * deduplicate dict/tuple/ordered dispatch across structureEquals,
 * structureMatches, and formatStructure.
 *
 * Import constraints:
 * - Imports from ./structures.js, ./guards.js, ./registrations.js
 * - Circular with registrations.ts (runtime-safe: no init-time cross-calls)
 */

import { RuntimeError } from '../../../types.js';
import type { RillCallable } from '../callable.js';
import {
  isCallable as _isCallableGuard,
  isDict,
  isOrdered,
  isTuple,
  isTypeValue,
  isVector,
} from './guards.js';
import {
  inferType as registryInferType,
  formatValue as registryFormatValue,
  deepEquals as registryDeepEquals,
} from './registrations.js';
import type { RillFieldDef, RillValue, TypeStructure } from './structures.js';

/** isCallable guard widened to narrow to full RillCallable (not just CallableMarker) */
const isCallable = _isCallableGuard as (
  value: RillValue
) => value is RillCallable;

// ============================================================
// NARROWED VARIANT TYPES
// ============================================================

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

// ============================================================
// FIELD COMPARISON DISPATCH
// ============================================================

/**
 * Callbacks for kind-specific field dispatch in dict/tuple/ordered types.
 * `compareStructuredFields` handles the common valueType check and
 * kind-based field extraction, then delegates to these callbacks.
 */
export interface FieldComparisonCallbacks<T> {
  /** Both structures carry a uniform valueType */
  onValueType(aValueType: TypeStructure, bValueType: TypeStructure): T;
  /** One structure has valueType, the other does not */
  onValueTypeMismatch(): T;
  /** Neither structure has fields/elements */
  onBothEmpty(): T;
  /** One structure has fields/elements, the other does not */
  onFieldPresenceMismatch(): T;
  /** Dict with keyed fields on both sides */
  onDictFields(
    aFields: Record<string, RillFieldDef>,
    bFields: Record<string, RillFieldDef>
  ): T;
  /** Tuple with positional elements on both sides */
  onTupleElements(aElements: RillFieldDef[], bElements: RillFieldDef[]): T;
  /** Ordered with named positional fields on both sides */
  onOrderedFields(aFields: RillFieldDef[], bFields: RillFieldDef[]): T;
}

/**
 * Shared dispatch for dict/tuple/ordered field comparison.
 * Handles valueType check and field iteration across
 * structureEquals, structureMatches, and formatStructure.
 *
 * Constraints:
 * - Dict: keyed fields, sorted key comparison
 * - Tuple: positional elements
 * - Ordered: named positional fields
 * - Recurses via caller-provided callbacks
 *
 * Callers validate that a.kind === b.kind before calling.
 * Invalid kind values fall through to the final return.
 */
export function compareStructuredFields<T>(
  a: TypeStructure,
  b: TypeStructure,
  callbacks: FieldComparisonCallbacks<T>,
  fallback: T
): T {
  if (a.kind === 'dict') {
    const aDict = a as DictStructure;
    const bDict = b as DictStructure;
    const aHasValue = aDict.valueType !== undefined;
    const bHasValue = bDict.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aDict.valueType!, bDict.valueType!);
    }
    if (aDict.fields === undefined && bDict.fields === undefined) {
      return callbacks.onBothEmpty();
    }
    if (aDict.fields === undefined || bDict.fields === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onDictFields(aDict.fields, bDict.fields);
  }

  if (a.kind === 'tuple') {
    const aTuple = a as TupleStructure;
    const bTuple = b as TupleStructure;
    const aHasValue = aTuple.valueType !== undefined;
    const bHasValue = bTuple.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aTuple.valueType!, bTuple.valueType!);
    }
    if (aTuple.elements === undefined && bTuple.elements === undefined) {
      return callbacks.onBothEmpty();
    }
    if (aTuple.elements === undefined || bTuple.elements === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onTupleElements(aTuple.elements, bTuple.elements);
  }

  if (a.kind === 'ordered') {
    const aOrd = a as OrderedStructure;
    const bOrd = b as OrderedStructure;
    const aHasValue = aOrd.valueType !== undefined;
    const bHasValue = bOrd.valueType !== undefined;
    if (aHasValue || bHasValue) {
      if (!aHasValue || !bHasValue) return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aOrd.valueType!, bOrd.valueType!);
    }
    if (aOrd.fields === undefined && bOrd.fields === undefined) {
      return callbacks.onBothEmpty();
    }
    if (aOrd.fields === undefined || bOrd.fields === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onOrderedFields(aOrd.fields, bOrd.fields);
  }

  return fallback;
}

// ============================================================
// PRIVATE HELPERS
// ============================================================

/**
 * Normalize a TypeStructure that may use the legacy `.type` discriminator.
 * During migration, some code constructs objects with `{ type: 'string' }`
 * instead of `{ kind: 'string' }`. Converts legacy format on the fly.
 */
function normalizeStructure(ts: TypeStructure): TypeStructure {
  if (ts.kind !== undefined) return ts;
  const legacy = ts as unknown as Record<string, unknown>;
  if (typeof legacy['type'] === 'string') {
    return { ...legacy, kind: legacy['type'] as string } as TypeStructure;
  }
  return ts;
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
  return registryFormatValue(value);
}

/**
 * Compare sequential (positional) RillFieldDef arrays for structural equality.
 * Shared by tuple elements and ordered fields. When `named` is true,
 * compares field names in addition to types and defaults.
 */
function compareSequentialFields(
  aFields: RillFieldDef[],
  bFields: RillFieldDef[],
  named: boolean
): boolean {
  if (aFields.length !== bFields.length) return false;
  for (let i = 0; i < aFields.length; i++) {
    const aField = aFields[i]!;
    const bField = bFields[i]!;
    if (named && aField.name !== bField.name) return false;
    if (!structureEquals(aField.type, bField.type)) return false;
    const aDefault = aField.defaultValue;
    const bDefault = bField.defaultValue;
    if (aDefault === undefined && bDefault === undefined) continue;
    if (aDefault === undefined || bDefault === undefined) return false;
    if (!registryDeepEquals(aDefault, bDefault)) return false;
  }
  return true;
}

// ============================================================
// STRUCTURE EQUALS
// ============================================================

/** Equality callbacks for compareStructuredFields */
const equalsCallbacks: FieldComparisonCallbacks<boolean> = {
  onValueType: (aVT, bVT) => structureEquals(aVT, bVT),
  onValueTypeMismatch: () => false,
  onBothEmpty: () => true,
  onFieldPresenceMismatch: () => false,
  onDictFields(aFields, bFields) {
    const aKeys = Object.keys(aFields).sort();
    const bKeys = Object.keys(bFields).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i]!;
      if (key !== bKeys[i]) return false;
      const aField = aFields[key]!;
      const bField = bFields[key]!;
      const aHasDefault = aField.defaultValue !== undefined;
      const bHasDefault = bField.defaultValue !== undefined;
      if (aHasDefault !== bHasDefault) return false;
      if (!structureEquals(aField.type, bField.type)) return false;
      if (aHasDefault && bHasDefault) {
        if (!registryDeepEquals(aField.defaultValue!, bField.defaultValue!))
          return false;
      }
    }
    return true;
  },
  onTupleElements: (a, b) => compareSequentialFields(a, b, false),
  onOrderedFields: (a, b) => compareSequentialFields(a, b, true),
};

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

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (a.kind === 'dict' || a.kind === 'tuple' || a.kind === 'ordered') {
    return compareStructuredFields(a, b, equalsCallbacks, false);
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
        if (!registryDeepEquals(aDefault, bDefault)) return false;
      }
    }
    if (aCls.ret === undefined && bCls.ret === undefined) return true;
    if (aCls.ret === undefined || bCls.ret === undefined) return false;
    return structureEquals(aCls.ret, bCls.ret);
  }

  return false;
}

// ============================================================
// STRUCTURE MATCHES
// ============================================================

/**
 * Create structureMatches callbacks that capture the runtime value.
 * Dict checks keys against type fields. Tuple and ordered check
 * entries against type elements/fields.
 */
function createMatchesCallbacks(
  value: RillValue
): FieldComparisonCallbacks<boolean> {
  return {
    onValueType(valueType) {
      // Uniform valueType: check all values match the type.
      // Order matters: isOrdered/isTuple before isDict because
      // ordered and tuple values also satisfy isDict.
      if (isTuple(value)) {
        return value.entries.every((v) => structureMatches(v, valueType));
      }
      if (isOrdered(value)) {
        return value.entries.every(([, v]) => structureMatches(v, valueType));
      }
      if (isDict(value)) {
        const vals = Object.values(value as Record<string, RillValue>);
        return vals.every((v) => structureMatches(v, valueType));
      }
      return false;
    },
    onValueTypeMismatch: () => false,
    onBothEmpty: () => true,
    onFieldPresenceMismatch: () => false,
    onDictFields(fields) {
      const dictKeys = Object.keys(fields);
      if (dictKeys.length === 0) return true;
      const dict = value as Record<string, RillValue>;
      for (const key of dictKeys) {
        if (!(key in dict)) {
          const field = fields[key]!;
          if (field.defaultValue !== undefined) continue;
          return false;
        }
        const field = fields[key]!;
        if (!structureMatches(dict[key]!, field.type)) return false;
      }
      return true;
    },
    onTupleElements(elements) {
      if (!isTuple(value)) return false;
      if (elements.length === 0) return value.entries.length === 0;
      if (value.entries.length > elements.length) return false;
      if (value.entries.length < elements.length) {
        for (let i = value.entries.length; i < elements.length; i++) {
          const field = elements[i]!;
          if (field.defaultValue === undefined) return false;
        }
      }
      for (let i = 0; i < value.entries.length; i++) {
        if (!structureMatches(value.entries[i]!, elements[i]!.type))
          return false;
      }
      return true;
    },
    onOrderedFields(fields) {
      if (!isOrdered(value)) return false;
      if (fields.length === 0) return value.entries.length === 0;
      if (value.entries.length > fields.length) return false;
      if (value.entries.length < fields.length) {
        for (let i = value.entries.length; i < fields.length; i++) {
          const field = fields[i]!;
          if (field.defaultValue === undefined) return false;
        }
      }
      for (let i = 0; i < value.entries.length; i++) {
        const field = fields[i]!;
        const [actualName, actualValue] = value.entries[i]!;
        if (actualName !== field.name) return false;
        if (!structureMatches(actualValue, field.type)) return false;
      }
      return true;
    },
  };
}

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
    return registryInferType(value) === type.kind;
  }

  if (type.kind === 'list') {
    const t = type as ListStructure;
    if (!Array.isArray(value)) return false;
    if (t.element === undefined) return true;
    if (t.element.kind === 'any') return true;
    return value.every((elem) => structureMatches(elem, t.element!));
  }

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (type.kind === 'dict') {
    if (!isDict(value)) return false;
    return compareStructuredFields(
      type,
      type,
      createMatchesCallbacks(value),
      false
    );
  }

  if (type.kind === 'tuple') {
    if (!isTuple(value)) return false;
    return compareStructuredFields(
      type,
      type,
      createMatchesCallbacks(value),
      false
    );
  }

  if (type.kind === 'ordered') {
    if (!isOrdered(value)) return false;
    return compareStructuredFields(
      type,
      type,
      createMatchesCallbacks(value),
      false
    );
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

// ============================================================
// FORMAT STRUCTURE
// ============================================================

/**
 * Format callbacks for compareStructuredFields.
 * Returns `null` for bare types (no fields, no valueType) so the caller
 * can distinguish "fields: undefined" from "fields: {}".
 */
const formatCallbacks: FieldComparisonCallbacks<string | null> = {
  onValueType(valueType) {
    return formatStructure(valueType);
  },
  onValueTypeMismatch: () => null,
  onBothEmpty: () => null,
  onFieldPresenceMismatch: () => null,
  onDictFields(fields) {
    const parts = Object.keys(fields)
      .sort()
      .map((k) => {
        const field = fields[k]!;
        const base = `${k}: ${formatStructure(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      });
    return parts.join(', ');
  },
  onTupleElements(elements) {
    const parts = elements.map((field) => {
      const base = formatStructure(field.type);
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return parts.join(', ');
  },
  onOrderedFields(fields) {
    const parts = fields.map((field) => {
      const base = `${field.name}: ${formatStructure(field.type)}`;
      if (field.defaultValue === undefined) return base;
      return `${base} = ${formatRillLiteral(field.defaultValue)}`;
    });
    return parts.join(', ');
  },
};

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

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (
    type.kind === 'dict' ||
    type.kind === 'tuple' ||
    type.kind === 'ordered'
  ) {
    const inner = compareStructuredFields(type, type, formatCallbacks, null);
    // Bare type (no fields, no valueType): null signals undefined fields
    if (inner === null) return type.kind;
    return `${type.kind}(${inner})`;
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

// ============================================================
// INFER STRUCTURE
// ============================================================

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
    `Cannot infer structural type for ${registryFormatValue(value as RillValue)}`
  );
}

// ============================================================
// COMMON TYPE
// ============================================================

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
