/**
 * Number Type Protocol Module
 *
 * Defines the TypeDefinition for the 'number' primitive type.
 *
 * Must NOT import from ../registrations.js (AC-4).
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from '../registrations.js';
import { RuntimeError } from '../../../../types.js';

// ============================================================
// FORMAT
// ============================================================

function formatNumber(v: RillValue): string {
  return String(v as number);
}

// ============================================================
// EQ
// ============================================================

function eqNumber(a: RillValue, b: RillValue): boolean {
  return a === b;
}

// ============================================================
// COMPARE
// ============================================================

function compareNumber(a: RillValue, b: RillValue): number {
  return (a as number) - (b as number);
}

// ============================================================
// CONVERT-TO
// ============================================================

const numberConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => String(v as number),
  bool: (v: RillValue): RillValue => {
    const n = v as number;
    if (n === 0) return false;
    if (n === 1) return true;
    throw new RuntimeError('RILL-R066', `cannot convert number ${n} to bool`);
  },
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeNumber(v: RillValue): unknown {
  return v;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const numberType: TypeDefinition = {
  name: 'number',
  identity: (v: RillValue): boolean => typeof v === 'number',
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatNumber,
    eq: eqNumber,
    compare: compareNumber,
    convertTo: numberConvertTo,
    serialize: serializeNumber,
  },
};
