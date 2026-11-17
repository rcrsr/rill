/**
 * Structural overlap
 *
 * Decides whether two type structures can describe a common value. Used by
 * comparison sites to halt on operands that can never be equal.
 *
 * Import constraints:
 * - Imports from ./operations.js, ./structures.js, ./halt.js, ./registrations.js,
 *   ./guards.js, ./dict-keys.js
 * - carriedListElement serves only the list membership gates; element reads
 *   of an undeclared collection carry no type
 */

import {
  compareStructuredFields,
  formatStructure,
  inferStructure,
  type FieldComparisonCallbacks,
} from './operations.js';
import { RuntimeHaltSignal, throwTypeHalt, type TypeHaltSite } from './halt.js';
import { setDictField } from './dict-keys.js';
import { isStructureKind } from './guards.js';
import { inferType } from './registrations.js';
import type { RillFieldDef, RillValue, TypeStructure } from './structures.js';

/** A comparison operand: its value and the type it was declared with, if any. */
export interface Carried {
  readonly value: RillValue;
  readonly declared?: TypeStructure | undefined;
}

/** The kind a structure is judged by; a literal reads as its value's kind. */
function overlapKind(s: TypeStructure): string {
  if (s.kind !== 'literal') return s.kind;
  if (!isStructureKind(s, 'literal')) return s.kind;
  const value = s.value;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  return 'atom';
}

/** Overlap of keyed fields: shared fields overlap, one-sided fields are defaulted. */
function fieldsOverlap(
  aFields: Record<string, RillFieldDef>,
  bFields: Record<string, RillFieldDef>
): boolean {
  for (const [key, aField] of Object.entries(aFields)) {
    const bField = Object.hasOwn(bFields, key) ? bFields[key] : undefined;
    if (bField === undefined) {
      if (aField.defaultValue === undefined) return false;
    } else if (!structureOverlaps(aField.type, bField.type)) return false;
  }
  for (const [key, bField] of Object.entries(bFields)) {
    if (!Object.hasOwn(aFields, key) && bField.defaultValue === undefined) {
      return false;
    }
  }
  return true;
}

/** Overlap of positional elements: common prefix overlaps, extras are defaulted. */
function positionsOverlap(a: RillFieldDef[], b: RillFieldDef[]): boolean {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const aField = a[i];
    const bField = b[i];
    if (aField === undefined || bField === undefined) return false;
    if (!structureOverlaps(aField.type, bField.type)) return false;
  }
  return a
    .slice(shared)
    .concat(b.slice(shared))
    .every((f) => f.defaultValue !== undefined);
}

/** Overlap of ordered fields: matched by name, order ignored. */
function orderedOverlap(a: RillFieldDef[], b: RillFieldDef[]): boolean {
  const toRecord = (fields: RillFieldDef[]): Record<string, RillFieldDef> => {
    const out: Record<string, RillFieldDef> = {};
    for (const f of fields) setDictField(out, f.name ?? '', f);
    return out;
  };
  return fieldsOverlap(toRecord(a), toRecord(b));
}

/** Every field of a dict/ordered type overlaps a uniform value type. */
function fieldsOverlapValueType(
  s: TypeStructure,
  valueType: TypeStructure
): boolean {
  let fields: RillFieldDef[] = [];
  if (isStructureKind(s, 'dict')) fields = Object.values(s.fields ?? {});
  else if (isStructureKind(s, 'ordered')) fields = s.fields ?? [];
  return fields.every((f) => structureOverlaps(f.type, valueType));
}

/** The uniform value type of a dict/ordered structure, if it has one. */
function valueTypeOf(s: TypeStructure): TypeStructure | undefined {
  if (isStructureKind(s, 'dict') || isStructureKind(s, 'ordered')) {
    return s.valueType;
  }
  return undefined;
}

const overlapCallbacks: FieldComparisonCallbacks<boolean> = {
  onValueType: (a, b) => structureOverlaps(a, b),
  onValueTypeMismatch(a, b) {
    const aValue = valueTypeOf(a);
    const bValue = valueTypeOf(b);
    if (aValue !== undefined) return fieldsOverlapValueType(b, aValue);
    if (bValue !== undefined) return fieldsOverlapValueType(a, bValue);
    return true;
  },
  onBothEmpty: () => true,
  onFieldPresenceMismatch: () => true,
  onDictFields: fieldsOverlap,
  onTupleElements: positionsOverlap,
  onOrderedFields: orderedOverlap,
};

/**
 * True when some value could satisfy both structures. Pure, symmetric,
 * total. A literal is judged by the kind of its value.
 */
export function structureOverlaps(a: TypeStructure, b: TypeStructure): boolean {
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (isStructureKind(a, 'union')) {
    return a.members.some((m) => structureOverlaps(m, b));
  }
  if (isStructureKind(b, 'union')) return structureOverlaps(b, a);

  const kind = overlapKind(a);
  if (kind !== overlapKind(b)) return false;

  if (isStructureKind(a, 'list') && isStructureKind(b, 'list')) {
    return structureOverlaps(
      a.element ?? { kind: 'any' },
      b.element ?? { kind: 'any' }
    );
  }
  if (kind === 'dict' || kind === 'tuple' || kind === 'ordered') {
    return compareStructuredFields(a, b, overlapCallbacks, true);
  }
  return true;
}

/** The type a value carries: its declared type, else inferred, else its bare kind. */
export function carriedStructure(
  value: RillValue,
  declared?: TypeStructure
): TypeStructure {
  if (declared !== undefined) return declared;
  try {
    return inferStructure(value);
  } catch (e) {
    if (!(e instanceof RuntimeHaltSignal)) throw e;
    return { kind: inferType(value) };
  }
}

/**
 * Element type of the list a value carries (declared, else inferred from its
 * contents); undefined when the value carries no list type or its element is
 * `any`. Membership gates only: ordinary element reads carry nothing.
 */
export function carriedListElement(
  value: RillValue,
  declared: TypeStructure | undefined
): TypeStructure | undefined {
  const s = carriedStructure(value, declared);
  if (!isStructureKind(s, 'list')) return undefined;
  const element = s.element;
  return element === undefined || element.kind === 'any' ? undefined : element;
}

/** Halt `#TYPE_MISMATCH` (catchable) when the operands' types cannot overlap. */
export function requireOverlap(
  left: Carried,
  right: Carried,
  site: TypeHaltSite,
  op: string
): void {
  const l = carriedStructure(left.value, left.declared);
  const r = carriedStructure(right.value, right.declared);
  if (structureOverlaps(l, r)) return;
  const lt = formatStructure(l);
  const rt = formatStructure(r);
  throwTypeHalt(
    site,
    'TYPE_MISMATCH',
    `Cannot compare ${lt} with ${rt} using ${op}`,
    'runtime',
    { expectedType: lt, actualType: rt }
  );
}
