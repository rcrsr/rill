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
import type { RillValue } from '../types/structures.js';

/**
 * A resolved filter for a single method call.
 *
 * Returned by a FilterResolver. Contains the access decision and
 * pre-resolved transform callables (not string references).
 */
export interface Filter {
  /** Whether the call is permitted. */
  readonly access: 'allow' | 'deny';

  /**
   * Transform callables applied to the pipe value (args[0]) before
   * the method executes. Chained sequentially: output of one feeds
   * into the next.
   */
  readonly inTransforms: RillCallable[];

  /**
   * Transform callables applied to the return value after the method
   * executes. Chained sequentially.
   */
  readonly outTransforms: RillCallable[];
}

/**
 * Pluggable filter resolver.
 *
 * Called by invokeCallable on every dispatch. Returns a Filter if a
 * policy applies, or null to let the call pass through unfiltered.
 *
 * The signature takes the full callable (not just the path) so a future
 * annotation-driven resolver can inspect callable.annotations without
 * changing the dispatch path.
 *
 * Implementations should be cheap (map lookups on pre-resolved data).
 */
export type FilterResolver = (
  callable: RillCallable,
  resolvedPath: string | undefined,
  ctx: RuntimeContext
) => Filter | null;

/**
 * Per-method policy rule as declared in config.
 * Transform references are string form ("filter.sanitize") before
 * resolution.
 */
export interface MethodPolicyRule {
  readonly access: 'allow' | 'deny';
  readonly in?: string[];
  readonly out?: string[];
}

/**
 * Per-extension method policy map.
 * Keys are method names. The key "*" is the default for unlisted methods
 * (access-control only, no transforms).
 */
export type ExtensionMethodPolicy = Record<string, MethodPolicyRule>;

/**
 * Top-level policy config. Keys are extension names (matching how they
 * appear in the resolved path after stripping the "$" prefix).
 */
export type PolicyConfig = Record<string, ExtensionMethodPolicy>;

/**
 * Resolved policy with transform string references replaced by actual
 * callables. Built once at context creation, used on every call.
 */
export interface ResolvedPolicy {
  readonly rules: Map<string, Map<string, Filter>>;
  readonly defaults: Map<string, Filter>;
}