/**
 * List Protocol Module
 *
 * TypeDefinition for the 'list' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from '../registrations.js';
import { isTuple, isOrdered } from '../guards.js';
import { createTuple } from '../constructors.js';
import {
  formatNested,
  compareElements,
  compareByDeepEquals,
  serializeListElement,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatList(v: RillValue): string {
  const arr = v as RillValue[];
  return `list[${arr.map(formatNested).join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

function eqList(a: RillValue, b: RillValue): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return compareElements(a, b, compareByDeepEquals);
}

// ============================================================
// CONVERT-TO
// ============================================================

const listConvertTo: Record<string, (v: RillValue) => RillValue> = {
  tuple: (v: RillValue): RillValue => createTuple(v as RillValue[]),
  string: (v: RillValue): RillValue => formatList(v),
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeList(v: RillValue): unknown {
  return (v as RillValue[]).map(serializeListElement);
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const listType: TypeDefinition = {
  name: 'list',
  identity: (v: RillValue): boolean =>
    Array.isArray(v) && !isTuple(v) && !isOrdered(v),
  isLeaf: false,
  immutable: false,
  methods: {},
  protocol: {
    format: formatList,
    eq: eqList,
    convertTo: listConvertTo,
    serialize: serializeList,
  },
};
