/**
 * Closure, host function, method, and invocation evaluation.
 * @internal
 */

import type {
  SourceLocation,
  SourceSpan,
  ExpressionNode,
  SpreadArgNode,
  BlockNode,
} from '../../../../types.js';
import { RillError, RuntimeError } from '../../../../types.js';
import type {
  RillCallable,
  ScriptCallable,
  RuntimeCallable,
  ApplicationCallable,
} from '../../callable.js';
import {
  isCallable,
  isApplicationCallable,
  marshalArgs,
  validateHostResult,
} from '../../callable.js';
import { markExtensionThrow } from '../../extension-throw.js';
import type { RuntimeContext } from '../../types/runtime.js';
import type { RillValue, RillStream } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isStream } from '../../types/guards.js';
import { structureMatches, formatStructure } from '../../types/operations.js';
import { ControlSignal, YieldSignal } from '../../signals.js';
import type { EvalState } from '../state.js';
import { haltSlowPath } from './access.js';
import {
  STATUS_SYM,
  appendTraceFrame,
  getStatus,
  type RillStatus,
} from '../../types/status.js';
import {
  ArgumentsBinder,
  CallableInvocationStrategy,
  activeStreamContexts,
} from '../invocation/index.js';
import type { BoundArguments } from '../invocation/index.js';
import type { InvocationCaller } from '../invocation/callable-strategy.js';
import {
  throwTypeHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
  makeUnhandledHostThrowInvalid,
  fillHostShape,
  RuntimeHaltSignal,
} from '../../types/halt.js';
import { createTraceFrame, TRACE_KINDS } from '../../types/trace.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  getFilterResolver,
  getInFlightTransforms,
  inheritPolicyState,
} from '../../policy/registry.js';
import { applyTransforms } from '../../policy/transforms.js';
import {
  getExtensionIdentity,
  propagateExtensionIdentity,
} from '../../policy/identity.js';
import type { DispatchContext } from '../../types/runtime.js';
import { checkAborted, DEFAULT_MAX_ITERATIONS } from '../shared.js';
import { evaluateExpression } from './core.js';
import { evaluateBodyExpression } from './control-flow.js';
import { assertType } from './types.js';
import {
  trackStream,
  invokeStreamClosure,
} from '../invocation/stream-closures.js';

// ============================================================
// CLOSURE-SKIPPING PIPE-RULE SCANNER
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
 * Implements the unified pipe-rule scanner.
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
export function hasTopLevelDollarInAST(
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
export function formatCallSite(
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
export const argumentsBinder = new ArgumentsBinder();

/**
 * Get or create the cached invocation strategy for an EvalState. Closes over
 * `s` (not `this`) so ctx is always read from the owning evaluator's current
 * state, including reassignment during nested script-callable execution.
 * Cached on `s.invocationStrategy` to avoid reallocating the strategy plus
 * its two closures on every call-site invocation.
 */
function getInvocationStrategy(s: EvalState): CallableInvocationStrategy {
  if (s.invocationStrategy) return s.invocationStrategy;
  const strategy = new CallableInvocationStrategy(
    () => s.ctx,
    argumentsBinder,
    (async (
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
    }) as InvocationCaller
  );
  s.invocationStrategy = strategy;
  return strategy;
}

/**
 * Bind spread-containing call-site arguments to a callable's parameter list,
 * in parameter-declaration order. Wraps `argumentsBinder.bind` and the
 * subsequent `params.map(p => bound.params.get(p.name))` projection shared by
 * every spread-binding call site. `undefined` holes are preserved rather than
 * asserted away: `marshalArgs` (see callable.ts) already treats a missing
 * positional value as "use default".
 */
export async function bindOrdered(
  s: EvalState,
  callable: RillCallable,
  node: { args: (ExpressionNode | SpreadArgNode)[]; span: SourceSpan },
  pipeInput: RillValue | undefined
): Promise<(RillValue | undefined)[]> {
  const bound = await argumentsBinder.bind(
    node.args,
    callable,
    pipeInput,
    (expr) => evaluateExpression(s, expr),
    node.span.start,
    s.ctx.sourceId
  );
  return callable.params!.map((p) => bound.params.get(p.name));
}

/** Evaluate argument expressions, preserving the current pipeValue. */
export async function evaluateArgs(
  s: EvalState,
  argExprs: (ExpressionNode | SpreadArgNode)[]
): Promise<RillValue[]> {
  const savedPipeValue = s.ctx.pipeValue;
  const args: RillValue[] = [];
  const sourceId = s.ctx.sourceId;
  try {
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
        gated = haltSlowPath(
          evaluated,
          isSpread ? '...' : 'arg',
          expr,
          sourceId
        );
      } else {
        gated = evaluated;
      }
      args.push(gated);
    }
    return args;
  } finally {
    // Restore pipeValue on every exit path. When an argument expression
    // throws (e.g. a nested pipe chain halts before a surrounding `??`),
    // the intermediate value must not be left leaked in ctx.pipeValue.
    s.ctx.pipeValue = savedPipeValue;
  }
}

