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
import {
  isCallable,
  isScriptCallable,
  isPropertyCallable,
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
import { resolveSelected } from './code-block.js';
import { computedFieldArgs, locateField } from './field-access.js';

/**
 * Bind the piped value as the first argument of a call written as a pipe
 * target.
 *
 * No-op outside pipe-target position, when there is no piped value, or when
 * the caller says to skip the operand. The value is prepended unless a
 * top-level `$` already places it.
 */
function bindPipeOperand(
  args: RillValue[],
  argNodes: readonly (ExpressionNode | SpreadArgNode)[],
  operand: RillValue | null,
  declared: TypeStructure | undefined,
  inPipeTarget: boolean,
  skipOperand: boolean
): void {
  if (!inPipeTarget || operand === null || skipOperand) return;
  if (hasTopLevelDollarInAST(argNodes)) return;
  args.unshift(operand);
  insertArgDeclared(args, 0, declared);
}

/** Evaluate host function call: functionName(args).
 *
 * Only a call written as a pipe target (`inPipeTarget`) receives the piped
 * value, and only when no top-level `$` appears in its argument list. A call
 * elsewhere receives exactly the arguments written.
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
    isPropertyCallable(fn)
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
  // The collection the last access step selected from; a property callable
  // takes it as `self`.
  let container: RillValue | undefined;
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
      container = value;
      // A held block runs with the enclosing `$`, then the result is read on.
      value = (
        await resolveSelected(
          s,
          located.value,
          pipeInput,
          undefined,
          getNodeLocation(s, node)
        )
      ).value;
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
    return invokeCallable(
      s,
      closure,
      container === undefined
        ? orderedArgs
        : computedFieldArgs(closure, container, orderedArgs),
      node.span.start,
      fullPath
    );
  }

  const args = await evaluateArgs(s, node.args);
  bindPipeOperand(
    args,
    node.args,
    pipeInput,
    s.ctx.pipeValue === pipeInput ? pipeDeclaredOf(s.ctx) : undefined,
    inPipeTarget,
    isPropertyCallable(closure)
  );
  return invokeCallable(
    s,
    closure,
    container === undefined
      ? args
      : computedFieldArgs(closure, container, args),
    node.span.start,
    fullPath
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
      `Cannot invoke non-function value (got ${typeof input})`
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
