/**
 * ClosuresMixin: closure, host function, method, and invocation evaluation.
 * @internal
 */

import type {
  HostCallNode,
  HostRefNode,
  ClosureCallNode,
  MethodCallNode,
  InvokeNode,
  PipeInvokeNode,
  VariableNode,
  SourceLocation,
  SourceSpan,
  ExpressionNode,
  SpreadArgNode,
  BlockNode,
  RillTypeName,
} from '../../../../types.js';
import { RillError, RuntimeError } from '../../../../types.js';
import type {
  RillCallable,
  ScriptCallable,
  RuntimeCallable,
  ApplicationCallable,
  RillParam,
} from '../../callable.js';
import {
  isCallable,
  isScriptCallable,
  isApplicationCallable,
  isDict,
  marshalArgs,
} from '../../callable.js';
import { getVariable, UNVALIDATED_METHOD_PARAMS } from '../../context.js';
import { markExtensionThrow } from '../../extension-throw.js';
import type { RuntimeContext } from '../../types/runtime.js';
import type {
  RillValue,
  RillTypeValue,
  RillStream,
  TypeStructure,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTypeValue, isStream } from '../../types/guards.js';
import {
  paramToFieldDef,
  inferStructure,
  structureMatches,
  formatStructure,
} from '../../types/operations.js';
import { anyTypeValue, structureToTypeValue } from '../../values.js';
import { YieldSignal } from '../../signals.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvalState } from '../state.js';
import { haltSlowPath } from './access.js';
import {
  STATUS_SYM,
  appendTraceFrame,
  type RillStatus,
} from '../../types/status.js';
import {
  ArgumentsBinder,
  CallableInvocationStrategy,
  activeStreamContexts,
} from '../invocation/index.js';
import type { BoundArguments, StreamChannel } from '../invocation/index.js';
import type { InvocationCaller } from '../invocation/callable-strategy.js';
import {
  throwTypeHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
  RuntimeHaltSignal,
} from '../../types/halt.js';
import { createTraceFrame, TRACE_KINDS } from '../../types/trace.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  getNodeLocation,
  checkAborted,
  withTimeout,
  accessDictField,
} from '../shared.js';
import { evaluateExpression } from './core.js';
import { evaluateBodyExpression } from './control-flow.js';
import { assertType } from './types.js';
import {
  trackStream,
  invokeStreamClosure,
} from '../invocation/stream-closures.js';

// ============================================================
// IR-8: CLOSURE-SKIPPING PIPE-RULE SCANNER
// ============================================================

/**
 * Returns true when any bare `$` pipe placeholder (VariableNode with
 * isPipeVar === true) exists in the argument list, NOT counting occurrences
 * inside ClosureNode bodies (`|params| body`).
 *
 * The scanner descends into all sub-expressions but stops at `Closure`
 * node boundaries, because references to `$` inside closure literals are
 * late-bound and do not affect the outer pipe-binding decision.
 *
 * Implements the IR-8 pipe-rule scanner.
 *
 * SCOPE: HostCall only — PipeInvoke and MethodCall are intentionally excluded.
 *
 *   - PipeInvoke (`$fn -> $arg`): the `input` parameter IS the piped value.
 *     The callable is invoked with the piped value bound to its first
 *     parameter directly; there is no args array ambiguity, so the scanner
 *     adds no value.
 *
 *   - MethodCall (`value.method(args)`): the receiver IS the piped value.
 *     The method target already binds the piped value as the implicit
 *     receiver; scanning the argument list for `$` would be incorrect.
 *
 * Deferral is intentional. A spec amendment is required before applying
 * scanner logic to PipeInvoke or MethodCall node types.
 */
function hasTopLevelDollarInAST(
  args: readonly (ExpressionNode | SpreadArgNode)[]
): boolean {
  for (const arg of args) {
    if (containsDollar(arg)) return true;
  }
  return false;
}

/**
 * Recursive descent helper for hasTopLevelDollarInAST.
 * Visits all AST node properties, stops at Closure and Block boundaries
 * because `$` inside either is late-bound and not a pipe placeholder.
 */
