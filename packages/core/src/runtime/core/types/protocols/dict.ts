/**
 * Dict Protocol Module
 *
 * TypeDefinition for the 'dict' built-in type.
 * Dict MUST remain last in BUILT_IN_TYPES assembly.
 * Assembly order is enforced in task 1.7 (registrations.ts), not here.
 *
 * Allowed imports: ../structures.js, ../guards.js, ../dict-keys.js,
 * ../format-string.js, ./shared.js, ../operations.js, ../callable.js,
 * ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isDict } from '../guards.js';
import {
  getTypedKeyMap,
  typedKeyEntries,
  type TypedKey,
} from '../dict-keys.js';
import { quoteRillString } from '../format-string.js';
import {
  formatNested,
  compareByDeepEquals,
  serializeListElement,
} from './shared.js';

/**
 * Render a dict key for `formatValue`. Number and boolean keys render
 * unquoted (so `dict[1: "a"]` and `dict[true: "a"]` re-parse as typed keys).
 * String keys render as a bare identifier when they are a valid identifier
 * that is not `true`/`false` (which would otherwise re-parse as a boolean);
 * every other string key is quoted so the output round-trips. This keeps the
 * common identifier-keyed case (`dict[a: 1]`) byte-for-byte unchanged.
 */
const IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function formatStringKey(key: string): string {
  if (IDENTIFIER_KEY.test(key) && key !== 'true' && key !== 'false') {
    return key;
  }
  return quoteRillString(key);
}

function formatTypedKey(key: TypedKey): string {
  return String(key);
}

// ============================================================
// FORMAT
// ============================================================

function formatDict(v: RillValue): string {
  const dict = v as Record<string, RillValue>;
  const parts = Object.entries(dict).map(
    ([k, val]) => `${formatStringKey(k)}: ${formatNested(val)}`
  );
  for (const { key, value } of typedKeyEntries(dict)) {
    parts.push(`${formatTypedKey(key)}: ${formatNested(value)}`);
  }
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
  // Compare number/boolean keys by (type, value) identity. Two dicts are equal
  // only when their typed-key sets match exactly, so dict[1: "a"] and
  // dict["1": "a"] are unequal.
  const aTyped = getTypedKeyMap(aDict);
  const bTyped = getTypedKeyMap(bDict);
  const aTypedSize = aTyped?.size ?? 0;
  const bTypedSize = bTyped?.size ?? 0;
  if (aTypedSize !== bTypedSize) return false;
  if (aTyped !== undefined) {
    for (const [encoded, aEntry] of aTyped) {
      const bEntry = bTyped?.get(encoded);
      if (bEntry === undefined) return false;
      if (!compareByDeepEquals(aEntry.value, bEntry.value)) return false;
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
  // JSON object field names are strings, so number/boolean keys serialize to
  // their string form (number 1 -> field "1", boolean true -> field "true").
  // A same-spelled string key, if present, is overwritten last-write-wins.
  for (const { key, value } of typedKeyEntries(dict)) {
    result[String(key)] = serializeListElement(value);
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
