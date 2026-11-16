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

import type { RillCallable } from '../callable.js';
import { declaredParams } from '../callable.js';
import {
  isAtom,
  isCallable as _isCallableGuard,
  isDatetime,
  isDict,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isStructureKind,
  isTuple,
  isTypeValue,
  isVector,
  getStreamTypeSidecar,
} from './guards.js';
import { throwTypeHalt } from './halt.js';
import {
  inferType as registryInferType,
  formatValue as registryFormatValue,
  deepEquals as registryDeepEquals,
} from './registrations.js';
import type { RillFieldDef, RillValue, TypeStructure } from './structures.js';
import type { DefaultMismatch } from './field-defaults.js';
import { quoteRillString } from './format-string.js';
import { typedKeyEntries, setDictField } from './dict-keys.js';
import { formatUnion } from './error-code.js';
// oxlint-disable-next-line import/no-cycle -- unions.ts imports this file; the edge is used only at call time, never at module init
import { normalizeUnion } from './unions.js';

/** isCallable guard widened to narrow to full RillCallable (not just CallableMarker); a CallableMarker implies RillCallable by construction. */
function isCallable(value: RillValue): value is RillCallable {
  return _isCallableGuard(value);
}

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
  if (isStructureKind(a, 'dict') && isStructureKind(b, 'dict')) {
    const aValue = a.valueType;
    const bValue = b.valueType;
    if (aValue !== undefined || bValue !== undefined) {
      if (aValue === undefined || bValue === undefined)
        return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aValue, bValue);
    }
    if (a.fields === undefined && b.fields === undefined) {
      return callbacks.onBothEmpty();
    }
    if (a.fields === undefined || b.fields === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onDictFields(a.fields, b.fields);
  }

  if (isStructureKind(a, 'tuple') && isStructureKind(b, 'tuple')) {
    if (a.elements === undefined && b.elements === undefined) {
      return callbacks.onBothEmpty();
    }
    if (a.elements === undefined || b.elements === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onTupleElements(a.elements, b.elements);
  }

  if (isStructureKind(a, 'ordered') && isStructureKind(b, 'ordered')) {
    const aValue = a.valueType;
    const bValue = b.valueType;
    if (aValue !== undefined || bValue !== undefined) {
      if (aValue === undefined || bValue === undefined)
        return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aValue, bValue);
    }
    if (a.fields === undefined && b.fields === undefined) {
      return callbacks.onBothEmpty();
    }
    if (a.fields === undefined || b.fields === undefined) {
      return callbacks.onFieldPresenceMismatch();
    }
    return callbacks.onOrderedFields(a.fields, b.fields);
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
  const legacy: object = ts;
  if ('type' in legacy && typeof legacy.type === 'string') {
    return { ...legacy, kind: legacy.type };
  }
  return ts;
}

/** Format a RillValue as a rill literal for use in type signatures. */
export function formatRillLiteral(value: RillValue): string {
  if (typeof value === 'string') return quoteRillString(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';

  // List: bare bracket form [elem, ...]
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map(formatRillLiteral).join(', ')}]`;
  }

  // Tuple: tuple[elem, ...]
  if (isTuple(value)) {
    return `tuple[${value.entries.map(formatRillLiteral).join(', ')}]`;
  }

  // Ordered: ordered[key: val, ...]
  if (isOrdered(value)) {
    const inner = value.entries
      .map(([k, v]) => `${k}: ${formatRillLiteral(v)}`)
      .join(', ');
    return `ordered[${inner}]`;
  }

  // Non-literal compound types: fall through to display format
  if (
    isVector(value) ||
    isIterator(value) ||
    isStream(value) ||
    _isCallableGuard(value) ||
    isTypeValue(value)
  ) {
    return registryFormatValue(value);
  }

  // Atom: #name
  if (isAtom(value)) return `#${value.atom.name}`;

  // Dict: bare bracket form [key: val, ...] or [:] for empty
  if (isDict(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '[:]';
    const inner = entries
      .map(([k, v]) => `${k}: ${formatRillLiteral(v)}`)
      .join(', ');
    return `[${inner}]`;
  }

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
  for (const [i, aField] of aFields.entries()) {
    const bField = bFields[i];
    if (bField === undefined) return false;
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
    for (const [i, key] of aKeys.entries()) {
      if (key !== bKeys[i]) return false;
      const aField = aFields[key];
      const bField = bFields[key];
      if (aField === undefined || bField === undefined) return false;
      const aDefault = aField.defaultValue;
      const bDefault = bField.defaultValue;
      if ((aDefault !== undefined) !== (bDefault !== undefined)) return false;
      if (!structureEquals(aField.type, bField.type)) return false;
      if (aDefault !== undefined && bDefault !== undefined) {
        if (!registryDeepEquals(aDefault, bDefault)) return false;
      }
    }
    return true;
  },
  onTupleElements: (a, b) => compareSequentialFields(a, b, false),
  onOrderedFields: (a, b) => compareSequentialFields(a, b, true),
};