function containsDollar(node: unknown): boolean {
  if (node === null || typeof node !== 'object' || Array.isArray(node))
    return false;
  const n = node as Record<string, unknown>;

  // Stop at closure / block boundaries — `$` inside is late-bound
  if (n['type'] === 'Closure' || n['type'] === 'Block') return false;

  // Bare `$` pipe placeholder
  if (n['type'] === 'Variable' && n['isPipeVar'] === true) return true;

  // Recurse into child properties
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (containsDollar(item)) return true;
      }
    } else if (typeof value === 'object' && value !== null) {
      if (containsDollar(value)) return true;
    }
  }
  return false;
}

/**
 * Format a source location into `file:line:col` form for trace frame `site`.
 * Mirrors the internal `formatSite` logic from `types/halt.ts`.
 */
function formatCallSite(
  location: SourceLocation | undefined,
  sourceId: string | undefined
): string {
  if (location === undefined) {
    return sourceId ?? '<unknown>';
  }
  const file = sourceId ?? '<script>';
  return `${file}:${location.line}:${location.column}`;
}

/**
 * Module-level singleton argument binder. Stateless, so a single instance
 * is reused across every evaluator instance rather than allocated per call.
 */
const argumentsBinder = new ArgumentsBinder();

/**
 * Build the invocation strategy for an evaluator state. Closes over `s`
 * (not `this`) so ctx is always read from the owning evaluator's current
 * state, including reassignment during nested script-callable execution.
 */
function createInvocationStrategy(s: EvalState): CallableInvocationStrategy {
  return new CallableInvocationStrategy(() => s.ctx, argumentsBinder, (async (
    callable: RillCallable,
    args: RillValue[],
    location: SourceLocation | undefined,
    functionName?: string
  ) => {
    if (callable.kind === 'script') {
      return invokeScriptCallable(
        s,
        callable as ScriptCallable,
        args,
        location
      );
    }
    return invokeFnCallable(
      s,
      callable as RuntimeCallable | ApplicationCallable,
      args,
      location,
      functionName
    );
  }) as InvocationCaller);
}

/** Evaluate argument expressions, preserving the current pipeValue. */
export async function evaluateArgs(
  s: EvalState,
  argExprs: (ExpressionNode | SpreadArgNode)[]
): Promise<RillValue[]> {
  const savedPipeValue = s.ctx.pipeValue;
  const args: RillValue[] = [];
  const sourceId = s.ctx.sourceId;
  for (const arg of argExprs) {
    const isSpread = arg.type === 'SpreadArg';
    const expr = isSpread ? arg.expression : arg;
    const evaluated = await evaluateExpression(s, expr);
    let gated: RillValue;
    if (
      evaluated !== null &&
      typeof evaluated === 'object' &&
      (evaluated as { [STATUS_SYM]?: RillStatus })[STATUS_SYM] !== undefined
    ) {
      gated = haltSlowPath(evaluated, isSpread ? '...' : 'arg', expr, sourceId);
    } else {
      gated = evaluated;
    }
    args.push(gated);
  }
  s.ctx.pipeValue = savedPipeValue;
  return args;
}

/** Invoke any callable; dispatches by kind. */
export async function invokeCallable(
  s: EvalState,
  callable: RillCallable,
  args: RillValue[],
  callLocation?: SourceLocation,
  functionName?: string,
  internal?: boolean
): Promise<RillValue> {
  checkAborted(s);

  if (internal === true) {
    let result: RillValue;
    if (callable.kind === 'script') {
      result = await invokeScriptCallable(s, callable, args, callLocation);
    } else {
      result = await invokeFnCallable(
        s,
        callable,
        args,
        callLocation,
        functionName
      );
    }
    if (isStream(result)) {
      trackStream(s, result as RillStream);
    }
    return result;
  }

  if (callLocation) {
    // Route through invocationStrategy.invoke — single frame-enrichment site.
    const bound: BoundArguments = {
      params: new Map(args.map((v, i) => [String(i), v])),
    };
    const result = await createInvocationStrategy(s).invoke(
      callable,
      bound,
      callLocation,
      functionName
    );
    if (isStream(result)) {
      trackStream(s, result as RillStream);
    }
    return result;
  }

  // No call-site location: dispatch directly without a frame.
  let result: RillValue;
  if (callable.kind === 'script') {
    result = await invokeScriptCallable(s, callable, args, callLocation);
  } else {
    result = await invokeFnCallable(
      s,
      callable,
      args,
      callLocation,
      functionName
    );
  }
  if (isStream(result)) {
    trackStream(s, result as RillStream);
  }
  return result;
}

