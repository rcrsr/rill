/**
 * Method call, postfix invocation, annotation reflection, and parameter
 * reflection evaluation.
 * @internal
 */

import type {
  MethodCallNode,
  InvokeNode,
  SourceLocation,
  RillTypeName,
} from '../../../../types.js';
import {
  isCallable,
  isScriptCallable,
  isApplicationCallable,
  isDict,
  marshalArgs,
} from '../../callable.js';
import { UNVALIDATED_METHOD_PARAMS } from '../../context.js';
import type {
  RillValue,
  RillTypeValue,
  RillStream,
  TypeStructure,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTypeValue, isStream, isOrdered } from '../../types/guards.js';
import {
  paramToFieldDef,
  inferStructure,
  formatStructure,
} from '../../types/operations.js';
import { anyTypeValue, structureToTypeValue } from '../../values.js';
import type { EvalState } from '../state.js';
import { appendTraceFrame } from '../../types/status.js';
import { throwCatchableHostHalt, RuntimeHaltSignal } from '../../types/halt.js';
import { createTraceFrame, TRACE_KINDS } from '../../types/trace.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  getNodeLocation,
  checkAborted,
  accessDictField,
  setDictField,
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
    if (node.name === 'name') {
      return receiver.typeName;
    }
    if (node.name === 'signature') {
      return formatStructure(receiver.structure);
    }
  }

  const args = await evaluateArgs(s, node.args);
  const typeName = inferType(receiver);
  const typeDict = s.ctx.typeMethodDicts.get(typeName);
  const typeMethod = typeDict?.[node.name];
  if (typeMethod !== undefined && isApplicationCallable(typeMethod)) {
    const callLocation = getNodeLocation(s, node);
    const effectiveArgs = [receiver, ...args];
    let methodArgs: Record<string, RillValue>;
    if (typeMethod.params === undefined) {
      methodArgs = effectiveArgs as unknown as Record<string, RillValue>;
    } else if (UNVALIDATED_METHOD_PARAMS.has(node.name)) {
      methodArgs = {
        receiver,
        __positionalArgs: args as RillValue,
      };
    } else {
      methodArgs = marshalArgs(effectiveArgs, typeMethod.params, {
        functionName: node.name,
        location: callLocation,
      });
    }
    try {
      const result = typeMethod.fn(methodArgs, s.ctx, callLocation);
      return result instanceof Promise ? await result : result;
    } catch (e) {
      // Enrichment site 3: type-method boundary. `typeMethod.fn` is a
      // built-in type method (host-registered `RillFunction`), so `host`
      // is the correct origin kind here.
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
  if (isDict(receiver)) {
    const dictValue = receiver[node.name];
    if (dictValue !== undefined && isCallable(dictValue)) {
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
        !declaresZeroParams(dictValue)
      ) {
        args.push(s.ctx.pipeValue);
      }
      return invokeCallable(
        s,
        dictValue,
        args,
        getNodeLocation(s, node),
        node.name
      );
    }
  }
  if (
    isDict(receiver) &&
    args.length === 0 &&
    !node.hasParens &&
    Object.hasOwn(receiver, node.name)
  ) {
    return receiver[node.name] as RillValue;
  }

  if (isTypeValue(receiver)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateMethod',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R009],
      `Property '${node.name}' not found on type value (available: name, signature)`,
      { property: node.name, type: 'type value' }
    );
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
        try {
          const fbMethodArgs: Record<string, RillValue> = { receiver };
          if (fallbackMethod.params) {
            for (let i = 1; i < fallbackMethod.params.length; i++) {
              const p = fallbackMethod.params[i];
              if (p) setDictField(fbMethodArgs, p.name, args[i - 1] ?? null);
            }
          }
          const result = fallbackMethod.fn(
            fbMethodArgs,
            s.ctx,
            getNodeLocation(s, node)
          );
          return result instanceof Promise ? await result : result;
        } catch (e) {
          // Enrichment site 4: fallback-method boundary. `fallbackMethod.fn`
          // is a built-in fallback method (host-registered
          // `RillFunction`), so `host` is the correct origin kind here —
          // same category as the type-method boundary above, not the
          // script-callable boundary in `invokeRegularScriptCallable`.
          const callLocation = getNodeLocation(s, node);
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
    }
  }
  if (
    isDict(receiver) &&
    !isOrdered(receiver) &&
    !Object.hasOwn(receiver, node.name)
  ) {
    // A dict receiver with no field of this name at all (not merely a
    // non-callable one) routes through the same dict-field-access halt
    // used by `$d.bogus` (accessDictField), so a literal-chain access
    // (`dict[a: 1].bogus`) and a variable access (`$d.bogus`) both halt
    // RILL_R009 instead of this generic unknown-method RILL_R007. A field
    // that DOES exist but is non-callable and was invoked with parens
    // (`$d.a(1)` where `a` is a plain number) still falls through to the
    // generic RILL_R007 below — that is a method-call shape error, not a
    // missing-field error. Non-dict receivers fall through unchanged too.
    return accessDictField(s, receiver, node.name, getNodeLocation(s, node));
  }
  throwCatchableHostHalt(
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
    return invokeStream(s, receiver as RillStream, getNodeLocation(s, node));
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
    if (!isScriptCallable(receiver) && !isApplicationCallable(receiver)) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateInvoke',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        'Spread not supported for built-in callable'
      );
    }
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

/** Evaluate annotation reflection access: .^key on callables, type values, and streams. */
export async function evaluateAnnotationAccess(
  s: EvalState,
  value: RillValue,
  key: string,
  location: SourceLocation | undefined
): Promise<RillValue> {
  if (key === 'type') {
    const typeValue: RillTypeValue = Object.freeze({
      __rill_type: true as const,
      typeName: inferType(value) as RillTypeName,
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
    if (key === 'chunk') {
      const chunkType = (
        value as unknown as Record<string, TypeStructure | undefined>
      )['__rill_stream_chunk_type'];
      if (chunkType === undefined) return anyTypeValue;
      return structureToTypeValue(chunkType);
    }
    if (key === 'output') {
      const retType = (
        value as unknown as Record<string, TypeStructure | undefined>
      )['__rill_stream_ret_type'];
      if (retType === undefined) return anyTypeValue;
      return structureToTypeValue(retType);
    }
    throwCatchableHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateAnnotationAccess',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `annotation not found: ^${key}`,
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
  if (key === 'input') {
    if (value.params === undefined) {
      return structureToTypeValue({ kind: 'ordered', fields: [] });
    }
    const fields = value.params.map((param) =>
      paramToFieldDef(
        param.name,
        param.type ?? { kind: 'any' },
        param.defaultValue,
        param.annotations
      )
    );
    return structureToTypeValue({ kind: 'ordered', fields });
  }

  if (key === 'output') {
    return value.returnType;
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
      `Annotation '${key}' not found`,
      { annotationKey: key }
    );
  }

  return annotationValue;
}

/** Evaluate .params property access on callables; builds dict from parameter metadata. */
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
  for (const param of callable.params ?? []) {
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
