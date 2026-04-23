/**
 * Bool Type Protocol Module
 *
 * Defines the TypeDefinition for the 'bool' primitive type.
 * EC-4: No protocol.compare (ordering unsupported for bool).
 *
 * Must NOT import from ../registrations.js (AC-4).
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';

// ============================================================
// FORMAT
// ============================================================

function formatBool(v: RillValue): string {
  return (v as boolean) ? 'true' : 'false';
}

// ============================================================
// EQ
// ============================================================

function eqBool(a: RillValue, b: RillValue): boolean {
  return a === b;
}

// ============================================================
// CONVERT-TO
// ============================================================

const boolConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => ((v as boolean) ? 'true' : 'false'),
  number: (v: RillValue): RillValue => ((v as boolean) ? 1 : 0),
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeBool(v: RillValue): unknown {
  return v;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const boolType: TypeDefinition = {
  name: 'bool',
  identity: (v: RillValue): boolean => typeof v === 'boolean',
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatBool,
    eq: eqBool,
    convertTo: boolConvertTo,
    serialize: serializeBool,
  },
};
