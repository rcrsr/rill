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
import { quoteRillString } from './format-string.js';
import { typedKeyEntries, setDictField } from './dict-keys.js';
import { ERROR_IDS } from '../../../error-registry.js';

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
    const aValue = a.valueType;
    const bValue = b.valueType;
    if (aValue !== undefined || bValue !== undefined) {
      if (aValue === undefined || bValue === undefined)
        return callbacks.onValueTypeMismatch();
      return callbacks.onValueType(aValue, bValue);
    }
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
    if (a.element === undefined && b.element === undefined) return true;
    if (a.element === undefined || b.element === undefined) return false;
    return structureEquals(a.element, b.element);
  }

  // Delegate dict/tuple/ordered to compareStructuredFields
  if (a.kind === 'dict' || a.kind === 'tuple' || a.kind === 'ordered') {
    return compareStructuredFields(a, b, equalsCallbacks, false);
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
    const chunkEq =
      aStream.chunk === undefined && bStream.chunk === undefined
        ? true
        : aStream.chunk !== undefined && bStream.chunk !== undefined
          ? structureEquals(aStream.chunk, bStream.chunk)
          : false;
    if (!chunkEq) return false;
    const retEq =
      aStream.ret === undefined && bStream.ret === undefined
        ? true
        : aStream.ret !== undefined && bStream.ret !== undefined
          ? structureEquals(aStream.ret, bStream.ret)
          : false;
    return retEq;
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
      // Order matters: isOrdered/isTuple before isDict because
      // ordered and tuple values also satisfy isDict.
      if (isTuple(value)) {
        return value.entries.every((v) => structureMatches(v, valueType));
      }
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
    if (chunk === undefined && ret === undefined) return true;
    if (chunk !== undefined) {
      const valueChunk = getStreamTypeSidecar(value, 'chunk');
      if (valueChunk !== undefined && !structureEquals(valueChunk, chunk))
        return false;
    }
    if (ret !== undefined) {
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

  if (isStructureKind(type, 'list')) {
    if (type.element === undefined) return 'list';
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
    if (type.chunk === undefined && type.ret === undefined) return 'stream';
    const chunkStr =
      type.chunk !== undefined ? formatStructure(type.chunk) : 'any';
    const retStr =
      type.ret !== undefined ? `:${formatStructure(type.ret)}` : '';
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
    return type.members.map(formatStructure).join('|');
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
 * Infer the element type for a homogeneous list.
 * Empty arrays return { kind: 'any' }.
 * Mixed types throw RILL-R002.
 */
export function inferElementType(elements: RillValue[]): TypeStructure {
  const scan = scanElementTypes(elements);
  if (scan.mismatch !== undefined) {
    throw new RuntimeError(ERROR_IDS.RILL_R002, scan.mismatch);
  }
  return scan.type;
}

/**
 * Non-throwing homogeneity check for list elements.
 * Returns the mismatch message, or undefined when all elements share a type.
 */
export function findElementTypeMismatch(
  elements: RillValue[]
): string | undefined {
  return scanElementTypes(elements).mismatch;
}

/**
 * Single pass over list elements: merged element type, plus the mismatch
 * message when two elements share no common type. One pass keeps nested
 * lists linear per level; inferring each element twice would double the
 * work at every nesting level.
 */
function scanElementTypes(elements: RillValue[]): {
  type: TypeStructure;
  mismatch: string | undefined;
} {
  const firstElem = elements[0];
  if (firstElem === undefined)
    return { type: { kind: 'any' }, mismatch: undefined };
  let accType = inferStructure(firstElem);
  for (let i = 1; i < elements.length; i++) {
    const elem = elements[i];
    if (elem === undefined) continue;
    const elemType = inferStructure(elem);
    const merged = commonType(accType, elemType);
    if (merged === null) {
      return {
        type: accType,
        mismatch: `List elements must be the same type: expected ${formatStructure(accType)}, got ${formatStructure(elemType)} at index ${i}`,
      };
    }
    accType = merged;
  }
  return { type: accType, mismatch: undefined };
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
      elements: value.entries.map((e): RillFieldDef => ({
        type: inferStructure(e),
      })),
    };
  }
  if (isOrdered(value)) {
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
    const allTypes = aFields.concat(bFields);
    const first = allTypes[0];
    if (first === undefined) return undefined;
    let merged: TypeStructure = first.type;
    for (let i = 1; i < allTypes.length; i++) {
      const member = allTypes[i]?.type;
      if (member === undefined) continue;
      const next = commonType(merged, member);
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
  if (isStructureKind(a, 'list') && isStructureKind(b, 'list')) {
    if (a.element !== undefined && b.element !== undefined) {
      const inner = commonType(a.element, b.element);
      if (inner !== null) return { kind: 'list', element: inner };
    }
    return { kind: 'list' };
  }

  // 3b. Uniform valueType merging for dict/tuple/ordered
  if (isStructureKind(a, 'dict') && isStructureKind(b, 'dict')) {
    const merged = mergeUniformValueType(
      a.valueType,
      b.valueType,
      a.fields ? Object.values(a.fields) : undefined,
      b.fields ? Object.values(b.fields) : undefined
    );
    if (merged !== undefined) return { kind: 'dict', valueType: merged };
  }

  if (isStructureKind(a, 'tuple') && isStructureKind(b, 'tuple')) {
    const merged = mergeUniformValueType(
      a.valueType,
      b.valueType,
      a.elements,
      b.elements
    );
    if (merged !== undefined) return { kind: 'tuple', valueType: merged };
  }

  if (isStructureKind(a, 'ordered') && isStructureKind(b, 'ordered')) {
    const merged = mergeUniformValueType(
      a.valueType,
      b.valueType,
      a.fields,
      b.fields
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
    return { kind: a.kind };
  }

  return null;
}
