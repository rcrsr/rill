/**
 * Dict key helpers.
 *
 * Rill dicts are plain JS objects `Record<string, RillValue>`; every key is a
 * string and lives as an own enumerable string property.
 */

import type {
  RillMap,
  RillMapKey,
  RillOrdered,
  RillValue,
} from './structures.js';
import { isMap, isOrdered } from './guards.js';

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
 * its own keys (`Object.entries`) must route the write
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

/**
 * A dict's entries in canonical display/iteration order: keys sorted by
 * UTF-16 code unit.
 *
 * This is the single ordering authority for dict key/value/entry surfaces
 * (`.keys`/`.values`/`.entries`, `enumerate`, collection iteration,
 * `formatDict`) — those call sites must route through this function rather
 * than re-deriving the order locally.
 */
export function orderedDictEntries(
  dict: Record<string, RillValue>
): ReadonlyArray<{ key: string; value: RillValue }> {
  return Object.entries(dict)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key, value }));
}

/**
 * Entries of an ordered, map, or dict as `{ key, value }` pairs: an ordered
 * and a map in insertion order, a dict in canonical key order.
 *
 * This is the single entry projection behind `.keys`/`.values`/`.entries` and
 * collection iteration for all three; those call sites route through it so
 * each keyed collection keeps its own order in one place.
 */
export function keyedEntries(
  value: RillOrdered | RillMap | Record<string, RillValue>
): ReadonlyArray<{ key: RillMapKey; value: RillValue }> {
  if (isMap(value) || isOrdered(value)) {
    return value.entries.map(([key, v]) => ({ key, value: v }));
  }
  return orderedDictEntries(value);
}

/**
 * Reserved dict method names that cannot be overridden.
 * Must match the full key set of DICT_METHODS in
 * runtime/ext/builtins/methods/tables.ts (len, first, empty, eq, ne, keys,
 * values, entries). Kept as a literal array rather than an import because
 * core/ must not import from ext/; a runtime-level parity test guards
 * against drift between the two.
 */
export const RESERVED_DICT_METHODS = [
  'len',
  'first',
  'empty',
  'eq',
  'ne',
  'keys',
  'values',
  'entries',
] as const;

/**
 * Brand keys used internally to discriminate runtime value shapes
 * (atom, tuple, vector, datetime, duration, ordered, type value, callable,
 * field descriptor, map). A dict key colliding with one of these would let user
 * data masquerade as a branded runtime value, so scripts cannot write them
 * as dict literal keys, type-constructor field names, or annotation keys.
 */
export const RESERVED_BRAND_KEYS = [
  '__type',
  '__rill_atom',
  '__rill_tuple',
  '__rill_vector',
  '__rill_datetime',
  '__rill_duration',
  '__rill_ordered',
  '__rill_map',
  '__rill_type',
  '__rill_stream',
  '__rill_stream_resolve',
  '__rill_stream_head',
  '__rill_stream_dispose',
  '__rill_stream_chunk_type',
  '__rill_stream_ret_type',
  '__rill_field_descriptor',
] as const;

/** Check if a key name is a reserved dict method */
export function isReservedMethod(name: string): boolean {
  return (RESERVED_DICT_METHODS as readonly string[]).includes(name);
}

/** Check if a key name collides with a reserved brand key */
export function isReservedBrandKey(name: string): boolean {
  return (RESERVED_BRAND_KEYS as readonly string[]).includes(name);
}

/** A key a dict cannot hold: a reserved method name or a brand key. */
export function isReservedDictKey(name: string): boolean {
  return isReservedMethod(name) || isReservedBrandKey(name);
}