/** Invoke runtime or application callable (native function). */
export async function invokeFnCallable(
  s: EvalState,
  callable: RuntimeCallable | ApplicationCallable,
  args: RillValue[],
  callLocation?: SourceLocation,
  functionName = 'callable'
): Promise<RillValue> {
  if (s.ctx.isDisposed()) {
    return s.ctx.createDisposedResult();
  }

  const effectiveArgs =
    callable.boundDict && args.length === 0 ? [callable.boundDict] : args;

  let fnArgs: Record<string, RillValue>;
  if (isApplicationCallable(callable) && callable.params !== undefined) {
    fnArgs = marshalArgs(effectiveArgs, callable.params, {
      functionName,
      location: callLocation,
    });
  } else {
    fnArgs = effectiveArgs as unknown as Record<string, RillValue>;
  }

  const raw = callable.fn(fnArgs, s.ctx, callLocation);
  const dispatchPromise = raw instanceof Promise ? raw : Promise.resolve(raw);
  s.ctx.trackInflight(dispatchPromise);
  try {
    return await dispatchPromise;
  } catch (e) {
    // Enrichment site 1: extension-dispatch boundary (IR-4, AC-NOD-4).
    // Tag every thrown value as extension-originated first, then enrich
    // either RuntimeHaltSignal payloads or unmigrated RuntimeError sites
    // with call-site metadata.
    markExtensionThrow(e);
    if (e instanceof RuntimeHaltSignal) {
      const enriched = appendTraceFrame(
        e.value,
        createTraceFrame({
          site: formatCallSite(callLocation, s.ctx.sourceId),
          kind: TRACE_KINDS.HOST,
          fn: functionName,
        })
      );
      const newSignal = new RuntimeHaltSignal(enriched, e.catchable);
      markExtensionThrow(newSignal);
      throw newSignal;
    }
    if (e instanceof RuntimeError && !e.location && callLocation) {
      // Extensions that throw RuntimeError without a location lose call-site
      // attribution at the host boundary. Rewrap with the call-site span so
      // host-visible error metadata stays consistent across migrated and
      // unmigrated throw sites.
      const span: SourceSpan = { start: callLocation, end: callLocation };
      const enriched = new RuntimeError(
        e.errorId,
        e.toData().message,
        callLocation,
        e.context,
        span
      );
      markExtensionThrow(enriched);
      throw enriched;
    }
    throw e;
  }
}

/** Create closure execution context with defining scope as parent. */
export function createCallableContext(
  s: EvalState,
  callable: ScriptCallable
): RuntimeContext {
  const hasExplicitParams =
    callable.params.length > 0 && callable.params[0]!.name !== '$';

  const defScope = callable.definingScope as RuntimeContext;
  const callableCtx: RuntimeContext = {
    ...s.ctx,
    parent: defScope,
    variables: new Map(),
    variableTypes: new Map(),
    pipeValue: hasExplicitParams ? null : s.ctx.pipeValue,
    sourceId: defScope.sourceId ?? s.ctx.sourceId,
    sourceText: defScope.sourceText ?? s.ctx.sourceText,
  };
  if (callable.boundDict) {
    callableCtx.pipeValue = callable.boundDict;
  }
  return callableCtx;
}

/** Validate parameter type via structural matching; no-op for any-typed params. */
export function validateParamType(
  s: EvalState,
  param: RillParam,
  value: RillValue,
  callLocation?: SourceLocation
): void {
  if (param.type === undefined) return;
  if (!structureMatches(value, param.type)) {
    const expectedType = formatStructure(param.type);
    const actualType = inferType(value);
    throwCatchableHostHalt(
      {
        location: callLocation,
        sourceId: s.ctx.sourceId,
        fn: 'validateParamType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R001],
      `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${actualType}`,
      { paramName: param.name, expectedType, actualType }
    );
  }
}

/** Push chunk to active stream channel, or throw YieldSignal if not streaming. */
export function evaluateYield(
  s: EvalState,
  value: RillValue,
  location?: SourceLocation
): never | Promise<void> {
  if (s.activeStreamChunkType !== null) {
    if (!structureMatches(value, s.activeStreamChunkType)) {
      const expected = formatStructure(s.activeStreamChunkType);
      const actual = inferType(value);
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'yield',
        },
        'TYPE_MISMATCH',
        `Yielded value type mismatch: expected ${expected}, got ${actual}`,
        'runtime',
        { expected, actual }
      );
    }
  }

  if (s.activeStreamChannel) {
    return s.activeStreamChannel.push(value);
  }
  let searchCtx: RuntimeContext | undefined = s.ctx;
  while (searchCtx != null) {
    const streamCtx = activeStreamContexts.get(searchCtx);
    if (streamCtx !== undefined) {
      if (streamCtx.chunkType !== null) {
        if (!structureMatches(value, streamCtx.chunkType)) {
          const expected = formatStructure(streamCtx.chunkType);
          const actual = inferType(value);
          throwTypeHalt(
            { location, sourceId: s.ctx.sourceId, fn: 'yield' },
            'TYPE_MISMATCH',
            `Yielded value type mismatch: expected ${expected}, got ${actual}`,
            'runtime',
            { expected, actual }
          );
        }
      }
      return streamCtx.channel.push(value);
    }
    searchCtx = searchCtx.parent;
  }
  throw new YieldSignal(value);
}

