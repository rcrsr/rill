/**
 * Canonical member order for printing a union. Members print type members
 * first, ordered by type name, then literals ordered by kind (atom, bool,
 * number, string). Stored member order is unchanged; only printing sorts.
 *
 * Imports only leaf modules.
 */

import { isAtom } from './guards.js';
import type { TypeStructure } from './structures.js';

const LITERAL_KIND_RANK: Readonly<Record<string, number>> = {
  atom: 0,
  boolean: 1,
  number: 2,
  string: 3,
};

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function literalKind(value: unknown): string {
  return isAtom(value) ? 'atom' : typeof value;
}

function compareLiteralValues(a: unknown, b: unknown): number {
  if (isAtom(a) && isAtom(b)) return compareCodeUnits(a.atom.name, b.atom.name);
  if (typeof a === 'string' && typeof b === 'string') {
    return compareCodeUnits(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return 0;
}

/** Orders two union members by canonical print order (negative: `a` first). */
export function compareUnionMembers(
  a: TypeStructure,
  b: TypeStructure,
  format: (member: TypeStructure) => string
): number {
  if (a.kind === 'literal' && b.kind === 'literal') {
    const av = 'value' in a ? a.value : undefined;
    const bv = 'value' in b ? b.value : undefined;
    const rank =
      (LITERAL_KIND_RANK[literalKind(av)] ?? 9) -
      (LITERAL_KIND_RANK[literalKind(bv)] ?? 9);
    return rank !== 0 ? rank : compareLiteralValues(av, bv);
  }
  if (a.kind === 'literal') return 1;
  if (b.kind === 'literal') return -1;
  const byName = compareCodeUnits(a.kind, b.kind);
  return byName !== 0 ? byName : compareCodeUnits(format(a), format(b));
}

/**
 * Returns a new array of the members in canonical print order: type members
 * by name (ties by printed form), then literals by kind and value.
 */
export function canonicalUnionMembers(
  members: readonly TypeStructure[],
  format: (member: TypeStructure) => string
): TypeStructure[] {
  return [...members].sort((a, b) => compareUnionMembers(a, b, format));
}
