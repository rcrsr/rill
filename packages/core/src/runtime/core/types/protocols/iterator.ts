/**
 * Iterator Protocol Module
 *
 * TypeDefinition for the 'iterator' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isIterator } from '../guards.js';
import { throwNotSerializable } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatIterator(_v: RillValue): string {
  return 'type(iterator)';
}

// ============================================================
// CONVERT-TO
// ============================================================

const iteratorConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(iterator)',
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const iteratorType: TypeDefinition = {
  name: 'iterator',
  identity: (v: RillValue): boolean => isIterator(v),
  isLeaf: false,
  immutable: false,
  methods: {},
  protocol: {
    format: formatIterator,
    convertTo: iteratorConvertTo,
    serialize: throwNotSerializable('iterator'),
  },
};
