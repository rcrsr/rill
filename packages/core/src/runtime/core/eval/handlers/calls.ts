/**
 * Host function and closure call evaluation: host calls, closure
 * calls, and pipe invocation.
 * @internal
 */

import type {
  HostCallNode,
  ClosureCallNode,
  PipeInvokeNode,
  ExpressionNode,
  SpreadArgNode,
} from '../../../../types.js';
import type { RillCallable } from '../../callable.js';
import {
  declaredParams,
  isCallable,
  isScriptCallable,
  isApplicationCallable,
  marshalArgs,
} from '../../callable.js';
import { getVariable } from '../../context.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import { insertArgDeclared, pipeDeclaredOf } from '../../types/declared.js';
import { inferType } from '../../types/registrations.js';
import { isStream } from '../../types/guards.js';
import type { EvalState } from '../state.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  getNodeLocation,
  checkAborted,
  withTimeout,
  isFieldReceiver,
} from '../shared.js';
import {
  argumentsBinder,
  bindOrdered,
  evaluateArgs,
  hasTopLevelDollarInAST,
  invokeCallable,
  invokeScriptCallable,
  invokeStream,
} from './closures.js';
import { locateField } from './field-access.js';

/**
 * Bind the piped value as the first argument of a call target.
 *
 * No-op when there is no piped value or the caller says to skip the operand.
 * In pipe-target position the value is prepended unless a top-level `$`
 * already places it; in primary position it is inserted only when no
 * arguments were written.
 */
function bindPipeOperand(
  args: RillValue[],
  argNodes: readonly (ExpressionNode | SpreadArgNode)[],
  operand: RillValue | null,
  declared: TypeStructure | undefined,
  inPipeTarget: boolean,
  skipOperand: boolean
): void {
  if (operand === null || skipOperand) return;
  const shouldPrepend = inPipeTarget
    ? !hasTopLevelDollarInAST(argNodes)
    : args.length === 0;
  if (!shouldPrepend) return;
  args.unshift(operand);
  insertArgDeclared(args, 0, declared);
}

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
    let eventArgs: (RillValue | undefined)[];
    try {
      const hydrated = marshalArgs(orderedArgs, fn.params, {
        functionName: node.name,
        location: node.span.start,
      });
      eventArgs = fn.params.map((param) => hydrated[param.name]);
    } catch {
      eventArgs = orderedArgs;
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
  bindPipeOperand(
    args,
    node.args,
    s.ctx.pipeValue,
    pipeDeclaredOf(s.ctx),
    inPipeTarget,
    skipsPipeOperand(fn, inPipeTarget, node.name)
  );
  s.ctx.observability.onHostCall?.({ name: node.name, args });
  const startTime = performance.now();

  const invoke = invokeCallable(s, fn, args, node.span.start, node.name);
  const result = await withTimeout(s, invoke, s.ctx.timeout, node.name, node);
  s.ctx.observability.onFunctionReturn?.({
    name: node.name,
    value: result,
    durationMs: performance.now() - startTime,
  });
  return result;
}

/** Evaluate closure call: $fn(args). */
export function evaluateClosureCall(
  s: EvalState,
  node: ClosureCallNode
): Promise<RillValue> {
  return evaluateClosureCallWithPipe(s, node, s.ctx.pipeValue);
}

/** Evaluate closure call with pipe input; supports access chains like $math.double(args). */
export async function evaluateClosureCallWithPipe(
  s: EvalState,
  node: ClosureCallNode,
  pipeInput: RillValue,
  inPipeTarget = false
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
    if (isFieldReceiver(value)) {
      const located = locateField(value, prop);
      if (!located.found) {
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
      value = located.value;
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
    return invokeStream(s, value, getNodeLocation(s, node));
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
    const orderedArgs = await bindOrdered(s, closure, node, pipeInput);
    return invokeCallable(s, closure, orderedArgs, node.span.start, fullPath);
  }

  const args = await evaluateArgs(s, node.args);
  bindPipeOperand(
    args,
    node.args,
    pipeInput,
    s.ctx.pipeValue === pipeInput ? pipeDeclaredOf(s.ctx) : undefined,
    inPipeTarget,
    // A primary-position call with written args never prepends; skip the
    // parameter inspection so an undeclared callable halts at invocation.
    (!inPipeTarget && args.length > 0) ||
      skipsPipeOperand(closure, inPipeTarget)
  );
  return invokeCallable(s, closure, args, node.span.start, fullPath);
}

/**
 * True when a call must not receive the piped operand: a property-style
 * callable always, and a zero-parameter callable outside pipe-target position.
 * In pipe-target position a zero-parameter callable still receives the
 * operand, so the excess-argument check halts it.
 */
function skipsPipeOperand(
  value: RillCallable,
  inPipeTarget: boolean,
  functionName?: string
): boolean {
  if (isApplicationCallable(value) && value.isProperty) return true;
  if (inPipeTarget) return false;
  return isApplicationCallable(value)
    ? declaredParams(value, functionName).length === 0
    : declaresZeroParams(value);
}

/**
 * True when the callable declares an empty parameter list, or is
 * property-style (its `self` parameter is bound to the dict, not piped).
 */
export function declaresZeroParams(value: RillCallable): boolean {
  return (
    (isScriptCallable(value) && value.params.length === 0) ||
    (isApplicationCallable(value) &&
      (declaredParams(value).length === 0 || value.isProperty))
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
