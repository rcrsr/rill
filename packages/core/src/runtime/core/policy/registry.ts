/**
 * Per-context policy state.
 *
 * Host and extension functions are invoked as `fn(args, ctx, location)`
 * and so receive the whole RuntimeContext. Anything stored on the context
 * is therefore reachable — and, since `readonly` is erased at compile
 * time, writable — by the very code the filter constrains. Storing the
 * resolver under a `hostContext` key would let a sanitizer disarm the
 * filter for the rest of the run with no audit trail.
 *
 * So the binding lives here instead, in a module-private WeakMap that is
 * never exposed on the context. Extension code cannot name this module.
 */

import type { RillCallable } from '../callable.js';
import type { RuntimeContext } from '../types/runtime.js';
import type { FilterResolver } from './types.js';

/** State shared by a root context and every child scope beneath it. */
interface PolicyState {
  readonly resolver: FilterResolver;
  /**
   * Transforms currently executing, used to detect a transform that
   * re-enters itself through a policed method it calls. Mirrors
   * `ResolverContext.resolvingSchemes`, the existing in-flight-set
   * precedent for `use<scheme:resource>`.
   */
  readonly inFlightTransforms: Set<RillCallable>;
}

const states = new WeakMap<RuntimeContext, PolicyState>();

/** Bind a resolver to a freshly created root context. */
export function installFilterResolver(
  ctx: RuntimeContext,
  resolver: FilterResolver
): void {
  states.set(ctx, { resolver, inFlightTransforms: new Set() });
}

/**
 * Share the parent's policy state with a child scope.
 * Shared by reference so the in-flight set spans the whole call tree.
 */
export function inheritPolicyState(
  parent: RuntimeContext,
  child: RuntimeContext
): void {
  const state = states.get(parent);
  if (state !== undefined) states.set(child, state);
}

/** Resolver bound to this context, or undefined when none is configured. */
export function getFilterResolver(
  ctx: RuntimeContext
): FilterResolver | undefined {
  return states.get(ctx)?.resolver;
}

/** In-flight transform set for this context tree. */
export function getInFlightTransforms(
  ctx: RuntimeContext
): Set<RillCallable> | undefined {
  return states.get(ctx)?.inFlightTransforms;
}
