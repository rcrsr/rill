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
 *
 * Callables created at call time are covered too. A branded method that
 * returns a sub-client would otherwise hand the script an unbranded, and
 * therefore unpoliced, callable. {@link propagateExtensionIdentity} brands
 * callables reachable from a policed call's result in a second WeakMap,
 * with the method path extended by `()` (`client().search`). A `use<>`
 * brand always wins over a call-time brand.
 */

import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';
import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import { typedKeyEntries } from '../types/dict-keys.js';
import { throwCatchableHostHalt } from '../types/halt.js';
import type { TypeHaltSite } from '../types/halt.js';
import {
  isAtom,
  isDatetime,
  isDict,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isVector,
} from '../types/guards.js';
import type { RillValue } from '../types/structures.js';
import type { ExtensionIdentity } from './types.js';

/**
 * Callable -> origin. Module-private on purpose: host and extension
 * functions receive the RuntimeContext, so anything reachable from it
 * is reachable by them. This binding is not on the context.
 */
const identities = new WeakMap<RillCallable, ExtensionIdentity>();

/**
 * Callable -> origin derived from the result of a policed call. Kept apart
 * from {@link identities} so a call-time brand can never pre-empt or
 * overwrite a `use<>` brand, in either order of arrival.
 */
const derivedIdentities = new WeakMap<RillCallable, ExtensionIdentity>();
// Hazard: this map is module-level, so a derived brand is process-global and
// first-wins. A singleton sub-client returned by both `a.o()` and `b.o()`
// keeps the brand of whichever call ran first.

/**
 * Carry both brands from one callable object to its copy.
 *
 * Both maps key on object identity, so any site that rebuilds a callable
 * (`{ ...value, boundDict }`) would otherwise hand the script an unbranded,
 * unpoliced twin. Existing brands on `to` are left alone.
 */
export function copyExtensionIdentity(
  from: RillCallable,
  to: RillCallable
): void {
  const identity = identities.get(from);
  if (identity !== undefined && !identities.has(to)) {
    identities.set(to, identity);
  }
  const derived = derivedIdentities.get(from);
  if (derived !== undefined && !derivedIdentities.has(to)) {
    derivedIdentities.set(to, derived);
  }
}

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
 * @param site - Halt site of the `use<>` that resolved this value, so a
 *   budget overrun names the import that blew it
 * @throws RILL-R090 (catchable) if the value exceeds
 *   {@link MAX_BRAND_MEMBERS}. Halts rather than branding part of the
 *   tree: leaving the remainder unbranded would silently exempt it from
 *   policy. Catchable to match every other `use<>` failure, and safe to
 *   catch because the halt means no value binds.
 */
export function brandExtensionValue(
  value: RillValue,
  resource: string,
  site: TypeHaltSite
): void {
  const segments = resource.split('.').filter((s) => s.length > 0);
  const extension = segments[0];
  if (extension === undefined) return;

  walkAndBrand(identities, value, extension, segments.slice(1).join('.'), {
    budget: { resource, site },
  });
}

/**
 * Extend a policed call's identity to the callables its result exposes.
 *
 * A branded method may return a sub-client such as
 * `dict[purge: <callable>]`. Those callables are created at call time, so
 * `use<>` never saw them; left unbranded they would resolve to
 * pass-through and escape policy. Each reachable callable is branded with
 * the parent's extension and a path built from the parent's method:
 * `client()` for a returned callable, `client().search` for a dict member,
 * `client()[0]` for a list element. A root-callable parent (empty method)
 * yields `()`, which is non-empty so it is never treated as unidentified.
 *
 * Skipped: script and runtime callables, callables the host registered
 * directly (`isHostRegistered`), streams, and an iterator's `value`.
 * There is no member budget and this never halts. A callable that already
 * carries either brand keeps it. Values are never copied or rebuilt.
 *
 * @param parent - The callable that was invoked
 * @param result - Its result, after any out() transforms
 * @param isHostRegistered - Reports callables registered as host functions
 */
export function propagateExtensionIdentity(
  parent: RillCallable,
  result: RillValue,
  isHostRegistered: (callable: RillCallable) => boolean
): void {
  const identity = getExtensionIdentity(parent);
  if (identity === undefined) return;

  walkAndBrand(
    derivedIdentities,
    result,
    identity.extension,
    `${identity.method}()`,
    { isHostRegistered }
  );
}

