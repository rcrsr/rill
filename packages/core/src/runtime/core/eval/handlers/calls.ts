/**
 * Host function and closure call evaluation: host calls, host refs, closure
 * calls, and pipe invocation.
 * @internal
 */

import type {
  HostCallNode,
  HostRefNode,
  ClosureCallNode,
  PipeInvokeNode,
} from '../../../../types.js';
import type { RillCallable, ApplicationCallable } from '../../callable.js';
import {
  isCallable,
  isScriptCallable,
  isApplicationCallable,
  isDict,
  marshalArgs,
} from '../../callable.js';
import { getVariable } from '../../context.js';
import type { RillValue, RillStream } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isStream } from '../../types/guards.js';
import { anyTypeValue } from '../../values.js';
import type { EvalState } from '../state.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, checkAborted, withTimeout } from '../shared.js';
import {
  argumentsBinder,
  bindOrdered,
  evaluateArgs,
  hasTopLevelDollarInAST,
  invokeCallable,
  invokeScriptCallable,
  invokeStream,
} from './closures.js';

/** Evaluate host function call: functionName(args).
 *
 * When `inPipeTarget` is true the unified pipe-binding rule applies:
 * auto-prepend fires when no top-level `$` appears in the argument list.
 * When false (primary-expression context) the legacy guard is used instead
 * (`args.length === 0`), preserving existing behaviour for calls inside
 * blocks, conditionals, and other non-direct-pipe-target positions.
 */
export async function evaluateHostCall(
  s: EvalState,
  node: HostCallNode,
  inPipeTarget = false
): Promise<RillValue> {
  checkAborted(s, node);

  const fn = s.ctx.functions.get(node.name);
  if (!fn) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateHostCall',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R006],
      `Unknown function: ${node.name}`,
      { functionName: node.name }
    );
  }

  const hasSpread = argumentsBinder.hasSpread(node.args);
  if (hasSpread) {
    const isUntypedBuiltin =
      typeof fn === 'function' ||
      (isApplicationCallable(fn) && (fn.params?.length ?? 0) === 0);
    if (isUntypedBuiltin) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateHostCall',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        `Spread not supported for built-in function '${node.name}'`,
        { functionName: node.name }
      );
    }
    const orderedArgs = await bindOrdered(
      s,
      fn,
      node,
      s.ctx.pipeValue ?? undefined
    );
    // Observers must see the values the callable actually receives, not the
    // raw ordered args (which carry `undefined` holes for omitted optional
    // params). Hydrate defaults via marshalArgs before emitting; invocation
    // below re-marshals independently, so this does not change dispatch.
    // HostCallEvent.args (types/runtime.ts) is out of scope for the
    // (RillValue | undefined)[] threading; the cast lands at this boundary.
    let eventArgs: RillValue[];
    try {
      const hydrated = marshalArgs(orderedArgs as RillValue[], fn.params, {
        functionName: node.name,
        location: node.span.start,
      });
      eventArgs = fn.params.map((param) => hydrated[param.name] as RillValue);
    } catch {
      eventArgs = orderedArgs as RillValue[];
    }
    s.ctx.observability.onHostCall?.({
      name: node.name,
      args: eventArgs,
    });
    const startTime = performance.now();
    const result = await withTimeout(
      s,
      invokeCallable(s, fn, orderedArgs, node.span.start, node.name),
      s.ctx.timeout,
      node.name,
      node
    );
    s.ctx.observability.onFunctionReturn?.({
      name: node.name,
      value: result,
      durationMs: performance.now() - startTime,
    });
    return result;
  }

  const args = await evaluateArgs(s, node.args);
  const isTypedZeroParam =
    typeof fn !== 'function' &&
    isApplicationCallable(fn) &&
    fn.params !== undefined &&
    fn.params.length === 0;
  // pipe-binding rule.
  // In pipe-target position: auto-prepend when no top-level `$` in args.
  // In primary-expression position: preserve legacy guard (args.length === 0)
  // so that host calls inside blocks/conditionals are not affected.
  const shouldPrepend = inPipeTarget
    ? !hasTopLevelDollarInAST(node.args)
    : args.length === 0;
  if (shouldPrepend && s.ctx.pipeValue !== null && !isTypedZeroParam) {
    // unshift inserts at position 0 so the piped value is the first arg.
    // push was sufficient for the legacy empty-args path but is wrong
    // when existing args are present under the unified rule.
    args.unshift(s.ctx.pipeValue);
  }
  s.ctx.observability.onHostCall?.({ name: node.name, args });
  const startTime = performance.now();

  const invoke =
    typeof fn === 'function'
      ? invokeCallable(
          s,
          {
            __type: 'callable' as const,
            kind: 'runtime' as const,
            fn,
            isProperty: false,
            params: [],
            annotations: {},
            returnType: anyTypeValue,
          },
          args,
          node.span.start,
          node.name
        )
      : invokeCallable(s, fn, args, node.span.start, node.name);
  const result = await withTimeout(s, invoke, s.ctx.timeout, node.name, node);
  s.ctx.observability.onFunctionReturn?.({
    name: node.name,
    value: result,
    durationMs: performance.now() - startTime,
  });
  return result;
}

