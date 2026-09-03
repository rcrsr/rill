/**
 * Type-aware dict keys.
 *
 * Rill dicts are plain JS objects `Record<string, RillValue>`, which can only
 * hold string property names. String keys (every dot-accessed dict, every
 * `dict["k": v]`) stay stored exactly that way — as own enumerable string
 * properties — so the overwhelmingly common case is byte-for-byte unchanged and
 * the host API, iterators, and streams that read dicts as plain objects keep
 * working.
 *
 * Number and boolean keys (creatable only via dispatch-key / bracket / spread
 * syntax) cannot coexist with a same-spelling string key in a plain object:
 * number `1` and string `"1"` would both be property `"1"`. They are therefore
 * held in a SIDECAR — a non-enumerable, Symbol-keyed `Map` on the dict object.
 *
 * This is collision-free by construction: string keys live in the object's own
 * enumerable string properties; number/boolean keys live in the sidecar Map,
 * addressed by a `(type, value)` encoding. The two containers are disjoint, so
 * no user string key can ever collide with a typed key regardless of its
 * spelling (a string key literally named "n:1" is a plain property "n:1", not a
 * sidecar entry). The sidecar's own encoding only ever encodes numbers and
 * booleans, which occupy disjoint prefixes (`n:` vs `b:`).
 *
 * The sidecar is a non-enumerable Symbol property, so `Object.keys`,
 * `Object.entries`, `JSON.stringify`, and object spread all skip it. Any code
 * path that must surface typed keys (construction, dispatch, bracket access,
 * `.?`, `.keys`/`.values`/`.entries`, iteration, equality, formatting, json,
 * spread, copy, reflection) consults these helpers explicitly.
 */

import type { RillValue } from './structures.js';

/** A non-string dict key: number or boolean. */
export type TypedKey = number | boolean;

interface TypedEntry {
  /** The original typed key, preserving its JS type. */
  key: TypedKey;
  value: RillValue;
}

/** Map from encoded key to entry. Encoding is number/boolean-only. */
type TypedKeyMap = Map<string, TypedEntry>;

const TYPED_KEYS = Symbol('rill.dict.typedKeys');

interface WithTypedKeys {
  [TYPED_KEYS]?: TypedKeyMap;
}

/**
 * Encode a number/boolean key to a Map lookup string. Numbers and booleans
 * occupy disjoint prefixes, so this is collision-free within the sidecar. (It
 * never has to be free of collisions with user strings — strings are never
 * stored here.)
 */
function encode(key: TypedKey): string {
  return typeof key === 'boolean' ? `b:${key}` : `n:${key}`;
}

/** Returns the sidecar map, or undefined when the dict has no typed keys. */
export function getTypedKeyMap(dict: object): TypedKeyMap | undefined {
  return (dict as WithTypedKeys)[TYPED_KEYS];
}

function ensureTypedKeyMap(dict: object): TypedKeyMap {
  let map = (dict as WithTypedKeys)[TYPED_KEYS];
  if (map === undefined) {
    map = new Map();
    Object.defineProperty(dict, TYPED_KEYS, {
      value: map,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return map;
}

/** True when the dict carries at least one number/boolean key. */
export function hasTypedKeys(dict: object): boolean {
  const map = getTypedKeyMap(dict);
  return map !== undefined && map.size > 0;
}

/** Number of typed (number/boolean) keys on the dict. */
export function typedKeyCount(dict: object): number {
  return getTypedKeyMap(dict)?.size ?? 0;
}

/** Store a number/boolean key. Last write wins, matching string-key semantics. */
export function setTypedKey(
  dict: object,
  key: TypedKey,
  value: RillValue
): void {
  ensureTypedKeyMap(dict).set(encode(key), { key, value });
}

/** Look up a number/boolean key. Returns undefined when absent. */
export function getTypedKey(
  dict: object,
  key: TypedKey
): RillValue | undefined {
  return getTypedKeyMap(dict)?.get(encode(key))?.value;
}

/** Existence check for a number/boolean key. */
export function hasTypedKey(dict: object, key: TypedKey): boolean {
  const map = getTypedKeyMap(dict);
  return map !== undefined && map.has(encode(key));
}

/** Typed entries in insertion order. */
export function typedKeyEntries(
  dict: object
): ReadonlyArray<{ key: TypedKey; value: RillValue }> {
  const map = getTypedKeyMap(dict);
  return map ? [...map.values()] : [];
}

/**
 * Copy the sidecar from `src` onto `dst`, deep-copying each value with the
 * supplied `copyFn` (identity if omitted). No-op when `src` has no typed keys.
 */
export function copyTypedKeys(
  src: object,
  dst: object,
  copyFn?: (v: RillValue) => RillValue
): void {
  const map = getTypedKeyMap(src);
  if (map === undefined || map.size === 0) return;
  const target = ensureTypedKeyMap(dst);
  for (const [encoded, entry] of map) {
    target.set(encoded, {
      key: entry.key,
      value: copyFn ? copyFn(entry.value) : entry.value,
    });
  }
}

/**
 * Route a primitive key/value onto a dict under construction: string keys
 * become own string properties (via `assignStringKey`), number/boolean keys go
 * to the sidecar.
 */
export function storeDictEntry(
  dict: object,
  key: RillValue,
  value: RillValue,
  assignStringKey: (dict: object, key: string, value: RillValue) => void
): void {
  if (typeof key === 'number' || typeof key === 'boolean') {
    setTypedKey(dict, key, value);
  } else {
    assignStringKey(dict, String(key), value);
  }
}
