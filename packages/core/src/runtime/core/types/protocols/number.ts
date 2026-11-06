/**
 * Number Type Protocol Module
 *
 * Defines the TypeDefinition for the 'number' primitive type.
 *
 * Must NOT import from ../registrations.js.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { throwFatalHostHalt } from '../halt.js';
import { requireReceiver } from './shared.js';

function isNumberValue(v: RillValue): v is number {
  return typeof v === 'number';
}

// ============================================================
// FORMAT
// ============================================================

function formatNumber(v: RillValue): string {
  return String(Number(v));
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
  const na = isNumberValue(a)
    ? a
    : requireReceiver(
        a,
        isNumberValue,
        { fn: 'compare-number' },
        'number',
        'left operand'
      );
  const nb = isNumberValue(b)
    ? b
    : requireReceiver(
        b,
        isNumberValue,
        { fn: 'compare-number' },
        'number',
        'right operand'
      );
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
  string: (v: RillValue): RillValue => String(Number(v)),
  bool: (v: RillValue): RillValue => {
    const n = isNumberValue(v)
      ? v
      : requireReceiver(v, isNumberValue, { fn: 'number-to-bool' }, 'number');
    if (n === 0) return false;
    if (n === 1) return true;
    const message = `cannot convert number ${n} to bool`;
    return throwFatalHostHalt(
      { fn: 'number-to-bool', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R066],
      message
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
