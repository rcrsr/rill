/**
 * Transform execution for in() and out() filters.
 *
 * The dispatch site supplies the invoker rather than this module
 * importing one. A module-level mutable `invokeCallable` slot would have
 * no reset and no isolation: fragile across parallel vitest workers, and
 * wrong outright if two runtimes share a process. Passing the invoker in
 * also keeps `EvalState` inside `eval/`, which a direct import of the
 * internal handler would not.
 */

import { throwCatchableHostHalt } from '../types/halt.js';
import type { TypeHaltSite } from '../types/halt.js';
import type { RillCallable } from '../callable.js';
import type { RillValue } from '../types/structures.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../../error-registry.js';
import { getExtensionIdentity } from './identity.js';

/**
 * Runs one transform against one value.
 *
 * The dispatch site passes an invoker that dispatches with
 * `internal: true`, which skips frame enrichment and, because the filter
 * runs ahead of that branch, keeps the transform's own dispatch from
 * being filtered again.
 *
 * That flag does not propagate into the transform's body: a transform
 * that calls another policed method re-enters the filter path normally,
 * which is what makes the in-flight guard below necessary.
 */
export type TransformInvoker = (
  transform: RillCallable,
  value: RillValue
) => Promise<RillValue>;

/**
 * Apply a chain of transforms to a value.
 *
 * Each transform receives the value as its single argument and returns
 * the transformed value. Transforms are chained sequentially: output of
 * one feeds into the next.
 *
 * @param transforms - Pre-resolved transform callables, in order
 * @param value - The value entering the chain
 * @param invoke - Dispatches a single transform
 * @param inFlight - Transforms already running in this context tree
 * @param site - Halt site used when a cycle is detected
 * @throws RILL-R087 (catchable) if a transform re-enters itself
 */
export async function applyTransforms(
  transforms: readonly RillCallable[],
  value: RillValue,
  invoke: TransformInvoker,
  inFlight: Set<RillCallable> | undefined,
  site: TypeHaltSite
): Promise<RillValue> {
  if (transforms.length === 0) return value;

  let current = value;
  for (const transform of transforms) {
    if (inFlight?.has(transform) === true) {
      const ref = describe(transform);
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R087],
        `Policy transform cycle detected: ${ref} is already running`,
        { reference: ref }
      );
    }

    inFlight?.add(transform);
    try {
      current = await invoke(transform, current);
    } finally {
      inFlight?.delete(transform);
    }
  }
  return current;
}

/** Name a transform for diagnostics, falling back when unbranded. */
function describe(transform: RillCallable): string {
  const identity = getExtensionIdentity(transform);
  if (identity === undefined) return 'transform';
  return identity.method === ''
    ? identity.extension
    : `${identity.extension}.${identity.method}`;
}