/** Evaluate host function reference: ns::name. Returns callable when pipeValue is null. */
export async function evaluateHostRef(
  s: EvalState,
  node: HostRefNode
): Promise<RillValue> {
  checkAborted(s, node);

  const fn = s.ctx.functions.get(node.name);
  if (!fn) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateHostRef',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R006],
      `Function "${node.name}" not found`,
      { functionName: node.name }
    );
  }

  let appCallable: ApplicationCallable;
  if (typeof fn === 'function') {
    appCallable = {
      __type: 'callable' as const,
      kind: 'application' as const,
      fn,
      params: [],
      annotations: {},
      returnType: anyTypeValue,
      isProperty: false,
    };
  } else {
    appCallable = fn;
  }

  if (s.ctx.pipeValue === null) {
    return appCallable as RillValue;
  }
  const isTypedZeroParam =
    appCallable.params !== undefined && appCallable.params.length === 0;
  const args: RillValue[] = isTypedZeroParam ? [] : [s.ctx.pipeValue];
  return invokeCallable(
    s,
    appCallable,
    args,
    getNodeLocation(s, node),
    node.name
  );
}

/** Evaluate closure call: $fn(args). */
export async function evaluateClosureCall(
  s: EvalState,
  node: ClosureCallNode
): Promise<RillValue> {
  return evaluateClosureCallWithPipe(s, node, s.ctx.pipeValue);
}

/** Evaluate closure call with pipe input; supports access chains like $math.double(args). */
export async function evaluateClosureCallWithPipe(
  s: EvalState,
  node: ClosureCallNode,
  pipeInput: RillValue
): Promise<RillValue> {
  let value: RillValue | undefined = getVariable(s.ctx, node.name);
  if (value === undefined || value === null) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateClosureCallWithPipe',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R005],
      `Unknown variable: $${node.name}`,
      { variableName: node.name }
    );
  }

  const fullPath = ['$' + node.name, ...node.accessChain].join('.');
  for (const prop of node.accessChain) {
    if (value === null) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateClosureCallWithPipe',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        `Cannot access property '${prop}' on null`
      );
    }
    if (isDict(value)) {
      value = (value as Record<string, RillValue>)[prop];
      if (value === undefined || value === null) {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateClosureCallWithPipe',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `Dict has no field '${prop}'`
        );
      }
    } else {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateClosureCallWithPipe',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Cannot access property on non-dict value at '${fullPath}'`
      );
    }
  }

  if (isStream(value)) {
    return invokeStream(s, value as RillStream, getNodeLocation(s, node));
  }
  if (!isCallable(value)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateClosureCallWithPipe',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `'${fullPath}' is not callable`,
      { path: fullPath, actualType: inferType(value) }
    );
  }
  const closure = value;

  if (argumentsBinder.hasSpread(node.args)) {
    if (!isScriptCallable(closure) && !isApplicationCallable(closure)) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateClosureCallWithPipe',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        `Spread not supported for built-in callable at '${fullPath}'`
      );
    }
    const orderedArgs = await bindOrdered(s, closure, node, pipeInput);
    return invokeCallable(s, closure, orderedArgs, node.span.start, fullPath);
  }

  const args = await evaluateArgs(s, node.args);
  if (args.length === 0 && pipeInput !== null && !declaresZeroParams(closure)) {
    args.push(pipeInput);
  }
  return invokeCallable(s, closure, args, node.span.start, fullPath);
}

/**
 * True when the callable declares an empty parameter list, or when arity is
 * unknown (`params === undefined` on an ApplicationCallable). Unknown arity
 * is treated as "do not inject" (the safe default): a loosely-typed host
 * callable built outside the documented registration API should not
 * silently receive a pipe value it never declared a parameter for.
 */
export function declaresZeroParams(value: RillCallable): boolean {
  return (
    (isScriptCallable(value) && value.params.length === 0) ||
    (isApplicationCallable(value) &&
      (value.params === undefined || value.params.length === 0))
  );
}

/** Evaluate pipe invoke: value -> (args). */
export async function evaluatePipeInvoke(
  s: EvalState,
  node: PipeInvokeNode,
  input: RillValue
): Promise<RillValue> {
  if (!isScriptCallable(input)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluatePipeInvoke',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot invoke non-closure value (got ${typeof input})`
    );
  }

  if (argumentsBinder.hasSpread(node.args)) {
    const orderedArgs = await bindOrdered(
      s,
      input,
      node,
      s.ctx.pipeValue ?? undefined
    );
    return invokeScriptCallable(s, input, orderedArgs, node.span.start);
  }

  return invokeScriptCallable(
    s,
    input,
    await evaluateArgs(s, node.args),
    node.span.start
  );
}
