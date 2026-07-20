/**
 * Transform execution for in() and out() filters.
 *
 * Transforms are invoked with internal=true to bypass the filter
 * mechanism (avoids recursive interception on the transform's own
 * method call).
 */

import type { EvalState } from '../eval/state.js';
import type { RillCallable } from '../callable.js';
import type { RillValue } from '../types/structures.js';
import type { SourceLocation } from '../../../../types.js';

// Forward reference: imported at call time to avoid circular dep
let _invokeCallable:
  | ((
      s: EvalState,
      callable: RillCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName?: string,
      internal?: boolean
    ) => Promise<RillValue>)
  | null = null;

/**
 * Register the invokeCallable function.
 * Called once during module init to break the circular dependency.
 */
export function registerInvokeCallable(
  fn: typeof _invokeCallable
): void {
  _invokeCallable = fn;
}

/**
 * Apply a chain of transforms to a value.
 *
 * Each transform receives the value as its single argument and returns
 * the transformed value. Transforms are chained sequentially: output of
 * one feeds into the next.
 *
 * Invoked with internal=true so the filter mechanism does not intercept
 * the transform's own dispatch.
 */
export async function applyTransforms(
  s: EvalState,
  transforms: RillCallable[],
  value: RillValue,
  callLocation?: SourceLocation
): Promise<RillValue> {
  if (transforms.length === 0) return value;
  if (!_invokeCallable) {
    throw new Error('invokeCallable not registered for transform execution');
  }

  let current = value;
  for (const transform of transforms) {
    current = await _invokeCallable(
      s,
      transform,
      [current],
      callLocation,
      undefined, // no functionName for transforms
      true // internal: bypass filter
    );
  }
  return current;
}