/** Invoke script callable; dispatches stream closures to StreamClosuresMixin. */
export async function invokeScriptCallable(
  s: EvalState,
  callable: ScriptCallable,
  args: RillValue[],
  callLocation?: SourceLocation
): Promise<RillValue> {
  if (callable.returnType.structure.kind === 'stream') {
    return invokeStreamClosure(s, callable, args, callLocation);
  }
  return invokeRegularScriptCallable(s, callable, args, callLocation);
}

export async function invokeRegularScriptCallable(
  s: EvalState,
  callable: ScriptCallable,
  args: RillValue[],
  callLocation?: SourceLocation
): Promise<RillValue> {
  const callableCtx = createCallableContext(s, callable);

  const params = callable.params;
  if (
    params.length === 1 &&
    args.length === 1 &&
    params[0]!.type === undefined
  ) {
    const only = params[0]!;
    callableCtx.variables.set(only.name, args[0]!);
    if (only.name === '$') {
      callableCtx.pipeValue = args[0]!;
    }
  } else {
    const record = marshalArgs(args, params, {
      functionName: '<anonymous>',
      location: callLocation,
    });
    for (const [name, value] of Object.entries(record)) {
      callableCtx.variables.set(name, value);
    }
    if (params[0]?.name === '$') {
      callableCtx.pipeValue = record['$']!;
    }
  }
  if (
    callable.body.type === 'Block' &&
    (callable.body as BlockNode).statements.length === 0
  ) {
    throwFatalHostHalt(
      {
        location: callLocation,
        sourceId: s.ctx.sourceId,
        fn: 'invokeRegularScriptCallable',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R043],
      'Closure body produced no value',
      { context: 'Closure body' }
    );
  }
  const savedCtx = s.ctx;
  s.ctx = callableCtx;
  try {
    const result = await evaluateBodyExpression(s, callable.body);
    if (callable.returnType.typeName !== 'any') {
      assertType(s, result, callable.returnType.structure, callLocation);
    }
    return result;
  } catch (e) {
    // Enrichment site 2: script-callable boundary (IR-4, AC-NOD-4).
    // Tag every thrown value as extension-originated first, then enrich
    // RuntimeHaltSignal payloads with a host-kind trace frame.
    markExtensionThrow(e);
    if (e instanceof RuntimeHaltSignal) {
      const enriched = appendTraceFrame(
        e.value,
        createTraceFrame({
          site: formatCallSite(callLocation, callableCtx.sourceId),
          kind: TRACE_KINDS.HOST,
          fn: 'invokeRegularScriptCallable',
        })
      );
      const newSignal = new RuntimeHaltSignal(enriched, e.catchable);
      markExtensionThrow(newSignal);
      throw newSignal;
    }
    // Restore sourceId on RillError instances that escaped without one.
    // Pre-migration this block was explicit; after the halt-builder migration
    // the unmigrated RuntimeError sites (e.g. variables.ts RILL_R005) still
    // throw RuntimeError directly and need sourceId enriched at this boundary
    // so host callers observe the AC-NOD-6 sourceId contract.
    if (e instanceof RillError && !e.sourceId && callableCtx.sourceId) {
      (e as { sourceId: string }).sourceId = callableCtx.sourceId;
      if (callableCtx.sourceText) {
        const ctx = (e.context ?? {}) as Record<string, unknown>;
        ctx['sourceText'] = callableCtx.sourceText;
        (e as { context: Record<string, unknown> }).context = ctx;
      }
    }
    throw e;
  } finally {
    s.ctx = savedCtx;
  }
}

