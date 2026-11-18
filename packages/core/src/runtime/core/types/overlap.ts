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
import { isAtom, isStructureKind } from './guards.js';
import { deepEquals, inferType } from './registrations.js';
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

/**
 * Overlap of keyed fields: shared fields overlap. A one-sided field is
 * defaulted when strict; when lenient (a declared dict type lets extra keys
 * pass) it is ignored.
 */
function fieldsOverlap(
  aFields: Record<string, RillFieldDef>,
  bFields: Record<string, RillFieldDef>,
  lenient: boolean
): boolean {
  for (const [key, aField] of Object.entries(aFields)) {
    const bField = Object.hasOwn(bFields, key) ? bFields[key] : undefined;
    if (bField === undefined) {
      if (!lenient && aField.defaultValue === undefined) return false;
    } else if (!overlaps(aField.type, bField.type, lenient)) return false;
  }
  if (lenient) return true;
  for (const [key, bField] of Object.entries(bFields)) {
    if (!Object.hasOwn(aFields, key) && bField.defaultValue === undefined) {
      return false;
    }
  }
  return true;
}

/** Overlap of positional elements: common prefix overlaps, extras are defaulted. */
function positionsOverlap(
  a: RillFieldDef[],
  b: RillFieldDef[],
  lenient: boolean
): boolean {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const aField = a[i];
    const bField = b[i];
    if (aField === undefined || bField === undefined) return false;
    if (!overlaps(aField.type, bField.type, lenient)) return false;
  }
  return a
    .slice(shared)
    .concat(b.slice(shared))
    .every((f) => f.defaultValue !== undefined);
}

/** Overlap of ordered fields: matched by name, order ignored. */
function orderedOverlap(
  a: RillFieldDef[],
  b: RillFieldDef[],
  lenient: boolean
): boolean {
  const toRecord = (fields: RillFieldDef[]): Record<string, RillFieldDef> => {
    const out: Record<string, RillFieldDef> = {};
    for (const f of fields) setDictField(out, f.name ?? '', f);
    return out;
  };
  return fieldsOverlap(toRecord(a), toRecord(b), lenient);
}

/** Every field of a dict/ordered type overlaps a uniform value type. */
function fieldsOverlapValueType(
  s: TypeStructure,
  valueType: TypeStructure,
  lenient: boolean
): boolean {
  let fields: RillFieldDef[] = [];
  if (isStructureKind(s, 'dict')) fields = Object.values(s.fields ?? {});
  else if (isStructureKind(s, 'ordered')) fields = s.fields ?? [];
  return fields.every((f) => overlaps(f.type, valueType, lenient));
}

/** The uniform value type of a dict/ordered structure, if it has one. */
function valueTypeOf(s: TypeStructure): TypeStructure | undefined {
  if (isStructureKind(s, 'dict') || isStructureKind(s, 'ordered')) {
    return s.valueType;
  }
  return undefined;
}

function overlapCallbacksFor(
  lenient: boolean
): FieldComparisonCallbacks<boolean> {
  return {
    onValueType: (a, b) => overlaps(a, b, lenient),
    onValueTypeMismatch(a, b) {
      const aValue = valueTypeOf(a);
      const bValue = valueTypeOf(b);
      if (aValue !== undefined)
        return fieldsOverlapValueType(b, aValue, lenient);
      if (bValue !== undefined)
        return fieldsOverlapValueType(a, bValue, lenient);
      return true;
    },
    onBothEmpty: () => true,
    onFieldPresenceMismatch: () => true,
    onDictFields: (a, b) => fieldsOverlap(a, b, lenient),
    onTupleElements: (a, b) => positionsOverlap(a, b, lenient),
    onOrderedFields: (a, b) => orderedOverlap(a, b, lenient),
  };
}

const STRICT_CALLBACKS = overlapCallbacksFor(false);
const LENIENT_CALLBACKS = overlapCallbacksFor(true);

function overlaps(
  a: TypeStructure,
  b: TypeStructure,
  lenient: boolean
): boolean {
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (isStructureKind(a, 'union')) {
    return a.members.some((m) => overlaps(m, b, lenient));
  }
  if (isStructureKind(b, 'union')) return overlaps(b, a, lenient);

  const kind = overlapKind(a);
  if (kind !== overlapKind(b)) return false;
  if (isStructureKind(a, 'literal') && isStructureKind(b, 'literal')) {
    return deepEquals(a.value, b.value);
  }

  if (isStructureKind(a, 'list') && isStructureKind(b, 'list')) {
    return overlaps(
      a.element ?? { kind: 'any' },
      b.element ?? { kind: 'any' },
      lenient
    );
  }
  if (kind === 'dict' || kind === 'tuple' || kind === 'ordered') {
    return compareStructuredFields(
      a,
      b,
      lenient ? LENIENT_CALLBACKS : STRICT_CALLBACKS,
      true
    );
  }
  return true;
}

/**
 * True when some value could satisfy both structures. Pure, symmetric,
 * total. A literal is judged by the kind of its value. Strict: a dict key
 * present on one side only must be defaulted.
 */
export function structureOverlaps(a: TypeStructure, b: TypeStructure): boolean {
  return overlaps(a, b, false);
}

/**
 * The type a value carries: its declared type, else inferred, else its bare
 * kind. When the other operand is declared, an undeclared scalar (atom,
 * string, number, bool) is judged by its own literal type, so a closed set
 * rejects a value outside it.
 */
function carriedStructure(
  value: RillValue,
  declared?: TypeStructure,
  otherDeclared: boolean = false
): TypeStructure {
  if (declared !== undefined) return declared;
  if (
    otherDeclared &&
    (typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      isAtom(value))
  ) {
    return { kind: 'literal', value };
  }
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

/**
 * The structure to print for an operand. An undeclared scalar was wrapped as
 * a literal only to be judged; print its kind so the halt never carries the
 * value itself.
 */
function messageStructure(
  operand: Carried,
  structure: TypeStructure
): TypeStructure {
  if (operand.declared === undefined && isStructureKind(structure, 'literal')) {
    return { kind: inferType(operand.value) };
  }
  return structure;
}

/**
 * Halt `#TYPE_MISMATCH` (catchable) when the operands' types cannot overlap.
 * When either operand carries a declared type, a dict key present on one side
 * only passes, as it does when the value is matched against that type.
 * `lenient` overrides that default for callers whose operand structure is
 * inferred rather than declared.
 */
export function requireOverlap(
  left: Carried,
  right: Carried,
  site: TypeHaltSite,
  op: string,
  lenient: boolean = left.declared !== undefined || right.declared !== undefined
): void {
  const l = carriedStructure(
    left.value,
    left.declared,
    right.declared !== undefined
  );
  const r = carriedStructure(
    right.value,
    right.declared,
    left.declared !== undefined
  );
  if (overlaps(l, r, lenient)) return;
  const lt = formatStructure(messageStructure(left, l));
  const rt = formatStructure(messageStructure(right, r));
  throwTypeHalt(
    site,
    'TYPE_MISMATCH',
    `Cannot compare ${lt} with ${rt} using ${op}`,
    'runtime',
    { expectedType: lt, actualType: rt }
  );
}
