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

const EMPTY_PARAMS: readonly RillParam[] = Object.freeze([]);

const PROPERTY_PARAMS: readonly RillParam[] = Object.freeze([
  Object.freeze({
    name: 'self',
    type: { kind: 'any' },
    defaultValue: undefined,
    annotations: {},
  }),
]);

/**
 * Create an application callable from a host function.
 * Declares no parameters, or a single any-typed `self` parameter when
 * `isProperty` is set. The function receives a name-keyed argument record.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(
  fn: CallableFn,
  isProperty = false
): ApplicationCallable {
  const params = isProperty ? PROPERTY_PARAMS : EMPTY_PARAMS;
  return {
    __type: 'callable',
    kind: 'application',
    params,
    annotations: {},
    returnType: anyTypeValue,
    fn,
    isProperty,
  };
}
