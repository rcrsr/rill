/**
 * Test helpers for building host function definitions with neutral defaults.
 */

import {
  anyTypeValue,
  isApplicationCallable,
  isRuntimeCallable,
  type CallableFn,
  type RillFunction,
  type RillParam,
  type RillStream,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';

/** Build a full RillParam with no default value and no annotations. */
export function hostParam(
  name: string,
  type: TypeStructure | undefined
): RillParam {
  return { name, type, defaultValue: undefined, annotations: {} };
}

/** Build a RillFunction whose return type defaults to `any`. */
export function hostFn(def: {
  params: readonly RillParam[];
  fn: CallableFn;
  returnType?: RillTypeValue;
}): RillFunction {
  return {
    params: def.params,
    fn: def.fn,
    returnType: def.returnType ?? anyTypeValue,
  };
}

/**
 * Return a stream's `next` callable body, narrowed to a host-invocable
 * function. Throws if the callable cannot be invoked from the host.
 */
export function getNextFn(step: RillStream): CallableFn {
  const next = step.next;
  if (!isApplicationCallable(next) && !isRuntimeCallable(next)) {
    throw new Error('stream next is not a host-invocable callable');
  }
  return next.fn;
}
