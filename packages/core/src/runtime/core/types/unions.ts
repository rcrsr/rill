/**
 * Union Set Semantics
 *
 * Internal helpers that decide which values a structural type admits
 * (`structureAccepts`) and build a normalized union from written members
 * (`normalizeUnion`). Pure functions: no evaluator state, no halts.
 */

import type { RillFieldDef, RillValue, TypeStructure } from './structures.js';
import { isStructureKind } from './guards.js';
import { compareUnionMembers } from './union-order.js';
// oxlint-disable-next-line import/no-cycle -- registrations.ts reaches this file through operations.ts; the edge is used only at call time, never at module init
import { deepEquals as registryDeepEquals } from './registrations.js';
import {
  formatStructure,
  structureEquals,
  structureMatches,
  // oxlint-disable-next-line import/no-cycle -- operations.ts reaches signature-parser.ts, which imports this file; the edge is used only at call time, never at module init
} from './operations.js';

// ============================================================
// PRIVATE HELPERS
// ============================================================

/** True when the structure carries no parameterization beyond its kind. */
function isBareStructure(ts: TypeStructure): boolean {
  const parts: Record<string, unknown> = { ...ts };
  return (
    parts['fields'] === undefined &&
    parts['elements'] === undefined &&
    parts['valueType'] === undefined &&
    parts['params'] === undefined &&
    parts['ret'] === undefined &&
    parts['chunk'] === undefined &&
    parts['element'] === undefined
  );
}

/** True when the field declares a default or its type nests one. */
function fieldHasDefault(field: RillFieldDef): boolean {
  return field.defaultValue !== undefined || containsDefault(field.type);
}

/** True when any field, element, or member of the structure declares a default. */
function containsDefault(ts: TypeStructure): boolean {
  if (isStructureKind(ts, 'dict') && ts.fields !== undefined) {
    return Object.values(ts.fields).some(fieldHasDefault);
  }
  if (isStructureKind(ts, 'ordered') && ts.fields !== undefined) {
    return ts.fields.some(fieldHasDefault);
  }
  if (isStructureKind(ts, 'tuple') && ts.elements !== undefined) {
    return ts.elements.some(fieldHasDefault);
  }
  if (isStructureKind(ts, 'list') && ts.element !== undefined) {
    return containsDefault(ts.element);
  }
  if (isStructureKind(ts, 'union')) return ts.members.some(containsDefault);
  return false;
}

/** True when `keeper` does not declare the defaults of `dropped` identically. */
function fieldLosesDefault(
  dropped: RillFieldDef,
  keeper: RillFieldDef | undefined
): boolean {
  if (keeper === undefined) return fieldHasDefault(dropped);
  const droppedDefault: RillValue | undefined = dropped.defaultValue;
  const keeperDefault: RillValue | undefined = keeper.defaultValue;
  if (droppedDefault !== undefined) {
    if (keeperDefault === undefined) return true;
    if (!registryDeepEquals(droppedDefault, keeperDefault)) return true;
  }
  return losesDefault(dropped.type, keeper.type);
}

/**
 * True when dropping `dropped` in favor of `keeper` (which accepts it) would
 * lose a default that `keeper` does not declare identically, at any depth.
 */
function losesDefault(dropped: TypeStructure, keeper: TypeStructure): boolean {
  if (isStructureKind(dropped, 'union')) {
    return dropped.members.some((member) => losesDefault(member, keeper));
  }
  if (isStructureKind(keeper, 'union')) {
    return !keeper.members.some(
      (member) =>
        structureAccepts(member, dropped) && !losesDefault(dropped, member)
    );
  }
  if (isStructureKind(dropped, 'dict') && dropped.fields !== undefined) {
    const keeperFields = isStructureKind(keeper, 'dict')
      ? keeper.fields
      : undefined;
    return Object.entries(dropped.fields).some(([name, field]) =>
      fieldLosesDefault(
        field,
        keeperFields !== undefined && Object.hasOwn(keeperFields, name)
          ? keeperFields[name]
          : undefined
      )
    );
  }
  if (isStructureKind(dropped, 'ordered') && dropped.fields !== undefined) {
    const keeperFields = isStructureKind(keeper, 'ordered')
      ? keeper.fields
      : undefined;
    return dropped.fields.some((field, i) =>
      fieldLosesDefault(field, keeperFields?.[i])
    );
  }
  if (isStructureKind(dropped, 'tuple') && dropped.elements !== undefined) {
    const keeperElements = isStructureKind(keeper, 'tuple')
      ? keeper.elements
      : undefined;
    return dropped.elements.some((field, i) =>
      fieldLosesDefault(field, keeperElements?.[i])
    );
  }
  if (isStructureKind(dropped, 'list') && dropped.element !== undefined) {
    return isStructureKind(keeper, 'list') && keeper.element !== undefined
      ? losesDefault(dropped.element, keeper.element)
      : containsDefault(dropped.element);
  }
  return false;
}

