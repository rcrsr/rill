/**
 * Policy filter types.
 *
 * The filter mechanism is pluggable: any function matching FilterResolver
 * can drive it. The shipped config-reading resolver is one implementation.
 * A future annotation-driven resolver would read callable.annotations
 * at the same site.
 */

import type { RillCallable } from '../callable.js';
import type { RuntimeContext } from '../types/runtime.js';

/**
 * A resolved filter for a single method call.
 *
 * Returned by a FilterResolver. Contains the access decision and
 * pre-resolved transform callables (not string references).
 *
 * Instances handed to the dispatch boundary are deeply frozen by
 * {@link resolvePolicy}, so a host function that gets hold of one
 * cannot rewrite the decision for later calls.
 */
export interface Filter {
  /** Whether the call is permitted. */
  readonly access: 'allow' | 'deny';

  /**
   * Transform callables applied to the pipe value (args[0]) before
   * the method executes. Chained sequentially: output of one feeds
   * into the next.
   */
  readonly inTransforms: readonly RillCallable[];

  /**
   * Transform callables applied to the return value after the method
   * executes. Chained sequentially.
   */
  readonly outTransforms: readonly RillCallable[];
}

/**
 * Pluggable filter resolver.
 *
 * Called by invokeCallable on every non-internal dispatch. Returns a
 * Filter if a policy applies, or null to let the call pass through
 * unfiltered.
 *
 * The signature takes the full callable (not just the path) so a future
 * annotation-driven resolver can inspect callable.annotations without
 * changing the dispatch path. `resolvedPath` is the script-facing call
 * path (e.g. `"$kb.search"`); it is suitable for diagnostics but must
 * not be used as an authorization key, because the script author picks
 * the variable name it is built from. Use {@link getExtensionIdentity}
 * for that.
 *
 * Implementations should be cheap (map lookups on pre-resolved data).
 */
export type FilterResolver = (
  callable: RillCallable,
  resolvedPath: string | undefined,
  ctx: RuntimeContext
) => Filter | null;

/**
 * Where a callable came from, recorded when `use<scheme:resource>`
 * resolves to a value.
 *
 * `extension` is the first segment of the resolved resource, which is
 * what policy config keys on. `method` is the dot-joined path from the
 * extension root down to the callable, and is empty when the extension
 * root is itself a callable.
 */
export interface ExtensionIdentity {
  readonly extension: string;
  readonly method: string;
}

/**
 * Per-method policy rule as declared in config.
 * Transform references are string form ("filter.sanitize") before
 * resolution.
 */
export interface MethodPolicyRule {
  readonly access: 'allow' | 'deny';
  readonly in?: readonly string[];
  readonly out?: readonly string[];
}

/**
 * Per-extension method policy map.
 * Keys are method names. The key "*" is the default for unlisted methods
 * (access-control only, no transforms).
 */
export type ExtensionMethodPolicy = Record<string, MethodPolicyRule>;

/**
 * Top-level policy config. Keys are extension names, matching the first
 * segment of the resource in `use<ext:name>`.
 */
export type PolicyConfig = Record<string, ExtensionMethodPolicy>;

/**
 * Resolved policy with transform string references replaced by actual
 * callables. Built once at context creation, used on every call.
 */
export interface ResolvedPolicy {
  readonly rules: ReadonlyMap<string, ReadonlyMap<string, Filter>>;
  readonly defaults: ReadonlyMap<string, Filter>;
}
