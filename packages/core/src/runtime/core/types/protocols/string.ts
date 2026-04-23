/**
 * String Type Protocol Module
 *
 * Defines the TypeDefinition for the 'string' primitive type.
 * Includes null identity: typeof null !== 'string', but rill's type system
 * treats null as the string type (BC-1, AC-19).
 *
 * Must NOT import from ../registrations.js (AC-4).
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from '../registrations.js';
import { resolveAtom } from '../atom-registry.js';
import { RuntimeError } from '../../../../types.js';

// ============================================================
// FORMAT
// ============================================================

function formatString(v: RillValue): string {
  if (v === null) return 'type(null)';
  return v as string;
}

// ============================================================
// EQ
// ============================================================

function eqString(a: RillValue, b: RillValue): boolean {
  return a === b;
}

// ============================================================
// COMPARE
// ============================================================

function compareString(a: RillValue, b: RillValue): number {
  const sa = a as string;
  const sb = b as string;
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

// ============================================================
// CONVERT-TO
// ============================================================

const stringConvertTo: Record<string, (v: RillValue) => RillValue> = {
  number: (v: RillValue): RillValue => {
    const str = v as string;
    const parsed = Number(str);
    if (isNaN(parsed) || str.trim() === '') {
      throw new RuntimeError(
        'RILL-R064',
        `cannot convert string "${str}" to number`
      );
    }
    return parsed;
  },
  bool: (v: RillValue): RillValue => {
    const s = v as string;
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new RuntimeError('RILL-R065', `cannot convert string "${s}" to bool`);
  },
  atom: (v: RillValue): RillValue => {
    const atom = resolveAtom(v as string);
    return { __rill_atom: true, atom } as unknown as RillValue;
  },
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeString(v: RillValue): unknown {
  if (v === null) return null;
  return v;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const stringType: TypeDefinition = {
  name: 'string',
  identity: (v: RillValue): boolean => typeof v === 'string' || v === null,
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatString,
    eq: eqString,
    compare: compareString,
    convertTo: stringConvertTo,
    serialize: serializeString,
  },
};
