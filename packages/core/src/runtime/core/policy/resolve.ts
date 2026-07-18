/**
 * Filter resolution at the invokeCallable dispatch boundary.
 *
 * Extracts the extension name and method from the resolved path,
 * then looks up the pre-resolved policy. Returns a Filter or null.
 */

import type { Filter, FilterResolver, ResolvedPolicy } from './types.js';
import type { RillCallable } from '../callable.js';
import type { RuntimeContext } from '../types/runtime.js';

/** Key on hostContext where the resolved policy is stored. */
export const POLICY_KEY = '__rill_policy';

/**
 * Parse the resolved path into extension name and method.
 *
 * Resolved paths arrive as "$kb.search" or "ns::name" or just "log".
 * Returns [extName, method] for "$prefix.method" paths, null otherwise.
 */
export function parsePath(
  resolvedPath: string | undefined
): [string, string] | null {
  if (!resolvedPath) return null;

  // $kb.search -> extName="kb", method="search"
  if (resolvedPath.startsWith('$')) {
    const dotIndex = resolvedPath.indexOf('.');
    if (dotIndex === -1) return null; // $fn with no method
    const extName = resolvedPath.slice(1, dotIndex);
    const method = resolvedPath.slice(dotIndex + 1);
    if (!extName || !method) return null;
    return [extName, method];
  }

  return null;
}

/**
 * Config-reading filter resolver.
 *
 * Reads the pre-resolved policy from ctx.hostContext[POLICY_KEY].
 * Returns a Filter if a rule matches, null otherwise.
 *
 * Lookup order:
 * 1. Exact match: policy[extName][method]
 * 2. Default match: policy[extName]["*"]
 * 3. No match: return null (call passes through)
 */
export const configFilterResolver: FilterResolver = (
  _callable: RillCallable,
  resolvedPath: string | undefined,
  ctx: RuntimeContext
): Filter | null => {
  const policy = ctx.hostContext[POLICY_KEY] as
    | ResolvedPolicy
    | undefined;
  if (!policy) return null;

  const parsed = parsePath(resolvedPath);
  if (!parsed) return null;

  const [extName, method] = parsed;

  // Exact match
  const extRules = policy.rules.get(extName);
  if (extRules) {
    const methodFilter = extRules.get(method);
    if (methodFilter) return methodFilter;
  }

  // Default match
  const defaultFilter = policy.defaults.get(extName);
  if (defaultFilter) return defaultFilter;

  return null;
};