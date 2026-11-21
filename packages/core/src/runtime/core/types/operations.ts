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
  isMap,
  isOrdered,
  isStream,
  isStructureKind,
  isTuple,
  isTypeValue,
  isVector,
  getStreamTypeSidecar,
} from './guards.js';
import { RuntimeHaltSignal, throwTypeHalt } from './halt.js';
import { isRillTypeName } from '../../../value-types.js';
import type { RillTypeName } from '../../../value-types.js';
import {
  inferType as registryInferType,
  inferTypeName,
  formatValue as registryFormatValue,
  deepEquals as registryDeepEquals,
} from './registrations.js';
import type { RillFieldDef, RillValue, TypeStructure } from './structures.js';
import type { DefaultMismatch } from './field-defaults.js';
import { formatFieldKey, quoteRillString } from './format-string.js';
import { orderedDictEntries, setDictField } from './dict-keys.js';
import { formatUnion } from './error-code.js';
import { paramsToFieldDefs } from './fn-params.js';
// oxlint-disable-next-line import/no-cycle -- unions.ts imports this file; the edge is used only at call time, never at module init
import { reduceUnionMembers } from './unions.js';

/** isCallable guard widened to narrow to full RillCallable (not just CallableMarker); a CallableMarker implies RillCallable by construction. */
function isCallable(value: RillValue): value is RillCallable {
  return _isCallableGuard(value);
}

// ============================================================
// FIELD COMPARISON DISPATCH
// ============================================================

/**
 * Callbacks for kind-specific field dispatch in dict/tuple/ordered types.
 * `compareStructuredFields` handles kind-based field extraction, then
 * delegates to these callbacks.
 */
export interface FieldComparisonCallbacks<T> {
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
 * Handles field iteration across
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

  // List: list[elem, ...]
  if (Array.isArray(value)) {
    return `list[${value.map(formatRillLiteral).join(', ')}]`;
  }

  // Tuple: tuple[elem, ...]
  if (isTuple(value)) {
    return `tuple[${value.entries.map(formatRillLiteral).join(', ')}]`;
  }