/**
 * Named-dict acceptance: `outer` accepts `inner` when every outer key is in
 * inner, each shared outer type accepts the inner type, an inner default is
 * matched by an outer default, and every inner-only key has a default.
 * Mirrors structureMatches, which lets extras pass and defaulted fields
 * be absent.
 */
function dictFieldsAccept(
  outer: Record<string, RillFieldDef>,
  inner: Record<string, RillFieldDef>
): boolean {
  for (const [name, outerField] of Object.entries(outer)) {
    if (!Object.hasOwn(inner, name)) return false;
    const innerField = inner[name];
    if (innerField === undefined) return false;
    if (!structureAccepts(outerField.type, innerField.type)) return false;
    if (
      innerField.defaultValue !== undefined &&
      outerField.defaultValue === undefined
    ) {
      return false;
    }
  }
  for (const [name, innerField] of Object.entries(inner)) {
    if (!Object.hasOwn(outer, name) && innerField.defaultValue === undefined) {
      return false;
    }
  }
  return true;
}

// ============================================================
// STRUCTURE ACCEPTS
// ============================================================

/**
 * True only when every value of `inner` is also a value of `outer`.
 * When unsure, returns false: the answer may be incomplete but is never
 * wrong in the true direction.
 */
function structureAccepts(outer: TypeStructure, inner: TypeStructure): boolean {
  if (outer.kind === 'any') return true;
  if (structureEquals(outer, inner)) return true;

  if (isStructureKind(inner, 'union')) {
    return inner.members.every((member) => structureAccepts(outer, member));
  }

  if (isStructureKind(outer, 'union')) {
    return outer.members.some((member) => structureAccepts(member, inner));
  }

  if (isStructureKind(inner, 'literal')) {
    return structureMatches(inner.value, outer);
  }

  if (isStructureKind(outer, 'list') && isStructureKind(inner, 'list')) {
    if (outer.element === undefined) return true;
    if (inner.element === undefined) return false;
    return structureAccepts(outer.element, inner.element);
  }

  if (
    isStructureKind(outer, 'dict') &&
    isStructureKind(inner, 'dict') &&
    outer.fields !== undefined &&
    inner.fields !== undefined
  ) {
    return dictFieldsAccept(outer.fields, inner.fields);
  }

  if (outer.kind === inner.kind && isBareStructure(outer)) return true;

  return false;
}

// ============================================================
// NORMALIZE UNION
// ============================================================

/**
 * Build the normalized structure for a written union.
 * Returns a rejection message when the written members break a union rule.
 */
function normalizeUnion(
  written: readonly TypeStructure[]
): { structure: TypeStructure } | { rejection: string } {
  if (written.length === 0) {
    return { rejection: 'union requires at least one member' };
  }

  for (const [i, member] of written.entries()) {
    for (const earlier of written.slice(0, i)) {
      if (structureEquals(earlier, member)) {
        return {
          rejection: `union lists ${formatStructure(member)} more than once`,
        };
      }
    }
  }

  const spliced: TypeStructure[] = [];
  for (const member of written) {
    if (isStructureKind(member, 'union')) {
      spliced.push(...member.members);
    } else {
      spliced.push(member);
    }
  }

  const kept = spliced.filter(
    (member, i) =>
      !spliced.some((other, j) => {
        if (j === i) return false;
        if (!structureAccepts(other, member)) return false;
        if (losesDefault(member, other)) return false;
        if (!structureAccepts(member, other)) return true;
        const order = compareUnionMembers(other, member, formatStructure);
        return (
          order < 0 ||
          (order === 0 && spliced.indexOf(other) < spliced.indexOf(member))
        );
      })
  );

  const only = kept[0];
  if (kept.length === 1 && only !== undefined && only.kind !== 'literal') {
    return { structure: only };
  }
  return { structure: { kind: 'union', members: kept } };
}

// ============================================================
// SELECT UNION MEMBER
// ============================================================

/**
 * Pick the member a value hydrates with: the narrowest match, independent of
 * written order. Incomparable matches resolve to the first in canonical print
 * order. Returns undefined when no member matches. Pure; never halts.
 */
function selectUnionMember(
  value: RillValue,
  members: readonly TypeStructure[]
): TypeStructure | undefined {
  const matches = members.filter((member) => structureMatches(value, member));
  const minimal = matches.filter(
    (member) =>
      !matches.some(
        (other) =>
          other !== member &&
          structureAccepts(member, other) &&
          !structureAccepts(other, member)
      )
  );
  const [first, ...rest] = minimal;
  if (first === undefined) return undefined;
  return rest.reduce(
    (best, member) =>
      compareUnionMembers(member, best, formatStructure) < 0 ? member : best,
    first
  );
}

// ============================================================
// EXPORTS
// ============================================================

export { normalizeUnion, selectUnionMember };