interface WalkOptions {
  /** Present for `use<>` walks: enforces the member budget. */
  readonly budget?: { resource: string; site: TypeHaltSite };
  /** Present for call-time walks: filters callables and skips streams. */
  readonly isHostRegistered?: (callable: RillCallable) => boolean;
}

/**
 * Iterative traversal shared by both branding tiers. First brand wins
 * within the target map; `identities` is consulted as well when writing
 * the call-time tier so a `use<>` brand is never shadowed.
 */
function walkAndBrand(
  target: WeakMap<RillCallable, ExtensionIdentity>,
  value: RillValue,
  extension: string,
  prefix: string,
  options: WalkOptions
): void {
  const { budget, isHostRegistered } = options;
  const callTime = isHostRegistered !== undefined;
  const seen = new Set<object>();
  const pending: { value: RillValue; path: string }[] = [
    { value, path: prefix },
  ];
  let visited = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;

    if (budget !== undefined && ++visited > MAX_BRAND_MEMBERS) {
      throwCatchableHostHalt(
        budget.site,
        ERROR_ATOMS[ERROR_IDS.RILL_R090],
        `Extension '${budget.resource}' exceeds ${MAX_BRAND_MEMBERS} members and cannot be branded for policy`,
        { resource: budget.resource, limit: MAX_BRAND_MEMBERS }
      );
    }

    const member = entry.value;

    if (isCallable(member)) {
      if (callTime) {
        if (member.kind === 'script' || member.kind === 'runtime') continue;
        if (identities.has(member) || target.has(member)) continue;
        if (isHostRegistered(member)) continue;
        target.set(member, { extension, method: entry.path });
      } else if (!target.has(member)) {
        target.set(member, { extension, method: entry.path });
      }
      continue;
    }

    if (typeof member !== 'object' || member === null) continue;

    // Leaf value types that are never containers of callables. isDict is
    // true for a Float32Array, so walking a vector would burn the budget.
    if (
      isVector(member) ||
      isDatetime(member) ||
      isDuration(member) ||
      isAtom(member)
    ) {
      continue;
    }

    // Streams are lazy; their elements do not exist yet.
    if (callTime && isStream(member)) continue;

    // Extension values may be self-referential (a client exposing its own
    // root). Without this the walk would not terminate.
    if (seen.has(member)) continue;
    seen.add(member);

    // An iterator is a dict, so its callable members (`next` and any
    // sibling) are branded; only `value`, the yielded element, is skipped.
    // Each `next()` goes through the policed dispatch, which brands what it
    // yields.
    const skipPath =
      callTime && isIterator(member) ? `${entry.path}.value` : undefined;
    for (const child of members(member, entry.path)) {
      if (child.path === skipPath) continue;
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
    return value.filter(isWalkable).map(indexed);
  }

  if (isTuple(value)) {
    return value.entries.filter(isWalkable).map(indexed);
  }

  // Ordered values carry [key, value, ...] triples. The value is the
  // reachable member; the key is a string and never a callable.
  if (isOrdered(value)) {
    return value.entries
      .filter(([, entryValue]) => isWalkable(entryValue))
      .map(([key, entryValue]) => ({
        value: entryValue,
        path: path === '' ? key : `${path}.${key}`,
      }));
  }

  if (!isDict(value)) return [];

  const out: { value: RillValue; path: string }[] = [];
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined || !isWalkable(child)) continue;
    out.push({ value: child, path: path === '' ? key : `${path}.${key}` });
  }
  // Number and boolean keys live in a sidecar, not in Object.keys.
  for (const { key, value: child } of typedKeyEntries(value)) {
    if (!isWalkable(child)) continue;
    out.push({ value: child, path: `${path}[${String(key)}]` });
  }
  return out;
}

/** Whether a value can be a callable or hold one; primitives never do. */
function isWalkable(value: RillValue): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * Look up the extension a callable came from.
 * Returns the `use<>` brand if any, else the call-time brand derived from
 * a policed call's result. Undefined for script closures, built-ins, and
 * host functions registered directly.
 */
export function getExtensionIdentity(
  callable: RillCallable
): ExtensionIdentity | undefined {
  return identities.get(callable) ?? derivedIdentities.get(callable);
}
