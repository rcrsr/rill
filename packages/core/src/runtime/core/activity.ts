/**
 * Activity signal for `timeout<idle:>`.
 *
 * Activity is a stream chunk arriving or a host function call returning.
 * Each active idle timeout registers a listener on the shared
 * `activityListeners` set; both activity sites call `notifyActivity`, which
 * restarts every registered idle timer, so enclosing timeouts all see it.
 *
 * Runtime-internal callables (built-in functions and methods, iterator and
 * stream steps) are marked so their dispatch never counts as a host return;
 * stream chunk delivery notifies explicitly instead.
 *
 * Leaf module: imports only types, so `callable-factory.ts` can use it.
 */

import type { CallableFn } from './callable.js';

const internalFns = new WeakSet<CallableFn>();

/** Mark `fn` as runtime-internal so its return is not host activity. */
export function markInternalFn(fn: CallableFn): void {
  internalFns.add(fn);
}

/** True when `fn` was marked runtime-internal. */
export function isInternalFn(fn: CallableFn): boolean {
  return internalFns.has(fn);
}

/**
 * Restart every idle timer registered on `listeners`. A host that drives a
 * stream step directly with a bare context passes none, which is a no-op.
 */
export function notifyActivity(
  listeners: ReadonlySet<() => void> | undefined
): void {
  if (listeners === undefined) return;
  for (const listener of listeners) listener();
}
