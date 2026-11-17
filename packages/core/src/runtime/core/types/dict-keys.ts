/**
 * Dict key helpers.
 *
 * Rill dicts are plain JS objects `Record<string, RillValue>`; every key is a
 * string and lives as an own enumerable string property.
 */

import type { RillValue } from './structures.js';

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