/** Dispatch by kind, without frame enrichment. */
async function dispatchByKind(
  s: EvalState,
  callable: RillCallable,
  args: (RillValue | undefined)[],
  callLocation?: SourceLocation,
  functionName?: string
): Promise<RillValue> {
  return callable.kind === 'script'
    ? invokeScriptCallable(s, callable, args, callLocation)
    : invokeFnCallable(s, callable, args, callLocation, functionName);
}

/**
 * Invoke any callable; dispatches by kind.
 *
 * All four call syntaxes (`$obj.method()`, `hostCall()`, `ns::name`,
 * `receiver.method`) funnel here, which is why the policy filter runs at
 * this one site: filtering anywhere else would leave the other syntaxes
 * unsanitized.
 *
 * `internal: true` skips both the filter and frame enrichment. It is how
 * policy transforms are dispatched, so a transform is not itself
 * re-filtered on the way in.
 *
 * When a filter resolver is configured and the callable carries an
 * extension identity, callables reachable from the (post-out()) result
 * inherit that identity, so a method returning a sub-client stays inside
 * policy. This keys on identity, not on a non-null filter: a policed
 * extension with no rule for the method resolves to a null filter yet its
 * results must still be branded.
 */
export async function invokeCallable(
  s: EvalState,
  callable: RillCallable,
  args: (RillValue | undefined)[],
  callLocation?: SourceLocation,
  functionName?: string,
  internal?: boolean
): Promise<RillValue> {
  checkAborted(s);

  s.ctx.callDepth.value++;
  const inFlight = s.ctx.callsInFlight;
  inFlight.value++;

  try {
    if (s.ctx.callDepth.value > s.ctx.maxCallDepth) {
      throwFatalHostHalt(
        {
          location: callLocation,
          sourceId: s.ctx.sourceId,
          fn: 'invokeCallable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        `Call depth exceeded ${s.ctx.maxCallDepth}`,
        { limit: s.ctx.maxCallDepth, depth: s.ctx.callDepth.value }
      );
    }

    // Concurrent branches fork callDepth, so depth alone cannot bound the
    // calls alive at once. The in-flight cell is shared run-wide and latches
    // so every sibling still unwinding also halts, until the count drains.
    const inFlightCeiling = s.ctx.maxCallDepth + DEFAULT_MAX_ITERATIONS;
    if (inFlight.tripped || inFlight.value > inFlightCeiling) {
      inFlight.tripped = true;
      throwFatalHostHalt(
        {
          location: callLocation,
          sourceId: s.ctx.sourceId,
          fn: 'invokeCallable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        `Calls in flight exceeded ${inFlightCeiling}`,
        {
          limit: inFlightCeiling,
          inFlight: inFlight.value,
          maxCallDepth: s.ctx.maxCallDepth,
        }
      );
    }

    // Yield one microtask so every call level resumes on a fresh native
    // stack. A recursion path with no suspension point between levels (a
    // dict-bound property closure re-reading its own field, for one) would
    // otherwise grow the JS stack in lockstep with call depth and overflow
    // with a raw RangeError before the depth ceiling above can fire.
    await Promise.resolve();

    if (internal === true) {
      const internalResult = await dispatchByKind(
        s,
        callable,
        args,
        callLocation,
        functionName
      );
      if (isStream(internalResult)) {
        trackStream(s, internalResult as RillStream);
      }
      return internalResult;
    }

    // `functionName` carries the resolved path and is passed for diagnostics
    // only. The resolver keys on the callable's own identity — see
    // core/policy/identity.ts.
    const resolver = getFilterResolver(s.ctx);
    const filter = resolver?.(callable, functionName, s.ctx) ?? null;

    const haltSite = {
      location: callLocation,
      sourceId: s.ctx.sourceId,
      fn: 'invokeCallable',
    };

    let effectiveArgs = args;
    if (filter !== null) {
      if (filter.access === 'deny') {
        const path = functionName ?? 'callable';
        throwCatchableHostHalt(
          haltSite,
          ERROR_ATOMS[ERROR_IDS.RILL_R088],
          `Call to ${path} denied by policy`,
          { path }
        );
      }

      // in() rewrites the first argument. That is where a piped value
      // lands, but it is deliberately not restricted to piped calls:
      // $kb.search("q") must be sanitized the same as "q" -> $kb.search(),
      // or dropping the pipe is a one-edit bypass. A zero-argument call
      // has no first argument, and synthesizing one would change arity.
      if (filter.inTransforms.length > 0 && args.length > 0) {
        const piped = await applyTransforms(
          filter.inTransforms,
          args[0] as RillValue,
          (transform, value) =>
            invokeCallable(
              s,
              transform,
              [value],
              callLocation,
              undefined,
              true
            ),
          getInFlightTransforms(s.ctx),
          haltSite
        );
        effectiveArgs = [piped, ...args.slice(1)];
      }
    }

    let result: RillValue;
    if (callLocation) {
      // Route through invocationStrategy.invoke — single frame-enrichment site.
      // BoundArguments.params (arguments-binder.ts) is out of scope for the
      // (RillValue | undefined)[] threading; the cast lands at this boundary.
      const bound: BoundArguments = {
        params: new Map(
          (effectiveArgs as RillValue[]).map((v, i) => [String(i), v])
        ),
      };
      result = await getInvocationStrategy(s).invoke(
        callable,
        bound,
        callLocation,
        functionName
      );
    } else {
      // No call-site location: dispatch directly without a frame.
      result = await dispatchByKind(
        s,
        callable,
        effectiveArgs,
        callLocation,
        functionName
      );
    }

    // out() runs before trackStream so the tracked value is the transformed
    // one, not the raw return the transform was meant to replace.
    if (filter !== null && filter.outTransforms.length > 0) {
      result = await applyTransforms(
        filter.outTransforms,
        result,
        (transform, value) =>
          invokeCallable(s, transform, [value], callLocation, undefined, true),
        getInFlightTransforms(s.ctx),
        haltSite
      );
    }

    if (resolver !== undefined) {
      const identity = getExtensionIdentity(callable);
      // The skip trusts the resolver's extension-level answer.
      if (
        identity !== undefined &&
        resolver.policesExtension?.(identity.extension) !== false
      ) {
        propagateExtensionIdentity(
          callable,
          result,
          createHostRegisteredCheck(s.ctx)
        );
      }
    }

    if (isStream(result)) {
      trackStream(s, result as RillStream);
    }
    return result;
  } finally {
    s.ctx.callDepth.value--;
    inFlight.value--;
    if (inFlight.value === 0) inFlight.tripped = false;
  }
}

/**
 * Set of registered function values per function table. Keyed on the table,
 * which child contexts share, so it is built once per root context and
 * rebuilt only if the table's size changes.
 */
const hostFunctionTables = new WeakMap<
  object,
  { size: number; table: Set<unknown> }
>();

/** Predicate for callables the host registered directly as `functions`. */
function createHostRegisteredCheck(
  ctx: DispatchContext
): (callable: RillCallable) => boolean {
  return (callable) => {
    let cached = hostFunctionTables.get(ctx.functions);
    if (cached === undefined || cached.size !== ctx.functions.size) {
      cached = {
        size: ctx.functions.size,
        table: new Set(ctx.functions.values()),
      };
      hostFunctionTables.set(ctx.functions, cached);
    }
    return cached.table.has(callable);
  };
}

/** Invoke runtime or application callable (native function). */
async function invokeFnCallable(
  s: EvalState,
  callable: RuntimeCallable | ApplicationCallable,
  args: (RillValue | undefined)[],
  callLocation?: SourceLocation,
  functionName = 'callable'
): Promise<RillValue> {
  if (s.ctx.isDisposed()) {
    return s.ctx.createDisposedResult();
  }

  // Inject the bound dict as the sole receiver argument only for
  // property/receiver-style callables (`isProperty`). Every callable stored
  // in a dict gets a `boundDict` (bindDictCallables in types/runtime.ts), but
  // a plain zero-param application callable must still be called with zero
  // args — otherwise `$d.fn()` on a `params: []` callable would pass 1 arg
  // (RILL-R045) and a defaults-only callable would take the dict as its first
  // param (RILL-R001). The `isProperty` flag is the receiver contract locked
  // by tests/runtime/host-integration.test.ts.
  const effectiveArgs =
    callable.boundDict && callable.isProperty && args.length === 0
      ? [callable.boundDict]
      : args;

  let fnArgs: Record<string, RillValue>;
  if (isApplicationCallable(callable) && callable.params !== undefined) {
    // marshalArgs (callable.ts) is out of scope for the (RillValue |
    // undefined)[] threading; the cast lands at this boundary.
    fnArgs = marshalArgs(effectiveArgs as RillValue[], callable.params, {
      functionName,
      location: callLocation,
    });
  } else {
    fnArgs = effectiveArgs as unknown as Record<string, RillValue>;
  }

  let result: RillValue;
  try {
    // Sync host-fn throws and rejected dispatch promises must reach the same
    // catch: the raw builder call, the Promise wrapping, and the inflight
    // tracking all live inside this try so a synchronous host throw enters
    // the same enrichment/reshape path as an async rejection.
    const raw = callable.fn(fnArgs, s.ctx, callLocation);
    const dispatchPromise = raw instanceof Promise ? raw : Promise.resolve(raw);
    s.ctx.trackInflight(dispatchPromise);
    result = await dispatchPromise;
    validateHostResult(result, functionName, callLocation);
  } catch (e) {
    // Enrichment site 1: extension-dispatch boundary.
    return reshapeHostThrow(e, callLocation, s.ctx.sourceId, functionName);
  }

  return result;
}

/**
 * Reshape a throw from a native function dispatch host boundary into the
 * shared `#R999` invalid value, or re-throw per the host-boundary contract.
 * Tags every thrown value as extension-originated first, then either
 * enriches a `RuntimeHaltSignal` or an unmigrated location-less
 * `RuntimeError` with call-site metadata, lets every other `RillError` and
 * every `ControlSignal` propagate unconverted, and materializes anything
 * else (a raw `Error`, a non-object throw) as a `#R999` invalid so it never
 * escapes `execute()` raw. A stream's `resolve()` throw is not passed
 * through this function; it propagates unreshaped from `invokeStream`.
 */
function reshapeHostThrow(
  e: unknown,
  callLocation: SourceLocation | undefined,
  sourceId: string | undefined,
  functionName: string
): RillValue {
  markExtensionThrow(e);

  // Control-flow signals (break/return/yield) are not halts; re-throw
  // uniformly via the ControlSignal base class so every subclass —
  // including future ones — passes through unconverted.
  if (e instanceof ControlSignal) {
    throw e;
  }

  if (e instanceof RuntimeHaltSignal) {
    // Genuine host-fn dispatch boundary: `callable.fn` is the native
    // function object registered by the host/extension, so `host` is the
    // correct origin kind here.
    const enriched = appendTraceFrame(
      fillHostShape(e.value, { location: callLocation }),
      createTraceFrame({
        site: formatCallSite(callLocation, sourceId),
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
    // oxlint-disable-next-line rill/no-new-runtime-error -- re-wraps an extension-thrown RuntimeError with the call-site location; the extension chose the class
    const enriched = new RuntimeError(
      e.errorId,
      e.toData().message,
      callLocation,
      e.context ? { ...e.context } : undefined,
      span,
      e.sourceId
    );
    markExtensionThrow(enriched);
    throw enriched;
  }

  // Any other RillError (a RuntimeError that already carries a location,
  // TimeoutError, ParseError, LexerError) carries its own halt contract;
  // propagate unchanged.
  if (e instanceof RillError) {
    throw e;
  }

  // Everything else — a non-RillError `Error` thrown synchronously or via
  // a rejected dispatch promise, or a non-object throw (`throw null`,
  // `throw "str"`) that `markExtensionThrow`'s WeakSet cannot tag —
  // materializes here as a `#R999` invalid value instead of escaping
  // raw. Returned (not thrown) so the call resolves normally, matching
  // the reshape-by-value contract at the script's top-level boundary.
  return makeUnhandledHostThrowInvalid(
    {
      location: callLocation,
      sourceId,
      fn: functionName,
    },
    e
  );
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
  // This context is spread from the caller's rather than built by
  // createChildContext, so it gets no policy binding from there. Without
  // this, every call made from inside a closure body would dispatch
  // unfiltered, and seq/fan/filter/fold bodies all run through here.
  inheritPolicyState(s.ctx, callableCtx);
  return callableCtx;
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
  while (searchCtx !== undefined) {
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

/** Invoke script callable; dispatches stream closures to stream-closures.ts. */
export async function invokeScriptCallable(
  s: EvalState,
  callable: ScriptCallable,
  args: (RillValue | undefined)[],
  callLocation?: SourceLocation
): Promise<RillValue> {
  if (callable.returnType.structure.kind === 'stream') {
    // invokeStreamClosure (invocation/stream-closures.ts) is out of scope
    // for the (RillValue | undefined)[] threading; the cast lands here.
    return invokeStreamClosure(s, callable, args as RillValue[], callLocation);
  }
  return invokeRegularScriptCallable(s, callable, args, callLocation);
}

async function invokeRegularScriptCallable(
  s: EvalState,
  callable: ScriptCallable,
  args: (RillValue | undefined)[],
  callLocation?: SourceLocation
): Promise<RillValue> {
  const callableCtx = createCallableContext(s, callable);

  const params = callable.params;
  if (
    params.length === 1 &&
    args.length === 1 &&
    args[0] !== undefined &&
    params[0]!.type === undefined
  ) {
    const only = params[0]!;
    callableCtx.variables.set(only.name, args[0]!);
    if (only.name === '$') {
      callableCtx.pipeValue = args[0]!;
    }
  } else {
    // marshalArgs (callable.ts) is out of scope for the (RillValue |
    // undefined)[] threading; the cast lands at this boundary.
    const record = marshalArgs(args as RillValue[], params, {
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
    // Enrichment site 2: script-callable boundary.
    // Tag every thrown value as extension-originated first, then enrich
    // RuntimeHaltSignal payloads with a trace frame recording this call
    // boundary. `evaluateBodyExpression` here runs a script-authored
    // closure body, not a host/extension function, so the origin is
    // `access` (the existing kind used elsewhere for propagating a halt
    // across a non-host runtime boundary, e.g. `protocols/shared.ts`'s
    // `haltOnNestedInvalid`) rather than `host`.
    markExtensionThrow(e);
    if (e instanceof RuntimeHaltSignal) {
      const enriched = appendTraceFrame(
        fillHostShape(e.value, {
          sourceId: callableCtx.sourceId,
          // sourceText travels with sourceId: filled together or not at all.
          contextExtras:
            callableCtx.sourceId && callableCtx.sourceText
              ? { sourceText: callableCtx.sourceText }
              : undefined,
        }),
        createTraceFrame({
          site: formatCallSite(callLocation, callableCtx.sourceId),
          kind: TRACE_KINDS.ACCESS,
          fn: 'invokeRegularScriptCallable',
        })
      );
      const newSignal = new RuntimeHaltSignal(enriched, e.catchable);
      markExtensionThrow(newSignal);
      throw newSignal;
    }
    // Restore sourceId on RillError instances that escaped without one.
    // RuntimeError throws that bypass the halt builders still need sourceId
    // enriched at this boundary so host callers observe the documented
    // sourceId contract.
    if (e instanceof RillError && !e.sourceId && callableCtx.sourceId) {
      // Enrich on a fresh clone; never mutate the caught error's context in
      // place. That object may be shared with a rewrapped copy, so an
      // in-place `e.context` mutation would bleed sourceText across errors.
      const enriched = e.withContext(
        callableCtx.sourceText ? { sourceText: callableCtx.sourceText } : {}
      );
      // The clone is fresh and unshared, so setting sourceId on it is safe.
      (enriched as { sourceId: string }).sourceId = callableCtx.sourceId;
      throw enriched;
    }
    throw e;
  } finally {
    s.ctx = savedCtx;
  }
}

/** Drain stream and return its resolution value. */
export async function invokeStream(
  s: EvalState,
  stream: RillStream,
  callLocation?: SourceLocation
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
    } catch (err) {
      // The one designated clean-end signal: `createRillStream`'s `next`
      // marks its context `{ alreadyConsumed: true }` when this exact
      // reference (or a stale prior step of it) was already driven to
      // completion by an earlier call - e.g. invoking `$s()` a second time,
      // or invoking it after `take`/`skip` already advanced the same
      // binding. That is idempotent, not a failure: fall through to
      // resolveFn() below. Every other throw - halts, control-flow signals
      // (break/return/yield), and ordinary JS errors from a buggy `.next`
      // callable (e.g. an extension bug) - is a genuine failure and
      // propagates rather than being swallowed as a silent stream end.
      if (
        err instanceof RillError &&
        err.context?.['alreadyConsumed'] === true
      ) {
        break;
      }
      // The same marker on a halt's status raw bag ends the stream cleanly.
      if (
        err instanceof RuntimeHaltSignal &&
        getStatus(err.value).raw['alreadyConsumed'] === true
      ) {
        break;
      }
      throw err;
    }
  }

  // A throw from `resolve()` itself is NOT reshaped here: it propagates as
  // a raw rejection exactly as before this validation was added (locked
  // by the streams language spec). Only the RESOLVED VALUE is validated
  // below — a resolve() that returns raw null/undefined/a
  // non-representable value must halt (RILL-R085) rather than leak into
  // `$s()`/`.len`.
  const resolution = await resolveFn();
  validateHostResult(resolution, 'stream.resolve', callLocation);
  return resolution;
}

// Moved evaluators stay importable from this module.
export {
  evaluateHostCall,
  evaluateHostRef,
  evaluateClosureCall,
  evaluateClosureCallWithPipe,
  evaluatePipeInvoke,
} from './calls.js';
export {
  evaluateMethod,
  evaluateAnnotationAccess,
  evaluateParamsProperty,
} from './methods.js';
