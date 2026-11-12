/**
 * Union Set Semantics
 *
 * Internal helpers that decide which values a structural type admits
 * (`structureAccepts`) and build a normalized union from written members
 * (`normalizeUnion`). Pure functions: no evaluator state, no halts.
 */

import type { TypeStructure } from './structures.js';
import { isStructureKind } from './guards.js';
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
      !spliced.some(
        (other, j) =>
          j !== i &&
          structureAccepts(other, member) &&
          (!structureAccepts(member, other) || j < i)
      )
  );

  const only = kept[0];
  if (kept.length === 1 && only !== undefined && only.kind !== 'literal') {
    return { structure: only };
  }
  return { structure: { kind: 'union', members: kept } };
}

// ============================================================
// EXPORTS
// ============================================================

export { normalizeUnion };
