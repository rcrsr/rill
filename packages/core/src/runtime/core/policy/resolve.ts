/**
 * Filter resolution at the invokeCallable dispatch boundary.
 *
 * Matches on the extension identity branded onto the callable when
 * `use<>` resolved it, not on the call path. See ./identity.ts for why
 * the path is unsafe as an authorization key.
 */

import type { RillCallable } from '../callable.js';
import type { RuntimeContext } from '../types/runtime.js';
import { getExtensionIdentity } from './identity.js';
import type { Filter, FilterResolver, ResolvedPolicy } from './types.js';

/**
 * Applied when a callable is known to belong to a policed extension but
 * its method cannot be named — the extension root is itself a callable,
 * so no per-method rule can ever address it. Access control fails
 * closed on shapes it cannot reason about.
 */
const DENY_UNIDENTIFIED: Filter = Object.freeze({
  access: 'deny',
  inTransforms: Object.freeze([]),
  outTransforms: Object.freeze([]),
}) as Filter;

/**
 * Build a filter resolver over a resolved policy.
 *
 * A factory rather than a bare resolver so the policy lives in this
 * closure. Nothing reachable from the RuntimeContext holds it, which
 * keeps it out of reach of the extension functions it governs.
 *
 * Matching, in order:
 * 1. Callable carries no extension brand — pass through. Script
 *    closures, built-ins, and directly registered host functions are
 *    not extension methods and are not policed.
 * 2. Extension has no rules at all — pass through.
 * 3. Extension is policed but the method cannot be named — deny.
 * 4. Exact rule for the method — use it.
 * 5. The extension's `"*"` rule — use it.
 * 6. Otherwise pass through. An unlisted method on a policed extension
 *    is allowed unless the host declared `"*"`; see {@link resolvePolicy}
 *    for why that switch is the host's to throw.
 *
 * The returned resolver also carries `policesExtension(ext)`, true exactly
 * when the policy has rules or a default for `ext`; it shares the check
 * in step 2.
 */
export function createConfigFilterResolver(
  policy: ResolvedPolicy
): FilterResolver {
  const policesExtension = (extension: string): boolean =>
    policy.rules.has(extension) || policy.defaults.has(extension);

  const resolver = (
    callable: RillCallable,
    _resolvedPath: string | undefined,
    _ctx: RuntimeContext
  ): Filter | null => {
    const identity = getExtensionIdentity(callable);
    if (identity === undefined) return null;

    const { extension, method } = identity;
    if (!policesExtension(extension)) return null;

    if (method === '') return DENY_UNIDENTIFIED;

    const exact = policy.rules.get(extension)?.get(method);
    if (exact !== undefined) return exact;

    return policy.defaults.get(extension) ?? null;
  };

  return Object.assign(resolver, { policesExtension });
}
