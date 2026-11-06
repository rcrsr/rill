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
  orderedDictEntries,
  setDictField,
} from '../dict-keys.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { throwFatalHostHalt } from '../halt.js';
import { quoteRillString } from '../format-string.js';
import {
  formatNested,
  compareByDeepEquals,
  serializeListElement,
  requireReceiver,
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

function formatDictKey(key: RillValue): string {
  if (typeof key === 'string') return formatStringKey(key);
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);
  return throwFatalHostHalt(
    { fn: 'format-dict' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'dict key must be a string, number, or boolean'
  );
}

// ============================================================
// FORMAT
// ============================================================

function formatDict(v: RillValue): string {
  const dict = isDict(v)
    ? v
    : requireReceiver(v, isDict, { fn: 'format-dict' }, 'dict');
  const parts = orderedDictEntries(dict).map(({ key, value }) => {
    const formattedKey = formatDictKey(key);
    return `${formattedKey}: ${formatNested(value)}`;
  });
  return `dict[${parts.join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

function eqDict(a: RillValue, b: RillValue): boolean {
  // Guard the right operand first, like every other eq protocol. Without this,
  // Object.keys(b) on a primitive or array yields [], making an empty dict
  // compare equal to non-dicts (dict[] == 5, dict[] == "", dict[] == list[]).
  if (!isDict(a) || !isDict(b)) return false;
  const aDict = a;
  const bDict = b;
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
  const dict = isDict(v)
    ? v
    : requireReceiver(v, isDict, { fn: 'serialize-dict' }, 'dict');
  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(dict)) {
    setDictField(result, k, serializeListElement(val));
  }
  // JSON object field names are strings, so number/boolean keys serialize to
  // their string form (number 1 -> field "1", boolean true -> field "true").
  // A same-spelled string key, if present, is overwritten last-write-wins.
  for (const { key, value } of typedKeyEntries(dict)) {
    setDictField(result, String(key), serializeListElement(value));
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