/** Drain stream and return its resolution value. */
export async function invokeStream(
  s: EvalState,
  stream: RillStream
): Promise<RillValue> {
  const resolveFn = (
    stream as unknown as Record<string, (() => Promise<RillValue>) | undefined>
  )['__rill_stream_resolve'];
  if (typeof resolveFn !== 'function') {
    throwFatalHostHalt(
      { sourceId: s.ctx.sourceId, fn: 'invokeStream' },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Stream has no resolve function'
    );
  }

  let current: RillStream = stream;
  while (!current.done) {
    const nextCallable = current['next'];
    if (!nextCallable || !isCallable(nextCallable)) break;
    try {
      const next = await invokeCallable(s, nextCallable, []);
      if (
        typeof next !== 'object' ||
        next === null ||
        !isStream(next as RillValue)
      )
        break;
      current = next as unknown as RillStream;
    } catch {
      break;
    }
  }
  return resolveFn();
}

/** Evaluate host function call: functionName(args).
 *
 * When `inPipeTarget` is true the IR-8 unified pipe-binding rule applies:
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
    const boundArgs = await argumentsBinder.bind(
      node.args,
      fn,
      s.ctx.pipeValue ?? undefined,
      (expr) => evaluateExpression(s, expr),
      node.span.start
    );
    const orderedArgs = fn.params!.map((p) => boundArgs.params.get(p.name)!);
    s.ctx.observability.onHostCall?.({
      name: node.name,
      args: orderedArgs,
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
  // IR-8: pipe-binding rule.
  // In pipe-target position: auto-prepend when no top-level `$` in args.
  // In primary-expression position: preserve legacy guard (args.length === 0)
  // so that host calls inside blocks/conditionals are not affected.
  const shouldPrepend = inPipeTarget
    ? !hasTopLevelDollarInAST(node.args)
    : args.length === 0;
  if (shouldPrepend && s.ctx.pipeValue !== null && !isTypedZeroParam) {
    // unshift inserts at position 0 so the piped value is the first arg.
    // push was sufficient for the legacy empty-args path but is wrong
    // when existing args are present (new IR-8 rule).
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
    return invokeStream(s, value as RillStream);
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
    const boundArgs = await createInvocationStrategy(s).bind(
      closure,
      node.args,
      pipeInput,
      (expr) => evaluateExpression(s, expr),
      node.span.start
    );
    const orderedArgs = closure.params!.map(
      (p) => boundArgs.params.get(p.name)!
    );
    return invokeCallable(s, closure, orderedArgs, node.span.start, fullPath);
  }

  const args = await evaluateArgs(s, node.args);
  if (args.length === 0 && pipeInput !== null) {
    const closureHasZeroParams =
      (isScriptCallable(closure) && closure.params.length === 0) ||
      (isApplicationCallable(closure) &&
        closure.params !== undefined &&
        closure.params.length === 0);
    if (!closureHasZeroParams) {
      args.push(pipeInput);
    }
  }
  return invokeCallable(s, closure, args, node.span.start, fullPath);
}

/** Evaluate $.field as property access on the pipe value. */
export async function evaluatePipePropertyAccess(
  s: EvalState,
  node: VariableNode,
  pipeInput: RillValue
): Promise<RillValue> {
  let value = pipeInput;

  for (const access of node.accessChain) {
    if (value === null) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluatePipePropertyAccess',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        'Cannot access property on null'
      );
    }

    if ('accessKind' in access) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluatePipePropertyAccess',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Bracket access not supported in this context'
      );
    }

    if (access.kind === 'literal') {
      const field = access.field;
      value = await accessDictField(s, value, field, getNodeLocation(s, node));
    } else {
      throwFatalHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluatePipePropertyAccess',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Field access kind '${(access as { kind: string }).kind}' not supported in this context`
      );
    }
  }

  if (value === null && node.defaultValue) {
    value = await evaluateBodyExpression(s, node.defaultValue);
  }
  return value;
}

