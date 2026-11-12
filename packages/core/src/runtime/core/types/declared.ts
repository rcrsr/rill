/**
 * Declared-type carriers.
 *
 * A declared type travels BESIDE a value, never inside it, so value equality
 * is unchanged. Carriers: `Carried` pairs from evaluators, the guarded pipe
 * slot on the context, the owning scope's `variableTypes` entry, and an
 * args-array sidecar for built-in calls.
 */

import { isStructureKind } from './guards.js';
import type { ControlFlowContext } from './runtime.js';
import type { RillValue, TypeStructure } from './structures.js';

// ============================================================
// TYPES
// ============================================================

/** A value paired with the type declared for it, when one is carried. */
export interface Carried {
  readonly value: RillValue;
  readonly declared: TypeStructure | undefined;
}

/** Pipe-slot record; valid only while `value` is still the pipe value. */
export interface DeclaredSlot {
  readonly value: RillValue;
  readonly type: TypeStructure;
}

// ============================================================
// DECLARATION HELPERS
// ============================================================

/**
 * Normalize a written or stored type into a declaration. `any`, the string
 * 'any', any kind-name string and absence all mean "no declaration".
 */
export function declarationOf(
  t: TypeStructure | string | undefined
): TypeStructure | undefined {
  if (t === undefined || typeof t === 'string') return undefined;
  if (t.kind === 'any') return undefined;
  return t;
}

/**
 * Project the declared type of an element read from a declared collection:
 * list(E) -> E; tuple by index, dict by name, ordered by name or index. A
 * uniform valueType wins over positions and fields, as in the matcher; with
 * none set, an unmatched key projects nothing. Index keys are non-negative.
 * Unions and bare kinds project nothing.
 */
export function projectElement(
  collection: TypeStructure | undefined,
  key: string | number
): TypeStructure | undefined {
  if (collection === undefined) return undefined;
  if (isStructureKind(collection, 'list')) {
    return declarationOf(collection.element);
  }
  if (isStructureKind(collection, 'tuple')) {
    // The matcher checks valueType first and ignores positions when both
    // are set; project the same way. Callers pass a non-negative index.
    if (collection.valueType === undefined && typeof key === 'number') {
      const element = collection.elements?.[key];
      if (element !== undefined) return declarationOf(element.type);
    }
    return declarationOf(collection.valueType);
  }
  if (isStructureKind(collection, 'dict')) {
    const fields = collection.fields;
    if (
      collection.valueType === undefined &&
      typeof key === 'string' &&
      fields !== undefined &&
      Object.prototype.hasOwnProperty.call(fields, key)
    ) {
      return declarationOf(fields[key]?.type);
    }
    return declarationOf(collection.valueType);
  }
  if (isStructureKind(collection, 'ordered')) {
    const fields = collection.fields;
    const field =
      collection.valueType !== undefined
        ? undefined
        : typeof key === 'number'
          ? fields?.[key]
          : fields?.find((f) => f.name === key);
    if (field !== undefined) return declarationOf(field.type);
    return declarationOf(collection.valueType);
  }
  return undefined;
}

/** Declared element type for iteration; only list(E) carries one. */
export function iterationElement(
  collection: TypeStructure | undefined
): TypeStructure | undefined {
  if (collection === undefined) return undefined;
  return isStructureKind(collection, 'list')
    ? declarationOf(collection.element)
    : undefined;
}

// ============================================================
// PIPE SLOT
// ============================================================

/** Declared type of the pipe value, only while the slot matches it. */
export function pipeDeclaredOf(
  ctx: ControlFlowContext
): TypeStructure | undefined {
  const slot = ctx.pipeDeclared;
  return slot !== undefined && slot.value === ctx.pipeValue
    ? slot.type
    : undefined;
}

/** Set the pipe value and its declaration slot together. */
export function setPipe(
  ctx: ControlFlowContext,
  value: RillValue,
  declared: TypeStructure | undefined
): void {
  ctx.pipeValue = value;
  ctx.pipeDeclared =
    declared === undefined ? undefined : { value, type: declared };
}

// ============================================================
// ARGS SIDECAR (module-private)
// ============================================================

type ArgsDeclared = (TypeStructure | undefined)[];

const argsDeclared = new WeakMap<object, ArgsDeclared>();

/**
 * Attach per-position declarations to an args array. When no position has a
 * declaration, no sidecar is kept: `argDeclaredAt` already reads a missing
 * entry as undefined.
 */
export function setArgsDeclared(
  args: readonly (RillValue | undefined)[],
  declared: readonly (TypeStructure | undefined)[]
): void {
  if (declared.every((d) => d === undefined)) {
    argsDeclared.delete(args);
    return;
  }
  argsDeclared.set(args, [...declared]);
}

/** Declaration for the argument at `index`, if any. */
export function argDeclaredAt(
  args: readonly (RillValue | undefined)[],
  index: number
): TypeStructure | undefined {
  return argsDeclared.get(args)?.[index];
}

/** Insert a declaration at `index`, shifting later ones (mirrors splice). */
export function insertArgDeclared(
  args: readonly (RillValue | undefined)[],
  index: number,
  declared: TypeStructure | undefined
): void {
  const existing = argsDeclared.get(args);
  // With no sidecar and nothing to record, every position already reads as
  // undeclared. An existing sidecar must shift to stay aligned.
  if (existing === undefined && declared === undefined) return;
  const list = existing ?? [];
  list.splice(index, 0, declared);
  argsDeclared.set(args, list);
}

/** Move an args array's declarations onto a marshalled record. */
export function transferArgsDeclared(
  args: readonly (RillValue | undefined)[],
  record: object
): void {
  const list = argsDeclared.get(args);
  if (list !== undefined) argsDeclared.set(record, list);
}

/** Declaration for position `index` of a marshalled record, if any. */
export function recordArgDeclared(
  record: object,
  index: number
): TypeStructure | undefined {
  return argsDeclared.get(record)?.[index];
}
