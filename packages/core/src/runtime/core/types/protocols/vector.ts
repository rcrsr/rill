/**
 * Vector Protocol Module
 *
 * TypeDefinition for the 'vector' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillVector } from '../structures.js';
import type { TypeDefinition } from '../registrations.js';
import { isVector } from '../guards.js';
import { throwNotSerializable } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatVector(v: RillValue): string {
  const vec = v as unknown as RillVector;
  return `vector(${vec.model}, ${vec.data.length}d)`;
}

// ============================================================
// EQ
// ============================================================

function eqVector(a: RillValue, b: RillValue): boolean {
  if (!isVector(a) || !isVector(b)) return false;
  if (a.model !== b.model) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

// ============================================================
// CONVERT-TO
// ============================================================

const vectorConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatVector(v),
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const vectorType: TypeDefinition = {
  name: 'vector',
  identity: (v: RillValue): boolean => isVector(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatVector,
    eq: eqVector,
    convertTo: vectorConvertTo,
    serialize: throwNotSerializable('vector'),
  },
};
