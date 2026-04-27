/**
 * Dict Protocol Module
 *
 * TypeDefinition for the 'dict' built-in type.
 * Dict MUST remain last in BUILT_IN_TYPES assembly (AC-16).
 * Assembly order is enforced in task 1.7 (registrations.ts), not here.
 *
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isDict } from '../guards.js';
import {
  formatNested,
  compareByDeepEquals,
  serializeListElement,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatDict(v: RillValue): string {
  const dict = v as Record<string, RillValue>;
  const parts = Object.entries(dict).map(
    ([k, val]) => `${k}: ${formatNested(val)}`
  );
  return `dict[${parts.join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

function eqDict(a: RillValue, b: RillValue): boolean {
  const aDict = a as Record<string, RillValue>;
  const bDict = b as Record<string, RillValue>;
  const aKeys = Object.keys(aDict);
  const bKeys = Object.keys(bDict);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in bDict)) return false;
    const aVal = aDict[key];
    const bVal = bDict[key];
    // undefined here means "key present but no value" (e.g. from deserialization);
    // treat as a comparable sentinel rather than "no entry" — two absent values are equal.
    if (aVal === undefined || bVal === undefined) {
      if (aVal !== bVal) return false;
    } else if (!compareByDeepEquals(aVal, bVal)) {
      return false;
    }
  }
  return true;
}

// ============================================================
// CONVERT-TO
// ============================================================

const dictConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue => formatDict(v),
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeDict(v: RillValue): unknown {
  const dict = v as Record<string, RillValue>;
  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(dict)) {
    result[k] = serializeListElement(val);
  }
  return result;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const dictType: TypeDefinition = {
  name: 'dict',
  identity: (v: RillValue): boolean => isDict(v),
  isLeaf: false,
  immutable: false,
  methods: {},
  protocol: {
    format: formatDict,
    eq: eqDict,
    convertTo: dictConvertTo,
    serialize: serializeDict,
  },
};
