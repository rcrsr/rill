/**
 * Closure Protocol Module
 *
 * TypeDefinition for the 'closure' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 *
 * The private `isClosure` helper from registrations.ts is inlined here
 * as a direct call to `isCallable` (they are equivalent).
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import {
  isCallable,
  isScriptCallable,
  callableEquals,
} from '../../callable.js';
import { throwNotSerializable, resolvedDeepEquals } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatClosure(_v: RillValue): string {
  return 'type(closure)';
}

// ============================================================
// EQ
// ============================================================

function eqClosure(a: RillValue, b: RillValue): boolean {
  if (!isCallable(a) || !isCallable(b)) return false;
  // Script callables: structural equality
  if (isScriptCallable(a) && isScriptCallable(b)) {
    return callableEquals(a, b, resolvedDeepEquals);
  }
  // Runtime/application callables: reference equality
  return a === b;
}

// ============================================================
// CONVERT-TO
// ============================================================

const closureConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(closure)',
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const closureType: TypeDefinition = {
  name: 'closure',
  identity: (v: RillValue): boolean => isCallable(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatClosure,
    eq: eqClosure,
    convertTo: closureConvertTo,
    serialize: throwNotSerializable('closure'),
  },
};
