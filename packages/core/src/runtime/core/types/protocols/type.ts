/**
 * Type-Value Protocol Module
 *
 * TypeDefinition for the 'type' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillTypeValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isTypeValue } from '../guards.js';
import { formatStructure, structureEquals } from '../operations.js';
import { throwNotSerializable } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatTypeValue(v: RillValue): string {
  const tv = v as unknown as RillTypeValue;
  return formatStructure(tv.structure);
}

// ============================================================
// EQ
// ============================================================

function eqTypeValue(a: RillValue, b: RillValue): boolean {
  if (!isTypeValue(a) || !isTypeValue(b)) return false;
  return structureEquals(a.structure, b.structure);
}

// ============================================================
// CONVERT-TO
// ============================================================

const typeConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatTypeValue(v),
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const typeType: TypeDefinition = {
  name: 'type',
  identity: (v: RillValue): boolean => isTypeValue(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatTypeValue,
    eq: eqTypeValue,
    convertTo: typeConvertTo,
    serialize: throwNotSerializable('type value'),
  },
};
