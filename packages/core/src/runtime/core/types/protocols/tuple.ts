/**
 * Tuple Protocol Module
 *
 * TypeDefinition for the 'tuple' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillTuple } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isTuple } from '../guards.js';
import {
  formatNested,
  compareElements,
  compareByDeepEquals,
  throwNotSerializable,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatTuple(v: RillValue): string {
  const t = v as unknown as RillTuple;
  return `tuple[${t.entries.map(formatNested).join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

function eqTuple(a: RillValue, b: RillValue): boolean {
  if (!isTuple(a) || !isTuple(b)) return false;
  return compareElements(a.entries, b.entries, compareByDeepEquals);
}

// ============================================================
// CONVERT-TO
// ============================================================

const tupleConvertTo: Record<string, (v: RillValue) => RillValue> = {
  list: (v: RillValue): RillValue => (v as unknown as RillTuple).entries,
  string: (v: RillValue): RillValue => formatTuple(v),
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const tupleType: TypeDefinition = {
  name: 'tuple',
  identity: (v: RillValue): boolean => isTuple(v),
  isLeaf: false,
  immutable: true,
  methods: {},
  protocol: {
    format: formatTuple,
    eq: eqTuple,
    convertTo: tupleConvertTo,
    serialize: throwNotSerializable('tuple'),
  },
};
