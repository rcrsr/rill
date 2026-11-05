/**
 * Field-Descriptor Protocol Module
 *
 * TypeDefinition for the 'field_descriptor' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isFieldDescriptor } from '../guards.js';
import { throwNotSerializable } from './shared.js';

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
