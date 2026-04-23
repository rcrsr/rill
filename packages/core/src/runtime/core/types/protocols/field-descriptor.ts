/**
 * Field-Descriptor Protocol Module
 *
 * TypeDefinition for the 'field_descriptor' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 *
 * The private `isFieldDescriptor` helper from registrations.ts is inlined here.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { throwNotSerializable } from './shared.js';

// ============================================================
// IDENTITY HELPER (inlined from registrations.ts)
// ============================================================

/** Identity predicate for field_descriptor values. */
function isFieldDescriptor(value: RillValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_field_descriptor' in value &&
    (value as Record<string, unknown>)['__rill_field_descriptor'] === true
  );
}

// ============================================================
// FORMAT
// ============================================================

function formatFieldDescriptor(_v: RillValue): string {
  return 'type(field_descriptor)';
}

// ============================================================
// EQ
// ============================================================

function eqFieldDescriptor(a: RillValue, b: RillValue): boolean {
  // Field descriptors use reference equality
  return a === b;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const fieldDescriptorType: TypeDefinition = {
  name: 'field_descriptor',
  identity: isFieldDescriptor,
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatFieldDescriptor,
    eq: eqFieldDescriptor,
    serialize: throwNotSerializable('field_descriptor'),
  },
};
