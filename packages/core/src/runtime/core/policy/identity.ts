/**
 * Extension identity branding.
 *
 * Policy decisions must not key on the script-chosen capture variable.
 * `use<ext:kb> => $kb` and `use<ext:kb> => $anything` resolve the same
 * value, so a rule keyed on the resolved path `"$kb.search"` is defeated
 * by renaming the variable — a one-line edit available to the untrusted
 * script author this mechanism exists to constrain.
 *
 * Instead, `evaluateUseExpr` brands every callable reachable from a
 * resolved value with the resource name it was resolved under. The brand
 * lives in a module-private WeakMap keyed on the callable object, so it
 * travels with the value through every call syntax (`$kb.search`,
 * `ns::name`, bare names, `receiver.method`) and cannot be reached,
 * forged, or rewritten by host functions, which never see this module.
 */

import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import { isDict } from '../types/guards.js';
import type { RillValue } from '../types/structures.js';
import type { ExtensionIdentity } from './types.js';

/**
 * Callable -> origin. Module-private on purpose: host and extension
 * functions receive the RuntimeContext, so anything reachable from it
 * is reachable by them. This binding is not on the context.
 */
const identities = new WeakMap<RillCallable, ExtensionIdentity>();

/**
 * Maximum dict depth walked when branding a resolved value. Extension
 * trees are shallow; the bound stops a pathological or adversarial
 * structure from costing unbounded work at resolution time.
 */
const MAX_BRAND_DEPTH = 16;

/**
 * Record where a resolved value's callables came from.
 *
 * `resource` is the raw resource from `use<scheme:resource>`. Its first
 * segment is the extension name that policy config keys on; any further
 * segments prefix the method path, so `use<ext:kb.client>` brands the
 * `search` member below it as method `"client.search"` — the same key it
 * would carry had the script resolved `use<ext:kb>` and walked down.
 *
 * A callable already branded keeps its first identity. Extensions may
 * share callable instances, and letting a later mount silently re-home
 * one would make the effective policy depend on resolution order.
 */
export function brandExtensionValue(value: RillValue, resource: string): void {
  const segments = resource.split('.').filter((s) => s.length > 0);
  const extension = segments[0];
  if (extension === undefined) return;
  brand(value, extension, segments.slice(1), 0, new Set());
}

function brand(
  value: RillValue,
  extension: string,
  path: readonly string[],
  depth: number,
  seen: Set<object>
): void {
  if (depth > MAX_BRAND_DEPTH) return;

  if (isCallable(value)) {
    if (!identities.has(value)) {
      identities.set(value, { extension, method: path.join('.') });
    }
    return;
  }

  if (!isDict(value)) return;

  // Extension dicts may be self-referential (a client exposing its own
  // root). Without this the walk would not terminate.
  if (seen.has(value)) return;
  seen.add(value);

  for (const key of Object.keys(value)) {
    const member = value[key];
    if (member === undefined) continue;
    brand(member, extension, [...path, key], depth + 1, seen);
  }
}

/**
 * Look up the extension a callable was resolved from.
 * Returns undefined for anything that did not come through `use<>`:
 * script closures, built-ins, and host functions registered directly.
 */
export function getExtensionIdentity(
  callable: RillCallable
): ExtensionIdentity | undefined {
  return identities.get(callable);
}
