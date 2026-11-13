/**
 * Method call, postfix invocation, annotation reflection, and parameter
 * reflection evaluation.
 * @internal
 */

import type {
  MethodCallNode,
  InvokeNode,
  SourceLocation,
} from '../../../../types.js';
import type { ApplicationCallable } from '../../callable.js';
import {
  declaredParams,
  isCallable,
  isApplicationCallable,
  marshalArgs,
} from '../../callable.js';
import type {
  RillValue,
  RillTypeValue,
  TypeStructure,
} from '../../types/structures.js';
import { insertArgDeclared, pipeDeclaredOf } from '../../types/declared.js';
import { inferType, inferTypeName } from '../../types/registrations.js';
import { isTypeValue, isStream } from '../../types/guards.js';
import { inferStructure, formatStructure } from '../../types/operations.js';
import { structureToTypeValue } from '../../values.js';
import type { EvalState } from '../state.js';
import { appendTraceFrame } from '../../types/status.js';
import { throwCatchableHostHalt, RuntimeHaltSignal } from '../../types/halt.js';
import { createTraceFrame, TRACE_KINDS } from '../../types/trace.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  getNodeLocation,
  checkAborted,
  setDictField,
  isFieldReceiver,
} from '../shared.js';
import {
  argumentsBinder,
  bindOrdered,
  evaluateArgs,
  formatCallSite,
  invokeCallable,
  invokeStream,
} from './closures.js';
import { declaresZeroParams } from './calls.js';
import type { FieldLocation, FoundField } from './field-access.js';
import { locateField, readField } from './field-access.js';

/**
 * Call a built-in type method with the receiver prepended. Arguments go
 * through marshalArgs so arity and types are validated the same way for every
 * receiver; counts in arity errors exclude the receiver.
 */
async function invokeTypeMethod(
  s: EvalState,
  node: MethodCallNode,
  method: ApplicationCallable,
  receiver: RillValue,
  args: readonly RillValue[]
): Promise<RillValue> {
  const callLocation = getNodeLocation(s, node);
  const methodArgs = marshalArgs([receiver, ...args], method.params, {
    functionName: node.name,
    location: callLocation,
    receiverOffset: 1,
  });
  try {
    const result = method.fn(methodArgs, s.ctx, callLocation);
    return result instanceof Promise ? await result : result;
  } catch (e) {
    // Enrichment site: type-method boundary. `method.fn` is a built-in type
    // method (host-registered `RillFunction`), so `host` is the correct
    // origin kind here.
    if (e instanceof RuntimeHaltSignal) {
      const enriched = appendTraceFrame(
        e.value,
        createTraceFrame({
          site: formatCallSite(callLocation, s.ctx.sourceId),
          kind: TRACE_KINDS.HOST,
          fn: node.name,
        })
      );
      throw new RuntimeHaltSignal(enriched, e.catchable);
    }
    throw e;
  }
}

/**
 * Own field a method-call node names on a dict or stream receiver, located
 * by locateField. Other receivers carry no own fields.
 */
function locateMethodOwnField(
  receiver: RillValue,
  name: string
): FieldLocation | undefined {
  return isFieldReceiver(receiver) ? locateField(receiver, name) : undefined;
}

/**
 * The located field when a method-call node is a plain own-field read: no type
 * method of that name, no parens or args, and the own field is not callable.
 * Mirrors the resolution order of evaluateMethod without evaluating anything.
 */
export function locateOwnFieldRead(
  s: EvalState,
  node: MethodCallNode | InvokeNode,
  receiver: RillValue
): FoundField | undefined {
  if (node.type === 'Invoke') return undefined;
  if (node.hasParens || node.args.length > 0) return undefined;
  if (isCallable(receiver) || isTypeValue(receiver)) return undefined;
  const typeMethod = s.ctx.typeMethodDicts.get(inferType(receiver))?.[
    node.name
  ];
  if (typeMethod !== undefined && isApplicationCallable(typeMethod)) {
    return undefined;
  }
  const located = locateMethodOwnField(receiver, node.name);
  return located !== undefined && located.found && !isCallable(located.value)
    ? located
    : undefined;
}

