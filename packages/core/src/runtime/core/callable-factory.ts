/**
 * Application Callable Factory
 *
 * Import constraints:
 * - Value imports only from ./types/any-type.js, a leaf.
 * - Types come from ./callable.js as `import type`, which erases at compile
 *   time and so forms no runtime dependency.
 *
 * This is separate from callable.ts because types/constructors.ts needs the
 * factory, and callable.ts imports constructors.ts. Sourcing callable() from
 * this leaf lets constructors.ts honour its documented constraint against
 * importing callable.ts.
 */

import type { ApplicationCallable, CallableFn, RillParam } from './callable.js';
import { anyTypeValue } from './types/any-type.js';

/**
 * Create an application callable from a host function.
 * Creates an untyped callable (params: undefined) that skips validation.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(
  fn: CallableFn,
  isProperty = false
): ApplicationCallable {
  return {
    __type: 'callable',
    kind: 'application',
    // Use undefined to signal "untyped" — skips arity validation in invokeCallable.
    // Explicitly registered callables use params: [] (typed zero-param) and DO validate.
    // See [DEVIATION] in Implementation Notes.
    params: undefined as unknown as readonly RillParam[],
    annotations: {},
    returnType: anyTypeValue,
    fn,
    isProperty,
  };
}