  // Ordered: ordered[key: val, ...]
  if (isOrdered(value)) {
    const inner = value.entries
      .map(([k, v]) => `${formatFieldKey(k)}: ${formatRillLiteral(v)}`)
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

  // Dict: dict[key: val, ...]; dict[] for empty
  if (isDict(value)) {
    const inner = orderedDictEntries(value)
      .map(
        ({ key: k, value: v }) =>
          `${formatFieldKey(k)}: ${formatRillLiteral(v)}`
      )
      .join(', ');
    return `dict[${inner}]`;
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
export const ANY_STRUCTURE: TypeStructure = Object.freeze({ kind: 'any' });

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

  if (isStructureKind(a, 'map') && isStructureKind(b, 'map')) {
    // An absent key or value is unspecified and equals `any`.
    return (
      structureEquals(a.key ?? ANY_STRUCTURE, b.key ?? ANY_STRUCTURE) &&
      structureEquals(a.value ?? ANY_STRUCTURE, b.value ?? ANY_STRUCTURE)
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

  if (isStructureKind(a, 'fn') && isStructureKind(b, 'fn')) {
    // An absent outer is unspecified and equals `any`. Annotations are not
    // part of the type.
    if (!structureEquals(a.ret ?? ANY_STRUCTURE, b.ret ?? ANY_STRUCTURE)) {
      return false;
    }
    if (a.params === undefined && b.params === undefined) return true;
    if (a.params === undefined || b.params === undefined) return false;
    if (a.params.length !== b.params.length) return false;
    return a.params.every((aParam, i) => {
      const bParam = b.params?.[i];
      if (bParam === undefined) return false;
      if (aParam.name !== bParam.name) return false;
      if (!structureEquals(aParam.type, bParam.type)) return false;
      const aDefault = aParam.defaultValue;
      const bDefault = bParam.defaultValue;
      if (aDefault === undefined || bDefault === undefined) {
        return aDefault === bDefault;
      }
      return registryDeepEquals(aDefault, bDefault);
    });
  }

  return false;
}

// ============================================================
// STRUCTURE MATCHES
// ============================================================

/**
 * Create structureMatches callbacks that capture the runtime value.
 * Dict membership is exact: every own key must be a named field, and a
 * defaulted field may be absent. Tuple and ordered check entries against
 * type elements/fields.
 */
function createMatchesCallbacks(
  value: RillValue
): FieldComparisonCallbacks<boolean> {
  return {
    onBothEmpty: () => true,
    onFieldPresenceMismatch: () => false,
    onDictFields(fields) {
      const dictKeys = Object.keys(fields);
      if (dictKeys.length === 0) return true;
      if (!isDict(value)) return false;
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(fields, key)) return false;
      }
      for (const [key, field] of Object.entries(fields)) {
        if (!Object.hasOwn(value, key)) {
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

  if (isStructureKind(type, 'map')) {
    if (!isMap(value)) return false;
    const { key, value: valueType } = type;
    return value.entries.every(
      ([k, v]) =>
        (isUnspecified(key) || structureMatches(k, key)) &&
        (isUnspecified(valueType) || structureMatches(v, valueType))
    );
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

  if (isStructureKind(type, 'fn')) {
    if (!isCallable(value)) return false;
    // The bare fn accepts every function.
    if (type.params === undefined && isUnspecified(type.ret)) return true;
    if (value.returnType === undefined) return false;
    if (type.params === undefined) {
      return structureEquals(
        value.returnType.structure,
        type.ret ?? ANY_STRUCTURE
      );
    }
    return structureEquals(inferStructure(value), type);
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
 * Returns `null` for bare types (no fields) so the caller
 * can distinguish "fields: undefined" from "fields: {}".
 */
const formatCallbacks: FieldComparisonCallbacks<string | null> = {
  onBothEmpty: () => null,
  onFieldPresenceMismatch: () => null,
  onDictFields(fields) {
    const parts = Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, field]) => {
        const base = `${formatFieldKey(k)}: ${formatStructure(field.type)}`;
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
      const base = `${formatFieldKey(field.name ?? '')}: ${formatStructure(field.type)}`;
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
    // Bare type (no fields): null signals undefined fields
    if (inner === null) return type.kind;
    return `${type.kind}(${inner})`;
  }

  if (isStructureKind(type, 'map')) {
    if (isUnspecified(type.key) && isUnspecified(type.value)) return 'map';
    const slot = (s: TypeStructure | undefined): string =>
      isUnspecified(s) ? 'any' : formatStructure(s);
    return `map(${slot(type.key)}, ${slot(type.value)})`;
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

  if (isStructureKind(type, 'fn')) {
    const outer = isUnspecified(type.ret) ? 'any' : formatStructure(type.ret);
    if (type.params === undefined) {
      return isUnspecified(type.ret) ? 'fn' : `fn:${outer}`;
    }
    const params = type.params
      .map((field) => {
        const fieldType = formatStructure(field.type);
        const base =
          field.name === undefined
            ? fieldType
            : `${formatFieldKey(field.name)}: ${fieldType}`;
        if (field.defaultValue === undefined) return base;
        return `${base} = ${formatRillLiteral(field.defaultValue)}`;
      })
      .join(', ');
    return `fn(${params}):${outer}`;
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

/** True when a list's element chain ends in an unspecified or `any` element. */
function endsInAny(ts: TypeStructure): boolean {
  let current: TypeStructure = ts;
  while (isStructureKind(current, 'list')) {
    if (current.element === undefined || current.element.kind === 'any') {
      return true;
    }
    current = current.element;
  }
  return false;
}

/** Insert `slot` into an ascending slot list. */
function insertSlot(slots: number[], slot: number): void {
  const at = slots.findIndex((existing) => existing > slot);
  if (at === -1) slots.push(slot);
  else slots.splice(at, 0, slot);
}

/**
 * Infer the element type of a list. Never halts on mixed elements.
 * Empty arrays return { kind: 'any' }. The result is the set of maximal
 * element types: an empty list at any list depth yields to a populated
 * sibling, and members with no common type (dicts, ordereds, or tuples with
 * different fields) stay separate union members. The result does not depend
 * on element order or duplicates.
 *
 * Two structures merge without being equal only when both are lists and one
 * list's element chain ends in `any`. An exact repeat resolves through a
 * lookup keyed by the printed type; only list members that can merge are
 * scanned with `commonType`, so a list of distinct records costs linear time.
 */
function inferElementType(elements: RillValue[]): TypeStructure {
  const members: TypeStructure[] = [];
  const slotKeys: string[] = [];
  const keySlots = new Map<string, number[]>();
  const listSlots: number[] = [];
  let anyListSlots: number[] = [];

  const track = (slot: number, key: string): void => {
    const slots = keySlots.get(key);
    if (slots === undefined) keySlots.set(key, [slot]);
    else insertSlot(slots, slot);
  };

  for (const elem of elements) {
    if (elem === undefined) continue;
    const elemType = inferStructure(elem);
    const key = formatStructure(elemType);

    let exact = -1;
    for (const slot of keySlots.get(key) ?? []) {
      const existing = members[slot];
      if (existing !== undefined && structureEquals(existing, elemType)) {
        exact = slot;
        break;
      }
    }

    let handled = exact !== -1;
    if (isStructureKind(elemType, 'list')) {
      const pool = endsInAny(elemType) ? listSlots : anyListSlots;
      for (const slot of pool) {
        if (exact !== -1 && slot >= exact) break;
        const existing = members[slot];
        if (existing === undefined) continue;
        const common = commonType(existing, elemType);
        if (common === null) continue;
        handled = true;
        if (!structureEquals(common, existing)) {
          const oldKey = slotKeys[slot] ?? '';
          const oldSlots = keySlots.get(oldKey);
          if (oldSlots !== undefined) {
            oldSlots.splice(oldSlots.indexOf(slot), 1);
          }
          const newKey = formatStructure(common);
          members[slot] = common;
          slotKeys[slot] = newKey;
          track(slot, newKey);
          anyListSlots = listSlots.filter((s) => {
            const member = members[s];
            return member !== undefined && endsInAny(member);
          });
        }
        break;
      }
    }
    if (handled) continue;

    const slot = members.length;
    members.push(elemType);
    slotKeys.push(key);
    track(slot, key);
    if (isStructureKind(elemType, 'list')) {
      listSlots.push(slot);
      if (endsInAny(elemType)) anyListSlots.push(slot);
    }
  }
  const only = members[0];
  if (only === undefined) return { kind: 'any' };
  if (members.length === 1) return only;
  const reduced = reduceUnionMembers(members);
  if (isStructureKind(reduced, 'union')) {
    Object.freeze(reduced.members);
    Object.freeze(reduced);
  }
  return reduced;
}

const inferredStructures = new WeakMap<object, TypeStructure>();

/** Run `build` once per container identity; a build that halts stores nothing. */
function memoizedStructure(
  value: object,
  build: () => TypeStructure
): TypeStructure {
  const cached = inferredStructures.get(value);
  if (cached !== undefined) return cached;
  const built = build();
  inferredStructures.set(value, built);
  return built;
}

const STRING_STRUCTURE: TypeStructure = Object.freeze({ kind: 'string' });
const NUMBER_STRUCTURE: TypeStructure = Object.freeze({ kind: 'number' });
const BOOL_STRUCTURE: TypeStructure = Object.freeze({ kind: 'bool' });
const TYPE_STRUCTURE: TypeStructure = Object.freeze({ kind: 'type' });
const VECTOR_STRUCTURE: TypeStructure = Object.freeze({ kind: 'vector' });
const DATETIME_STRUCTURE: TypeStructure = Object.freeze({ kind: 'datetime' });
const DURATION_STRUCTURE: TypeStructure = Object.freeze({ kind: 'duration' });
const ATOM_STRUCTURE: TypeStructure = Object.freeze({ kind: 'atom' });
const ITERATOR_STRUCTURE: TypeStructure = Object.freeze({ kind: 'iterator' });

/**
 * Infer the structural type descriptor for any Rill value. Results for
 * arrays, tuples, ordereds, and plain dicts are memoized per container
 * identity and frozen; callers must not mutate them.
 */
export function inferStructure(value: RillValue): TypeStructure {
  if (value === null || typeof value === 'string') {
    return STRING_STRUCTURE;
  }
  if (typeof value === 'number') {
    return NUMBER_STRUCTURE;
  }
  if (typeof value === 'boolean') {
    return BOOL_STRUCTURE;
  }
  if (isTypeValue(value)) {
    return TYPE_STRUCTURE;
  }
  if (Array.isArray(value)) {
    return memoizedStructure(value, () =>
      Object.freeze({ kind: 'list', element: inferElementType(value) })
    );
  }
  // An empty tuple, ordered, or dict infers the unspecified type, as an
  // empty list does, so its printed type parses back to itself.
  if (isTuple(value)) {
    const tuple = value;
    return memoizedStructure(tuple, () => {
      if (tuple.entries.length === 0) return Object.freeze({ kind: 'tuple' });
      return Object.freeze({
        kind: 'tuple',
        elements: Object.freeze(
          tuple.entries.map((e): RillFieldDef =>
            Object.freeze({ type: inferStructure(e) })
          )
        ),
      });
    });
  }
  if (isOrdered(value)) {
    const ordered = value;
    return memoizedStructure(ordered, () => {
      if (ordered.entries.length === 0) {
        return Object.freeze({ kind: 'ordered' });
      }
      return Object.freeze({
        kind: 'ordered',
        fields: Object.freeze(
          ordered.entries.map(([k, v]): RillFieldDef =>
            Object.freeze({ name: k, type: inferStructure(v) })
          )
        ),
      });
    });
  }
  if (isMap(value)) {
    const map = value;
    return memoizedStructure(map, () => {
      if (map.entries.length === 0) return Object.freeze({ kind: 'map' });
      return Object.freeze({
        kind: 'map',
        key: inferElementType(map.entries.map(([k]) => k)),
        value: inferElementType(map.entries.map(([, v]) => v)),
      });
    });
  }
  if (isVector(value)) {
    return VECTOR_STRUCTURE;
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
    return Object.freeze(result);
  }
  if (isCallable(value) && value.returnType !== undefined) {
    const params = paramsToFieldDefs(declaredParams(value)).map((field) =>
      Object.freeze(field)
    );
    const ret: TypeStructure = value.returnType.structure;
    return Object.freeze({
      kind: 'fn',
      params: Object.freeze(params),
      ret,
    });
  }
  if (isDatetime(value)) {
    return DATETIME_STRUCTURE;
  }
  if (isDuration(value)) {
    return DURATION_STRUCTURE;
  }
  if (isAtom(value)) {
    return ATOM_STRUCTURE;
  }
  // Iterators are structurally dicts (done/next/value), so this must
  // precede the generic dict fallback below.
  if (isIterator(value)) {
    return ITERATOR_STRUCTURE;
  }
  if (isDict(value)) {
    const dict = value;
    return memoizedStructure(dict, () => {
      const fields: Record<string, RillFieldDef> = {};
      for (const [k, v] of Object.entries(dict)) {
        setDictField(fields, k, Object.freeze({ type: inferStructure(v) }));
      }
      if (Object.keys(fields).length === 0)
        return Object.freeze({ kind: 'dict' });
      return Object.freeze({ kind: 'dict', fields: Object.freeze(fields) });
    });
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

/** Containers whose inference already failed, so a recapture skips the walk. */
const uninferable = new WeakSet<object>();

/**
 * Type a variable locks to on first capture when nothing was declared: the
 * value's inferred structure. A value outside the closed type-name set, or
 * one holding a callable with no return type (so it has no structure), locks
 * to its kind name instead.
 *
 * A callable with no return type is detected up front. One nested inside a
 * collection is only found by the inference walk, which halts; that halt is
 * caught here and remembered per container so the walk is not repeated.
 */
export function inferLockType(value: RillValue): TypeStructure | RillTypeName {
  if (!isRillTypeName(registryInferType(value))) return inferTypeName(value);
  if (isCallable(value) && value.returnType === undefined) {
    return inferTypeName(value);
  }
  const container = typeof value === 'object' && value !== null;
  if (container && uninferable.has(value)) return inferTypeName(value);
  try {
    return inferStructure(value);
  } catch (err) {
    if (err instanceof RuntimeHaltSignal) {
      if (container) uninferable.add(value);
      return inferTypeName(value);
    }
    throw err;
  }
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
    return inner === null
      ? null
      : Object.freeze({ kind: 'list', element: inner });
  }
  return null;
}
