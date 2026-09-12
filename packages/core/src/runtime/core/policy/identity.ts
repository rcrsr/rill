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

import { RuntimeError } from '../../../types.js';
import { ERROR_IDS } from '../../../error-registry.js';
import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import { isDict, isTuple, isOrdered } from '../types/guards.js';
import type { RillValue } from '../types/structures.js';
import type { ExtensionIdentity } from './types.js';

/**
 * Callable -> origin. Module-private on purpose: host and extension
 * functions receive the RuntimeContext, so anything reachable from it
 * is reachable by them. This binding is not on the context.
 */
const identities = new WeakMap<RillCallable, ExtensionIdentity>();

/**
 * Members visited when branding one resolved value.
 *
 * A budget rather than a depth bound. A depth bound left every callable
 * below it unbranded, and an unbranded callable resolves to pass-through,
 * so the one shape the walk refused to handle was the one shape that went
 * unpoliced. Exhausting this budget halts instead — see
 * {@link brandExtensionValue}.
 *
 * The walk is iterative, so the ceiling is this number and not the native
 * stack. Real extension trees are tens of members; a tree that reaches
 * five figures is a resolver defect, not a deep client.
 */
const MAX_BRAND_MEMBERS = 10_000;

/**
 * Record where a resolved value's callables came from.
 *
 * `resource` is the raw resource from `use<scheme:resource>`. Its first
 * segment is the extension name that policy config keys on; any further
 * segments prefix the method path, so `use<ext:kb.client>` brands the
 * `search` member below it as method `"client.search"` — the same key it
 * would carry had the script resolved `use<ext:kb>` and walked down.
 *
 * Dicts, lists, tuples and ordered values are all walked. A resolver is
 * free to return `dict[clients: list[dict[purge: fn]]]`, and the callable
 * at `clients[0].purge` is as reachable from a script as any other, so it
 * is branded `"clients[0].purge"` and matches rules under that key.
 *
 * A callable already branded keeps its first identity. Extensions may
 * share callable instances, and letting a later mount silently re-home
 * one would make the effective policy depend on resolution order.
 *
 * @throws RuntimeError (RILL-R090) if the value exceeds
 *   {@link MAX_BRAND_MEMBERS}. Fatal rather than partial: leaving the
 *   remainder unbranded would silently exempt it from policy.
 */
export function brandExtensionValue(value: RillValue, resource: string): void {
  const segments = resource.split('.').filter((s) => s.length > 0);
  const extension = segments[0];
  if (extension === undefined) return;

  const prefix = segments.slice(1).join('.');
  const seen = new Set<object>();
  const pending: { value: RillValue; path: string }[] = [
    { value, path: prefix },
  ];
  let visited = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;

    if (++visited > MAX_BRAND_MEMBERS) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R090,
        `Extension '${resource}' exceeds ${MAX_BRAND_MEMBERS} members and cannot be branded for policy`
      );
    }

    const member = entry.value;

    if (isCallable(member)) {
      if (!identities.has(member)) {
        identities.set(member, { extension, method: entry.path });
      }
      continue;
    }

    if (typeof member !== 'object' || member === null) continue;

    // Extension values may be self-referential (a client exposing its own
    // root). Without this the walk would not terminate.
    if (seen.has(member)) continue;
    seen.add(member);

    for (const child of members(member, entry.path)) {
      pending.push(child);
    }
  }
}

/**
 * Direct children of a container, each with the path a script would use
 * to reach it. Anything that is not a container yields nothing.
 */
function members(
  value: RillValue,
  path: string
): { value: RillValue; path: string }[] {
  const indexed = (child: RillValue, i: number) => ({
    value: child,
    path: `${path}[${i}]`,
  });

  if (Array.isArray(value)) {
    return value.map(indexed);
  }

  if (isTuple(value)) {
    return value.entries.map(indexed);
  }

  // Ordered values carry [key, value, ...] triples. The value is the
  // reachable member; the key is a string and never a callable.
  if (isOrdered(value)) {
    return value.entries.map(([key, entryValue]) => ({
      value: entryValue,
      path: path === '' ? key : `${path}.${key}`,
    }));
  }

  if (!isDict(value)) return [];

  const out: { value: RillValue; path: string }[] = [];
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) continue;
    out.push({ value: child, path: path === '' ? key : `${path}.${key}` });
  }
  return out;
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