/** Evaluate method call on receiver: value.method(args). */
export async function evaluateMethod(
  s: EvalState,
  node: MethodCallNode | InvokeNode,
  receiver: RillValue
): Promise<RillValue> {
  checkAborted(s, node);

  if (node.type === 'Invoke') {
    return evaluateInvoke(s, node, receiver);
  }
  if (isCallable(receiver)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateMethod',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `Method .${node.name} not available on callable (invoke with -> $() first)`,
      { methodName: node.name, receiverType: 'callable' }
    );
  }
  if (isTypeValue(receiver)) {
    const read = await readField(s, receiver, node.name, {
      allowMissing: true,
      location: getNodeLocation(s, node),
      fn: 'evaluateMethod',
    });
    if (read.value !== null) return read.value;
  }

  const args = await evaluateArgs(s, node.args);
  const typeName = inferType(receiver);
  const typeDict = s.ctx.typeMethodDicts.get(typeName);
  const typeMethod = typeDict?.[node.name];
  if (typeMethod !== undefined && isApplicationCallable(typeMethod)) {
    return invokeTypeMethod(s, node, typeMethod, receiver, args);
  }
  // Locate the field once.
  const ownLocation = locateMethodOwnField(receiver, node.name);
  const ownField =
    ownLocation !== undefined && ownLocation.found
      ? ownLocation.value
      : undefined;
  if (ownField !== undefined && isCallable(ownField)) {
    // Only inject the piped value for an explicit empty-paren call
    // (`.method()`), never for a bare `.field` reference. MethodCallNode
    // carries `hasParens` precisely to distinguish the two: the
    // Variable.accessChain path (parser-variables.ts, isMethodCallWithArgs)
    // only attaches this node when the source wrote parens, but the
    // postfix/pipe-target path (parseMethodCall via isMethodCall in
    // parser-pipe-target.ts and parsePipeTargetDot) attaches it for bare `.field`
    // too, with `args: []` either way. `hasParens` is therefore the only
    // reliable signal here.
    if (
      node.hasParens &&
      args.length === 0 &&
      s.ctx.pipeValue !== null &&
      !declaresZeroParams(ownField)
    ) {
      insertArgDeclared(args, args.length, pipeDeclaredOf(s.ctx));
      args.push(s.ctx.pipeValue);
    }
    return invokeCallable(
      s,
      ownField,
      args,
      getNodeLocation(s, node),
      node.name
    );
  }
  if (args.length === 0 && !node.hasParens) {
    if (ownField !== undefined) return ownField;
  }

  if (isTypeValue(receiver)) {
    return (
      await readField(s, receiver, node.name, {
        allowMissing: false,
        location: getNodeLocation(s, node),
        fn: 'evaluateMethod',
      })
    ).value;
  }
  if (!s.ctx.unvalidatedMethodReceivers.has(node.name)) {
    const supportedTypes: string[] = [];
    for (const [dictType, dict] of s.ctx.typeMethodDicts) {
      if (dict[node.name] !== undefined) {
        supportedTypes.push(dictType);
      }
    }
    if (supportedTypes.length > 0) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateMethod',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R003],
        `Method '${node.name}' not supported on ${typeName}; supported: ${supportedTypes.join(', ')}`,
        { methodName: node.name, receiverType: typeName }
      );
    }
  } else {
    for (const [, dict] of s.ctx.typeMethodDicts) {
      const fallbackMethod = dict[node.name];
      if (
        fallbackMethod !== undefined &&
        isApplicationCallable(fallbackMethod)
      ) {
        return invokeTypeMethod(s, node, fallbackMethod, receiver, args);
      }
    }
  }
  if (ownField === undefined && isFieldReceiver(receiver)) {
    // A dict receiver with no field of this name at all (not merely a
    // non-callable one) routes through the same dict-field-access halt
    // used by `$d.bogus` (readField), so a literal-chain access
    // (`dict[a: 1].bogus`) and a variable access (`$d.bogus`) both halt
    // RILL_R009 instead of this generic unknown-method RILL_R007. A field
    // that DOES exist but is non-callable and was invoked with parens
    // (`$d.a(1)` where `a` is a plain number) still falls through to the
    // generic RILL_R007 below — that is a method-call shape error, not a
    // missing-field error. Non-dict receivers fall through unchanged too.
    return (
      await readField(s, receiver, node.name, {
        allowMissing: false,
        location: getNodeLocation(s, node),
        fn: 'evaluateMethod',
      })
    ).value;
  }
  return throwCatchableHostHalt(
    {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'evaluateMethod',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R007],
    `Unknown method: ${node.name} on type ${typeName}`,
    { methodName: node.name, typeName }
  );
}

