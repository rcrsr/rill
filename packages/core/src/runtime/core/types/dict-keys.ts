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

/** Number of typed (number/boolean) keys on the dict. */
export function typedKeyCount(dict: object): number {
  return getTypedKeyMap(dict)?.size ?? 0;
}

/**
 * Assign an own, enumerable data property to a dict under construction.
 *
 * A plain `obj[key] = value` assignment invokes any inherited setter, so a
 * key literally named `__proto__` would reparent the object rather than store
 * a field. `Object.defineProperty` with a data descriptor always creates an
 * ordinary own field, so `dict[("__proto__"): ...]` stores an own `__proto__`
 * field (readable via `Object.hasOwn`) instead of mutating the prototype.
 *
 * Any code path that rebuilds a dict into a fresh plain object by iterating
 * its own keys (`Object.entries`, typed-key iteration) must route the write
 * through this helper rather than ordinary bracket assignment, or a
 * script-supplied `__proto__` own key reparents the rebuilt object. Generic
 * over the value type so callers rebuilding into a serialized (JSON-shaped,
 * `unknown`-valued) object can reuse it too, not just `RillValue` dicts.
 */
export function setDictField<T = RillValue>(
  obj: Record<string, T>,
  key: string,
  value: T
): void {
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
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
 * All of a dict's entries in canonical display/iteration order: string keys
 * (`Object.keys(dict).sort()` order), then number keys ascending numeric,
 * then boolean keys with `false` before `true`. Each key keeps its original
 * JS type (string, number, or boolean) so callers can distinguish
 * `dict["1": ...]` from `dict[1: ...]`.
 *
 * This is the single ordering authority for dict key/value/entry surfaces
 * (`.keys`/`.values`/`.entries`, `enumerate`, collection iteration,
 * `formatDict`) — those call sites must route through this function rather
 * than re-deriving the order locally.
 */
export function orderedDictEntries(
  dict: object
): ReadonlyArray<{ key: RillValue; value: RillValue }> {
  const stringEntries = Object.keys(dict)
    .sort()
    .map((key) => ({
      key: key as RillValue,
      value: (dict as Record<string, RillValue>)[key]!,
    }));
  const map = getTypedKeyMap(dict);
  const numberEntries: Array<{ key: RillValue; value: RillValue }> = [];
  const booleanEntries: Array<{ key: RillValue; value: RillValue }> = [];
  if (map !== undefined) {
    for (const entry of map.values()) {
      const target =
        typeof entry.key === 'number' ? numberEntries : booleanEntries;
      target.push({ key: entry.key as RillValue, value: entry.value });
    }
  }
  numberEntries.sort((a, b) => (a.key as number) - (b.key as number));
  booleanEntries.sort((a, b) => Number(a.key) - Number(b.key));
  return [...stringEntries, ...numberEntries, ...booleanEntries];
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