/** Placeholder; actual variable invoke logic is in VariablesMixin.evaluateVariableAsync. */
export async function evaluateVariableInvoke(
  s: EvalState,
  node: PipeInvokeNode,
  _pipeInput: RillValue
): Promise<RillValue> {
  throwFatalHostHalt(
    {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'evaluateVariableInvoke',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'evaluateVariableInvoke is a placeholder - use evaluateVariableAsync from VariablesMixin'
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
    const boundArgs = await argumentsBinder.bind(
      node.args,
      input,
      s.ctx.pipeValue ?? undefined,
      (expr) => evaluateExpression(s, expr),
      node.span.start
    );
    const orderedArgs = input.params.map((p) => boundArgs.params.get(p.name)!);
    return invokeScriptCallable(s, input, orderedArgs, node.span.start);
  }

  return invokeScriptCallable(
    s,
    input,
    await evaluateArgs(s, node.args),
    node.span.start
  );
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
      // Enrichment site 3: type-method boundary (IR-4, AC-NOD-4).
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
              if (p) fbMethodArgs[p.name] = args[i - 1] ?? null;
            }
          }
          const result = fallbackMethod.fn(
            fbMethodArgs,
            s.ctx,
            getNodeLocation(s, node)
          );
          return result instanceof Promise ? await result : result;
        } catch (e) {
          // Enrichment site 4: fallback-method boundary (IR-4, AC-NOD-4).
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
export async function evaluateInvoke(
  s: EvalState,
  node: InvokeNode,
  receiver: RillValue
): Promise<RillValue> {
  if (isStream(receiver)) {
    return invokeStream(s, receiver as RillStream);
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
    const boundArgs = await argumentsBinder.bind(
      node.args,
      receiver,
      s.ctx.pipeValue ?? undefined,
      (expr) => evaluateExpression(s, expr),
      node.span.start
    );
    const orderedArgs = receiver.params!.map(
      (p) => boundArgs.params.get(p.name)!
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
    return value.annotations['description'] ?? {};
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

    paramsDict[param.name] = paramEntry;
  }
  return paramsDict;
}

export function ClosuresMixin<
  TBase extends EvaluatorConstructor<EvaluatorBase>,
>(Base: TBase) {
  return class ClosuresEvaluator extends Base {
    /** Active stream channel; set during stream closure body execution. */
    activeStreamChannel:
      | (StreamChannel & { readonly resolution: RillValue })
      | null = null;

    /** Expected chunk type for the active stream closure; null when not streaming. */
    activeStreamChunkType: TypeStructure | null = null;

    /** Invocation strategy; dispatches to invokeScriptCallable or invokeFnCallable. */
    readonly invocationStrategy: CallableInvocationStrategy =
      createInvocationStrategy(this as unknown as EvalState);

    evaluateArgs(
      argExprs: (ExpressionNode | SpreadArgNode)[]
    ): Promise<RillValue[]> {
      return evaluateArgs(this as unknown as EvalState, argExprs);
    }

    invokeCallable(
      callable: RillCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName?: string,
      internal?: boolean
    ): Promise<RillValue> {
      return invokeCallable(
        this as unknown as EvalState,
        callable,
        args,
        callLocation,
        functionName,
        internal
      );
    }

    invokeFnCallable(
      callable: RuntimeCallable | ApplicationCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName?: string
    ): Promise<RillValue> {
      return invokeFnCallable(
        this as unknown as EvalState,
        callable,
        args,
        callLocation,
        functionName
      );
    }

    createCallableContext(callable: ScriptCallable): RuntimeContext {
      return createCallableContext(this as unknown as EvalState, callable);
    }

    validateParamType(
      param: RillParam,
      value: RillValue,
      callLocation?: SourceLocation
    ): void {
      return validateParamType(
        this as unknown as EvalState,
        param,
        value,
        callLocation
      );
    }

    evaluateYield(
      value: RillValue,
      location?: SourceLocation
    ): never | Promise<void> {
      return evaluateYield(this as unknown as EvalState, value, location);
    }

    invokeScriptCallable(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      return invokeScriptCallable(
        this as unknown as EvalState,
        callable,
        args,
        callLocation
      );
    }

    invokeRegularScriptCallable(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      return invokeRegularScriptCallable(
        this as unknown as EvalState,
        callable,
        args,
        callLocation
      );
    }

    invokeStream(stream: RillStream): Promise<RillValue> {
      return invokeStream(this as unknown as EvalState, stream);
    }

    evaluateHostCall(
      node: HostCallNode,
      inPipeTarget = false
    ): Promise<RillValue> {
      return evaluateHostCall(this as unknown as EvalState, node, inPipeTarget);
    }

    evaluateHostRef(node: HostRefNode): Promise<RillValue> {
      return evaluateHostRef(this as unknown as EvalState, node);
    }

    evaluateClosureCall(node: ClosureCallNode): Promise<RillValue> {
      return evaluateClosureCall(this as unknown as EvalState, node);
    }

    evaluateClosureCallWithPipe(
      node: ClosureCallNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      return evaluateClosureCallWithPipe(
        this as unknown as EvalState,
        node,
        pipeInput
      );
    }

    evaluatePipePropertyAccess(
      node: VariableNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      return evaluatePipePropertyAccess(
        this as unknown as EvalState,
        node,
        pipeInput
      );
    }

    evaluateVariableInvoke(
      node: PipeInvokeNode,
      _pipeInput: RillValue
    ): Promise<RillValue> {
      return evaluateVariableInvoke(
        this as unknown as EvalState,
        node,
        _pipeInput
      );
    }

    evaluatePipeInvoke(
      node: PipeInvokeNode,
      input: RillValue
    ): Promise<RillValue> {
      return evaluatePipeInvoke(this as unknown as EvalState, node, input);
    }

    evaluateMethod(
      node: MethodCallNode | InvokeNode,
      receiver: RillValue
    ): Promise<RillValue> {
      return evaluateMethod(this as unknown as EvalState, node, receiver);
    }

    evaluateInvoke(node: InvokeNode, receiver: RillValue): Promise<RillValue> {
      return evaluateInvoke(this as unknown as EvalState, node, receiver);
    }

    evaluateAnnotationAccess(
      value: RillValue,
      key: string,
      location: SourceLocation | undefined
    ): Promise<RillValue> {
      return evaluateAnnotationAccess(
        this as unknown as EvalState,
        value,
        key,
        location
      );
    }

    evaluateParamsProperty(
      callable: RillValue,
      location: SourceLocation | undefined
    ): Promise<Record<string, RillValue>> {
      return evaluateParamsProperty(
        this as unknown as EvalState,
        callable,
        location
      );
    }
  };
}

/**
 * Capability fragment: methods contributed by ClosuresMixin that are called from
 * other mixin files. These are the public-signature declarations used as the
 * structural cast target in EvaluatorInterface.
 *
 * TypeScript `protected` is a class modifier; type aliases use plain method
 * signatures. The cast target works because `this` inside a mixin class already
 * has access to its own protected members.
 */
export type ClosuresMixinCapability = {
  /** Active stream channel; set during stream closure body execution. */
  activeStreamChannel:
    | (StreamChannel & { readonly resolution: RillValue })
    | null;
  /** Expected chunk type for the active stream closure; null when not streaming. */
  activeStreamChunkType: TypeStructure | null;
  /** Invocation strategy; dispatches to invokeScriptCallable or invokeFnCallable. */
  invocationStrategy: CallableInvocationStrategy;
  createCallableContext(callable: ScriptCallable): RuntimeContext;
  invokeCallable(
    callable: RillCallable,
    args: RillValue[],
    callLocation?: SourceLocation,
    functionName?: string,
    internal?: boolean
  ): Promise<RillValue>;
  evaluateHostCall(
    node: HostCallNode,
    inPipeTarget?: boolean
  ): Promise<RillValue>;
  evaluateHostRef(node: HostRefNode): Promise<RillValue>;
  evaluateClosureCall(node: ClosureCallNode): Promise<RillValue>;
  evaluateClosureCallWithPipe(
    node: ClosureCallNode,
    pipeInput: RillValue
  ): Promise<RillValue>;
  evaluatePipePropertyAccess(
    node: VariableNode,
    pipeInput: RillValue
  ): Promise<RillValue>;
  evaluatePipeInvoke(
    node: PipeInvokeNode,
    input: RillValue
  ): Promise<RillValue>;
  evaluateMethod(
    node: MethodCallNode | InvokeNode,
    receiver: RillValue
  ): Promise<RillValue>;
  evaluateAnnotationAccess(
    value: RillValue,
    key: string,
    location: SourceLocation | undefined
  ): Promise<RillValue>;
  evaluateParamsProperty(
    callable: RillValue,
    location: SourceLocation | undefined
  ): Promise<Record<string, RillValue>>;
  evaluateYield(
    value: RillValue,
    location?: SourceLocation
  ): never | Promise<void>;
};
