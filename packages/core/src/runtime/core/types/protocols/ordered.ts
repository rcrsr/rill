/**
 * Ordered Protocol Module
 *
 * TypeDefinition for the 'ordered' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillOrdered } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isOrdered } from '../guards.js';
import {
  formatNested,
  compareElements,
  compareOrderedEntry,
  throwNotSerializable,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatOrdered(v: RillValue): string {
  const o = v as unknown as RillOrdered;
  const parts = o.entries.map(([k, val]) => `${k}: ${formatNested(val)}`);
  return `ordered[${parts.join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

function eqOrdered(a: RillValue, b: RillValue): boolean {
  if (!isOrdered(a) || !isOrdered(b)) return false;
  return compareElements(a.entries, b.entries, compareOrderedEntry);
}

// ============================================================
// CONVERT-TO
// ============================================================

const orderedConvertTo: Record<string, (v: RillValue) => RillValue> = {
  dict: (v: RillValue): RillValue => {
    const o = v as unknown as RillOrdered;
    const result: Record<string, RillValue> = {};
    for (const [key, value] of o.entries) {
      result[key] = value;
    }
    return result;
  },
  string: (v: RillValue): RillValue => formatOrdered(v),
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const orderedType: TypeDefinition = {
  name: 'ordered',
  identity: (v: RillValue): boolean => isOrdered(v),
  isLeaf: false,
  immutable: true,
  methods: {},
  protocol: {
    format: formatOrdered,
    eq: eqOrdered,
    convertTo: orderedConvertTo,
    serialize: throwNotSerializable('ordered value'),
  },
};
