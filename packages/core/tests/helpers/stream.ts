/**
 * Test helpers for driving stream steps by hand.
 */

import {
  createRuntimeContext,
  isApplicationCallable,
  isRuntimeCallable,
  isStream,
  type RillStream,
  type RillValue,
} from '@rcrsr/rill';

/**
 * Invoke a stream step's `next` callable directly.
 * Returns the raw result so callers can assert on synchronous throws as well
 * as awaited results.
 */
export function invokeNext(step: RillStream): RillValue | Promise<RillValue> {
  const next = step.next;
  if (!isApplicationCallable(next) && !isRuntimeCallable(next)) {
    throw new Error('stream next is not a host-invocable callable');
  }
  return next.fn({}, createRuntimeContext());
}

/** Advance a stream step and return the following step as a RillStream. */
export async function advanceStream(step: RillStream): Promise<RillStream> {
  const following = await invokeNext(step);
  if (!isStream(following)) {
    throw new Error('stream next did not return a stream step');
  }
  return following;
}