/** The unspecified type slot: an absent element, chunk, or ret reads as `any`. */
const ANY_STRUCTURE: TypeStructure = Object.freeze({ kind: 'any' });

/** Compare two structural types for equality. */
export function structureEquals(a: TypeStructure, b: TypeStructure): boolean {
  if (a.kind !== b.kind) return false;

  // Leaf variants compare by kind alone. `a.kind === b.kind` is already
  // established above, so any scalar leaf kind is equal to its twin.
  if (
    a.kind === 'number' ||
    a.kind === 'string' ||
    a.kind === 'bool' ||
    a.kind === 'vector' ||
    a.kind === 'type' ||
    a.kind === 'any' ||
    a.kind === 'datetime' ||
    a.kind === 'duration' ||
    a.kind === 'atom' ||
    a.kind === 'iterator'
  ) {
    return true;
  }

  if (isStructureKind(a, 'list') && isStructureKind(b, 'list')) {
    // An absent element is unspecified and equals `any`.
    return structureEquals(
      a.element ?? ANY_STRUCTURE,
      b.element ?? ANY_STRUCTURE
    );
  }

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (a.kind === 'dict' || a.kind === 'tuple' || a.kind === 'ordered') {
    return compareStructuredFields(a, b, equalsCallbacks, false);
  }

  if (isStructureKind(a, 'literal') && isStructureKind(b, 'literal')) {
    return registryDeepEquals(a.value, b.value);
  }

  if (isStructureKind(a, 'union') && isStructureKind(b, 'union')) {
    const aUnion = a;
    const bUnion = b;
    // Unions are sets: equal iff they have the same members regardless of
    // order. Each member of `a` must have a structural match in `b`, and
    // vice versa. Equal lengths plus one-directional coverage suffices
    // only when members are distinct, so check both directions.
    if (aUnion.members.length !== bUnion.members.length) return false;
    const everyAInB = aUnion.members.every((am) =>
      bUnion.members.some((bm) => structureEquals(am, bm))
    );
    if (!everyAInB) return false;
    const everyBInA = bUnion.members.every((bm) =>
      aUnion.members.some((am) => structureEquals(bm, am))
    );
    return everyBInA;
  }

  if (isStructureKind(a, 'stream') && isStructureKind(b, 'stream')) {
    const aStream = a;
    const bStream = b;
    // An absent chunk or ret is unspecified and equals `any`.
    return (
      structureEquals(
        aStream.chunk ?? ANY_STRUCTURE,
        bStream.chunk ?? ANY_STRUCTURE
      ) &&
      structureEquals(
        aStream.ret ?? ANY_STRUCTURE,
        bStream.ret ?? ANY_STRUCTURE
      )
    );
  }

  if (isStructureKind(a, 'closure') && isStructureKind(b, 'closure')) {
    const aCls = a;
    const bCls = b;
    if (aCls.params === undefined && bCls.params === undefined) {
      // Both absent: compare ret
    } else if (aCls.params === undefined || bCls.params === undefined) {
      return false;
    } else {
      if (aCls.params.length !== bCls.params.length) return false;
      for (const [i, aParam] of aCls.params.entries()) {
        const bParam = bCls.params[i];
        if (bParam === undefined) return false;
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
      // Order matters: isOrdered before isDict because ordered values
      // also satisfy isDict.
      if (isOrdered(value)) {
        return value.entries.every(([, v]) => structureMatches(v, valueType));
      }
      if (isDict(value)) {
        const dict = value;
        const vals = Object.values(dict);
        if (!vals.every((v) => structureMatches(v, valueType))) return false;
        // Number/boolean keys are stored outside the string-keyed record,
        // so they must be checked separately to enforce a uniform valueType.
        return typedKeyEntries(dict).every(({ value: v }) =>
          structureMatches(v, valueType)
        );
      }
      return false;
    },
    onValueTypeMismatch: () => false,
    onBothEmpty: () => true,
    onFieldPresenceMismatch: () => false,
    onDictFields(fields) {
      const dictKeys = Object.keys(fields);
      if (dictKeys.length === 0) return true;
      if (!isDict(value)) return false;
      for (const [key, field] of Object.entries(fields)) {
        if (!(key in value)) {
          if (field.defaultValue !== undefined) continue;
          return false;
        }
        const actual = value[key];
        if (actual === undefined || !structureMatches(actual, field.type))
          return false;
      }
      return true;
    },
    onTupleElements(elements) {
      if (!isTuple(value)) return false;
      if (elements.length === 0) return value.entries.length === 0;
      if (value.entries.length > elements.length) return false;
      if (value.entries.length < elements.length) {
        for (const field of elements.slice(value.entries.length)) {
          if (field.defaultValue === undefined) return false;
        }
      }
      for (const [i, entry] of value.entries.entries()) {
        const field = elements[i];
        if (field === undefined || !structureMatches(entry, field.type))
          return false;
      }
      return true;
    },
    onOrderedFields(fields) {
      if (!isOrdered(value)) return false;
      if (fields.length === 0) return value.entries.length === 0;
      if (value.entries.length > fields.length) return false;
      if (value.entries.length < fields.length) {
        for (const field of fields.slice(value.entries.length)) {
          if (field.defaultValue === undefined) return false;
        }
      }
      for (const [i, [actualName, actualValue]] of value.entries.entries()) {
        const field = fields[i];
        if (field === undefined) return false;
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
    throwTypeHalt(
      { fn: 'structureMatches' },
      'INVALID_INPUT',
      'Cannot type-check non-value',
      'runtime',
      undefined,
      'host'
    );
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

  if (isStructureKind(type, 'list')) {
    if (!Array.isArray(value)) return false;
    const element = type.element;
    if (element === undefined || element.kind === 'any') return true;
    return value.every((elem) => structureMatches(elem, element));
  }

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (type.kind === 'dict') {
    // A dict TYPE matches only plain dict values. Branded non-dicts
    // (datetime, duration, atom, type-value, ordered, iterator, stream,
    // vector) structurally satisfy isDict but are distinct types, so gate
    // on the inferred type name, which resolves each brand ahead of dict.
    if (registryInferType(value) !== 'dict') return false;
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

  if (isStructureKind(type, 'stream')) {
    if (!isStream(value)) return false;
    const { chunk, ret } = type;
    if (chunk !== undefined && !isUnspecified(chunk)) {
      const valueChunk = getStreamTypeSidecar(value, 'chunk');
      if (valueChunk !== undefined && !structureEquals(valueChunk, chunk))
        return false;
    }
    if (ret !== undefined && !isUnspecified(ret)) {
      const valueRet = getStreamTypeSidecar(value, 'ret');
      if (valueRet !== undefined && !structureEquals(valueRet, ret))
        return false;
    }
    return true;
  }

  if (isStructureKind(type, 'closure')) {
    if (!isCallable(value) || value.returnType === undefined) return false;
    if (type.params === undefined) return true;
    const valueParams = declaredParams(value);
    if (valueParams.length !== type.params.length) return false;
    for (const [i, field] of type.params.entries()) {
      const param = valueParams[i];
      if (param === undefined) return false;
      if (param.name !== field.name) return false;
      const paramType: TypeStructure = param.type ?? { kind: 'any' };
      if (!structureEquals(paramType, field.type)) return false;
      // Directional default rules: value (superset) satisfies type (contract)
      const valueDefault = param.defaultValue;
      const typeDefault = field.defaultValue;
      if (valueDefault === undefined && typeDefault !== undefined) return false;
      if (valueDefault !== undefined && typeDefault !== undefined) {
        if (!registryDeepEquals(valueDefault, typeDefault)) return false;
      }
      // value has default + type lacks → compatible (superset satisfies)
      // neither has default → compatible
    }
    const retType: TypeStructure = value.returnType.structure;
    if (type.ret === undefined) return true;
    return structureEquals(retType, type.ret);
  }

  if (isStructureKind(type, 'literal')) {
    return registryDeepEquals(value, type.value);
  }

  if (isStructureKind(type, 'union')) {
    return type.members.some((member) => structureMatches(value, member));
  }

  if (type.kind === 'datetime') return isDatetime(value);
  if (type.kind === 'duration') return isDuration(value);
  if (type.kind === 'atom') return isAtom(value);
  if (type.kind === 'iterator') return isIterator(value);

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
    const parts = Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, field]) => {
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

/** Describe the mismatch between a default value and its declared type, or null when it matches. */
export function defaultMismatch(
  value: RillValue,
  type: TypeStructure
): DefaultMismatch | null {
  if (structureMatches(value, type)) return null;
  return {
    expectedType: formatStructure(type),
    actualType: registryInferType(value),
  };
}

/** True when a type slot is omitted or `any`: both read as unspecified. */
function isUnspecified(
  slot: TypeStructure | undefined
): slot is undefined | { kind: 'any' } {
  return slot === undefined || slot.kind === 'any';
}

/** Format a structural type descriptor as a human-readable string. */
export function formatStructure(type: TypeStructure): string {
  if (
    type.kind === 'any' ||
    type.kind === 'number' ||
    type.kind === 'string' ||
    type.kind === 'bool' ||
    type.kind === 'vector' ||
    type.kind === 'type' ||
    type.kind === 'datetime' ||
    type.kind === 'duration' ||
    type.kind === 'atom' ||
    type.kind === 'iterator'
  ) {
    return type.kind;
  }

  // An unspecified container prints as its bare name, so equal types print
  // alike: list, list(), and list(any) all print `list`.
  if (isStructureKind(type, 'list')) {
    if (isUnspecified(type.element)) return 'list';
    return `list(${formatStructure(type.element)})`;
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

  if (isStructureKind(type, 'stream')) {
    if (isUnspecified(type.chunk) && isUnspecified(type.ret)) return 'stream';
    const chunkStr =
      type.chunk !== undefined ? formatStructure(type.chunk) : 'any';
    const retStr = isUnspecified(type.ret)
      ? ''
      : `:${formatStructure(type.ret)}`;
    return `stream(${chunkStr})${retStr}`;
  }

  if (isStructureKind(type, 'closure')) {
    if (type.params === undefined) return 'closure';
    const params = type.params
      .map((field) => {
        const base = `${field.name}: ${formatStructure(field.type)}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      })
      .join(', ');
    const ret = type.ret !== undefined ? formatStructure(type.ret) : 'any';
    return `|${params}| :${ret}`;
  }

  if (isStructureKind(type, 'union')) {
    return formatUnion(type.members, formatStructure);
  }

  if (isStructureKind(type, 'literal')) {
    return formatRillLiteral(type.value);
  }

  return 'any';
}

// ============================================================
// INFER STRUCTURE
// ============================================================

/** Build a closure param field definition from name, type, and optional default. */
function paramToFieldDef(
  name: string,
  type: TypeStructure,
  defaultValue: RillValue | undefined,
  annotations?: Record<string, RillValue>
): RillFieldDef {
  const field: RillFieldDef = { name, type };
  if (defaultValue !== undefined) field.defaultValue = defaultValue;
  if (annotations && Object.keys(annotations).length > 0)
    field.annotations = annotations;
  return field;
}

/**
 * Infer the element type of a list. Never halts on mixed elements.
 * Empty arrays return { kind: 'any' }. The result is the set of maximal
 * element types: an empty list at any list depth yields to a populated
 * sibling, and members with no common type (dicts, ordereds, or tuples with
 * different fields) stay separate union members. The result does not depend
 * on element order or duplicates.
 */
function inferElementType(elements: RillValue[]): TypeStructure {
  const members: TypeStructure[] = [];
  for (const elem of elements) {
    if (elem === undefined) continue;
    const elemType = inferStructure(elem);
    let merged = false;
    for (const [slot, existing] of members.entries()) {
      const common = commonType(existing, elemType);
      if (common === null) continue;
      members[slot] = common;
      merged = true;
      break;
    }
    if (!merged) members.push(elemType);
  }
  const only = members[0];
  if (only === undefined) return { kind: 'any' };
  if (members.length === 1) return only;
  const normalized = normalizeUnion(members);
  if ('rejection' in normalized) {
    return throwTypeHalt(
      { fn: 'inferElementType' },
      'INVALID_INPUT',
      normalized.rejection,
      'runtime',
      undefined,
      'host'
    );
  }
  return normalized.structure;
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
  // An empty tuple, ordered, or dict infers the unspecified type, as an
  // empty list does, so its printed type parses back to itself.
  if (isTuple(value)) {
    if (value.entries.length === 0) return { kind: 'tuple' };
    return {
      kind: 'tuple',
      elements: value.entries.map((e): RillFieldDef => ({
        type: inferStructure(e),
      })),
    };
  }
  if (isOrdered(value)) {
    if (value.entries.length === 0) return { kind: 'ordered' };
    return {
      kind: 'ordered',
      fields: value.entries.map(([k, v]): RillFieldDef => ({
        name: k,
        type: inferStructure(v),
      })),
    };
  }
  if (isVector(value)) {
    return { kind: 'vector' };
  }
  if (isStream(value)) {
    const chunk = getStreamTypeSidecar(value, 'chunk');
    const ret = getStreamTypeSidecar(value, 'ret');
    const result: {
      kind: 'stream';
      chunk?: TypeStructure;
      ret?: TypeStructure;
    } = {
      kind: 'stream',
    };
    if (chunk !== undefined) result.chunk = chunk;
    if (ret !== undefined) result.ret = ret;
    return result;
  }
  if (isCallable(value) && value.returnType !== undefined) {
    const params = declaredParams(value).map((p) =>
      paramToFieldDef(
        p.name,
        p.type ?? { kind: 'any' },
        p.defaultValue,
        p.annotations
      )
    );
    const ret: TypeStructure = value.returnType.structure;
    return { kind: 'closure', params, ret };
  }
  if (isDatetime(value)) {
    return { kind: 'datetime' };
  }
  if (isDuration(value)) {
    return { kind: 'duration' };
  }
  if (isAtom(value)) {
    return { kind: 'atom' };
  }
  // Iterators are structurally dicts (done/next/value), so this must
  // precede the generic dict fallback below.
  if (isIterator(value)) {
    return { kind: 'iterator' };
  }
  if (isDict(value)) {
    const dict = value;
    const fields: Record<string, RillFieldDef> = {};
    for (const [k, v] of Object.entries(dict)) {
      setDictField(fields, k, { type: inferStructure(v) });
    }
    // Number/boolean keys contribute fields under their string form.
    for (const { key, value: v } of typedKeyEntries(dict)) {
      setDictField(fields, String(key), { type: inferStructure(v) });
    }
    if (Object.keys(fields).length === 0) return { kind: 'dict' };
    return { kind: 'dict', fields };
  }
  return throwTypeHalt(
    { fn: 'inferStructure' },
    'INVALID_INPUT',
    isCallable(value)
      ? 'Cannot infer structural type for a callable without a return type'
      : `Cannot infer structural type for ${registryFormatValue(value)}`,
    'runtime',
    undefined,
    'host'
  );
}

// ============================================================
// COMMON TYPE
// ============================================================

/**
 * Return the most specific shared type for two TypeStructure values.
 * Returns null when the two share no common type; the caller keeps both
 * as members of a union.
 *
 * Cascade priority:
 * 1. Any-narrowing: if either side is `any`, return the other
 * 2. Different kinds: null
 * 3. Structural match: return a
 * 4. Lists: merge element types, null when they share none
 * 5. Anything else that differs structurally: null. Dicts, ordereds, and
 *    tuples with different fields share no common type.
 */
export function commonType(
  a: TypeStructure,
  b: TypeStructure
): TypeStructure | null {
  if (a.kind === 'any') return b;
  if (b.kind === 'any') return a;
  if (a.kind !== b.kind) return null;
  if (structureEquals(a, b)) return a;

  if (isStructureKind(a, 'list') && isStructureKind(b, 'list')) {
    const inner = commonType(
      a.element ?? ANY_STRUCTURE,
      b.element ?? ANY_STRUCTURE
    );
    return inner === null ? null : { kind: 'list', element: inner };
  }
  return null;
}
