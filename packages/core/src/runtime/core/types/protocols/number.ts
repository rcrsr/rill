/**
 * Number Type Protocol Module
 *
 * Defines the TypeDefinition for the 'number' primitive type.
 *
 * Must NOT import from ../registrations.js.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { RuntimeError } from '../../../../types.js';
import { ERROR_IDS } from '../../../../error-registry.js';

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
  const na = a as number;
  const nb = b as number;
  // Relational comparison rather than subtraction: subtraction yields NaN for
  // equal infinities (Infinity - Infinity), which would make every ordering
  // operator return false and break reflexivity of <= / >=.
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
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
    throw new RuntimeError(
      ERROR_IDS.RILL_R066,
      `cannot convert number ${n} to bool`
    );
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