/** Evaluate postfix invocation: expr(args). */
async function evaluateInvoke(
  s: EvalState,
  node: InvokeNode,
  receiver: RillValue
): Promise<RillValue> {
  if (isStream(receiver)) {
    return invokeStream(s, receiver, getNodeLocation(s, node));
  }
  if (!isCallable(receiver)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateInvoke',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot invoke non-callable value (got ${inferType(receiver)})`,
      { actualType: inferType(receiver) }
    );
  }

  if (argumentsBinder.hasSpread(node.args)) {
    const orderedArgs = await bindOrdered(
      s,
      receiver,
      node,
      s.ctx.pipeValue ?? undefined
    );
    return invokeCallable(s, receiver, orderedArgs, node.span.start);
  }
  const args = await evaluateArgs(s, node.args);
  return invokeCallable(s, receiver, args, getNodeLocation(s, node));
}

/** Retired reflection probes per receiver, with the `.^type` property that replaced each. */
const RETIRED_PROBE_REPLACEMENTS: Readonly<
  Record<'callable' | 'stream', Readonly<Record<string, string>>>
> = {
  callable: { input: 'inner', output: 'outer' },
  stream: { chunk: 'inner', output: 'outer' },
};

/** Suffix naming the `.^type` property that replaced a retired probe, or ''. */
function retiredProbeHint(
  key: string,
  receiverKind: 'callable' | 'stream',
  receiver: string
): string {
  const probes = RETIRED_PROBE_REPLACEMENTS[receiverKind];
  const replacement = Object.hasOwn(probes, key) ? probes[key] : undefined;
  return replacement === undefined
    ? ''
    : `; use ${receiver}.^type.${replacement}`;
}

/**
 * Evaluate annotation reflection access: .^key on callables, type values, and streams.
 * `.^type` reports the declared type when one is carried, else the inferred type;
 * `.^effective` always reports the inferred own type.
 */
// oxlint-disable-next-line require-await -- halt builders raise synchronously; the async boundary turns them into rejections
export async function evaluateAnnotationAccess(
  s: EvalState,
  value: RillValue,
  key: string,
  location: SourceLocation | undefined,
  declared?: TypeStructure
): Promise<RillValue> {
  if (key === 'type' && declared !== undefined) {
    return structureToTypeValue(declared);
  }
  if (key === 'type' || key === 'effective') {
    const typeValue: RillTypeValue = Object.freeze({
      __rill_type: true as const,
      typeName: inferTypeName(value),
      structure: inferStructure(value),
    });
    return typeValue;
  }

  if (isTypeValue(value)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateAnnotationAccess',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R008],
      'Annotation access not supported on type values',
      { annotationKey: key }
    );
  }

  if (isStream(value)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateAnnotationAccess',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `annotation not found: ^${key}${retiredProbeHint(key, 'stream', '$s')}`,
      { actualType: 'stream' }
    );
  }

  if (!isCallable(value)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateAnnotationAccess',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `annotation not found: ^${key}`,
      { actualType: inferType(value) }
    );
  }

  if (key === 'description') {
    return value.annotations['description'] ?? '';
  }
  const annotationValue = value.annotations[key];
  if (annotationValue === undefined) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateAnnotationAccess',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R008],
      `Annotation '${key}' not found${retiredProbeHint(key, 'callable', '$f')}`,
      { annotationKey: key }
    );
  }

  return annotationValue;
}

/** Evaluate .params property access on callables; builds dict from parameter metadata. */
// oxlint-disable-next-line require-await -- halt builders raise synchronously; the async boundary turns them into rejections
export async function evaluateParamsProperty(
  s: EvalState,
  callable: RillValue,
  location: SourceLocation | undefined
): Promise<Record<string, RillValue>> {
  if (!isCallable(callable)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateParamsProperty',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `Cannot access .params on ${inferType(callable)}`,
      { actualType: inferType(callable) }
    );
  }

  const paramsDict: Record<string, RillValue> = {};
  for (const param of declaredParams(callable, undefined, location)) {
    const paramEntry: Record<string, RillValue> = {};
    if (param.type !== undefined) {
      paramEntry['type'] = formatStructure(param.type);
    }
    if (Object.keys(param.annotations).length > 0) {
      paramEntry['__annotations'] = param.annotations;
    }

    setDictField(paramsDict, param.name, paramEntry);
  }
  return paramsDict;
}
