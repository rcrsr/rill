/**
 * ClosuresMixin: Closure and Method Invocation
 *
 * Handles all callable operations:
 * - Host function calls
 * - Closure calls (script callables)
 * - Method calls on values
 * - Invoke operations
 * - Pipe invocations
 * - Property access on piped values
 *
 * Interface requirements (from spec):
 * - invokeCallable(callable, args, location) -> Promise<RillValue>
 * - evaluateHostCall(node) -> Promise<RillValue>
 * - evaluateClosureCall(node) -> Promise<RillValue>
 * - evaluateClosureCallWithPipe(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipePropertyAccess(node, pipeInput) -> Promise<RillValue>
 * - evaluateVariableInvoke(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipeInvoke(node, input) -> Promise<RillValue>
 * - evaluateMethod(node, receiver) -> Promise<RillValue>
 * - evaluateInvoke(node, receiver) -> Promise<RillValue>
 *
 * Helper methods (protected):
 * - validateParamType(param, value, location) -> void
 *
 * Error Handling:
 * - Undefined functions throw RuntimeError(RUNTIME_UNDEFINED_FUNCTION) [EC-18]
 * - Undefined methods throw RuntimeError(RUNTIME_UNDEFINED_METHOD) [EC-19]
 * - Parameter type mismatches throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-20]
 * - Async operations timeout per TimeoutError [EC-21]
 *
 * ## Implementation Notes
 *
 * [ASSUMPTION] Excess argument validation occurs before default application to fail fast
 * on arity mismatches, improving error messages. This matches the algorithm order in the
 * spec where excess check happens first.
 *
 * [ASSUMPTION] boundDict substitution happens before validation for property-style
 * callables to ensure type checks apply to the effective arguments (including bound dict).
 * This prevents validation bypass when property-style callables are accessed.
 *
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
import {
  getVariable,
  pushCallFrame,
  popCallFrame,
  UNVALIDATED_METHOD_PARAMS,
} from '../../context.js';
import { markExtensionThrow } from '../../extension-throw.js';
import type { RuntimeContext } from '../../types/runtime.js';
import type {
  RillValue,
  RillTypeValue,
  RillStream,
  TypeStructure,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import {
  isTypeValue,
  isTuple,
  isOrdered,
  isStream,
} from '../../types/guards.js';
import {
  paramToFieldDef,
  inferStructure,
  structureMatches,
  formatStructure,
} from '../../types/operations.js';
import { createRillStream } from '../../types/constructors.js';
import { anyTypeValue, structureToTypeValue } from '../../values.js';
import { YieldSignal, ReturnSignal } from '../../signals.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { CallFrame } from '../../../../types.js';
import { haltSlowPath } from './access.js';
import { STATUS_SYM, type RillStatus } from '../../types/status.js';
import { throwTypeHalt } from '../../types/halt.js';

/**
 * Result of bindArgsToParams: parameter names mapped to evaluated values.
 *
 * Only explicitly bound parameters are present (positional, tuple, ordered,
 * or dict spread). Missing parameters are absent from the map; callers pass
 * undefined for them, and marshalArgs handles defaults and required checks.
 *
 * Phase 2 integration: callers convert this to a positional RillValue[] via
 *   params.map(p => bound.params.get(p.name)!)
 * and pass that to marshalArgs stages 2-3 (skipping stage 1 excess check,
 * which bindArgsToParams handles differently via per-source arity validation).
 *
 * @internal
 */
interface BoundArgs {
  readonly params: Map<string, RillValue>;
}

/**
 * ClosuresMixin implementation.
 *
 * Evaluates callable operations: host functions, closures, methods, invocations.
 * Handles parameter binding, type checking, and callable contexts.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation(), withTimeout()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluateBodyExpression() (from ControlFlowMixin)
 *
 * Methods added:
 * - invokeCallable(callable, args, location) -> Promise<RillValue>
 * - evaluateHostCall(node) -> Promise<RillValue>
 * - evaluateClosureCall(node) -> Promise<RillValue>
 * - evaluateClosureCallWithPipe(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipePropertyAccess(node, pipeInput) -> Promise<RillValue>
 * - evaluateVariableInvoke(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipeInvoke(node, input) -> Promise<RillValue>
 * - evaluateMethod(node, receiver) -> Promise<RillValue>
 * - evaluateInvoke(node, receiver) -> Promise<RillValue>
 * - evaluateArgs(argExprs) -> Promise<RillValue[]> (helper)
 * - invokeFnCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - invokeScriptCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - createCallableContext(callable) -> RuntimeContext (helper)
 * - validateParamType(param, value, location) -> void (helper)
 * - bindArgsToParams(argNodes, callable, callLocation) -> Promise<BoundArgs> (helper)
 */
/**
 * Rendezvous channel for stream closure body ↔ async generator communication.
 * The body pushes yielded values; the generator pulls them one at a time.
 * Backpressure: push() blocks until the consumer calls pull().
 *
 * @internal
 */
interface StreamChannel {
  /** Push a yielded chunk value. Blocks until consumer pulls. */
  push(value: RillValue): Promise<void>;
  /** Pull the next chunk. Returns done:true when body completes. */
  pull(): Promise<
    { value: RillValue; done: false } | { value?: undefined; done: true }
  >;
  /** Signal body completion with a resolution value. */
  close(resolution: RillValue): void;
  /** Signal body failure with an error. */
  error(err: unknown): void;
}

/**
 * Create a rendezvous channel for stream chunk handoff.
 *
 * Producer (body) calls push() which blocks until consumer calls pull().
 * Consumer (async generator) calls pull() which blocks until producer pushes.
 * close() and error() signal body termination.
 *
 * @internal
 */
function createStreamChannel(): StreamChannel {
  // Pending chunk waiting for consumer
  let pendingChunk:
    | {
        value: RillValue;
        resume: () => void;
      }
    | undefined;

  // Consumer waiting for a chunk
  let pendingPull:
    | {
        resolve: (
          result:
            | { value: RillValue; done: false }
            | { value?: undefined; done: true }
        ) => void;
        reject: (err: unknown) => void;
      }
    | undefined;

  // Terminal state
  let closed = false;
  let closedResolution: RillValue | undefined;
  let closedError: unknown | undefined;

  return {
    async push(value: RillValue): Promise<void> {
      if (closed) return;

      // If consumer is already waiting, deliver immediately
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ value, done: false });
        return;
      }

      // Otherwise, wait for consumer to pull
      return new Promise<void>((resolve) => {
        pendingChunk = { value, resume: resolve };
      });
    },

    async pull() {
      // If there's a pending chunk from the producer, consume it
      if (pendingChunk) {
        const chunk = pendingChunk;
        pendingChunk = undefined;
        chunk.resume(); // unblock producer
        return { value: chunk.value, done: false as const };
      }

      // If body already completed, return done
      if (closed) {
        if (closedError !== undefined) throw closedError;
        return { done: true as const };
      }

      // Wait for producer to push
      return new Promise<
        { value: RillValue; done: false } | { value?: undefined; done: true }
      >((resolve, reject) => {
        pendingPull = { resolve, reject };
      });
    },

    close(_resolution: RillValue): void {
      closed = true;
      closedResolution = _resolution;
      // Wake up waiting consumer
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ done: true });
      }
    },

    error(err: unknown): void {
      closed = true;
      closedError = err;
      // Wake up waiting consumer with error
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.reject(err);
      }
    },

    /** Access cached resolution value after close(). */
    get resolution(): RillValue {
      return closedResolution ?? null;
    },
  } as StreamChannel & { readonly resolution: RillValue };
}

function createClosuresMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ClosuresEvaluator extends Base {
    /**
     * Active stream channel for the current stream closure body execution.
     * Set during stream closure body execution; null otherwise.
     * Used by evaluateYield to push chunks to the async generator.
     */
    private activeStreamChannel:
      | (StreamChannel & { readonly resolution: RillValue })
      | null = null;

    /**
     * Expected chunk type for the active stream closure.
     * Set during stream closure body execution; null otherwise.
     * Used by evaluateYield for chunk type validation (FR-STREAM-10).
     */
    private activeStreamChunkType: TypeStructure | null = null;

    /**
     * Stack of active stream lists for IR-14 scope exit cleanup.
     * Each entry represents a scope boundary. Streams are tracked in
     * creation order; disposed in reverse order on scope exit.
     */
    private streamScopeStack: RillStream[][] = [];

    /**
     * Track a stream in the current scope for cleanup on scope exit (IR-14).
     * Streams with dispose functions get cleaned up when their scope exits.
     */
    protected trackStream(stream: RillStream): void {
      const current = this.streamScopeStack[this.streamScopeStack.length - 1];
      if (current) {
        current.push(stream);
      }
    }

    /**
     * Dispose a list of unconsumed streams in reverse creation order (IR-14).
     * Propagates dispose errors as RILL-R002 — does not swallow.
     */
    private async disposeStreams(streams: RillStream[]): Promise<void> {
      for (let i = streams.length - 1; i >= 0; i--) {
        const stream = streams[i]!;
        // Only dispose streams that are not fully consumed
        if (stream.done) continue;
        const disposeFn = (
          stream as unknown as Record<string, (() => void) | undefined>
        )['__rill_stream_dispose'];
        if (typeof disposeFn === 'function') {
          try {
            disposeFn();
          } catch (err) {
            // Propagate dispose errors — do not swallow (IR-14)
            if (err instanceof RuntimeError) throw err;
            throw new RuntimeError(
              'RILL-R002',
              err instanceof Error ? err.message : String(err)
            );
          }
        }
      }
    }

    /**
     * Wrap evaluateBlock to add scope exit cleanup for streams (IR-14).
     * Pushes a scope boundary, runs the block, then disposes unconsumed streams.
     */
    protected async evaluateBlock(node: BlockNode): Promise<RillValue> {
      this.streamScopeStack.push([]);
      try {
        // Call the ControlFlowMixin's evaluateBlock via prototype chain
        return await Object.getPrototypeOf(
          ClosuresEvaluator.prototype
        ).evaluateBlock.call(this, node);
      } finally {
        const streams = this.streamScopeStack.pop()!;
        await this.disposeStreams(streams);
      }
    }

    /**
     * Evaluate argument expressions while preserving the current pipeValue.
     * Used by all callable invocations to prepare arguments.
     */
    protected async evaluateArgs(
      argExprs: (ExpressionNode | SpreadArgNode)[]
    ): Promise<RillValue[]> {
      const savedPipeValue = this.ctx.pipeValue;
      const args: RillValue[] = [];
      const sourceId = this.ctx.sourceId;
      for (const arg of argExprs) {
        const isSpread = arg.type === 'SpreadArg';
        const expr = isSpread ? arg.expression : arg;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const evaluated = await (this as any).evaluateExpression(expr);
        // EC-7: access-halt gate at arg / spread site. Passing an invalid
        // value as an argument (or spreading it) accesses that value.
        // RI-5: inline the Symbol-keyed sidecar probe to eliminate the
        // per-arg arrow-closure allocation required by `accessHaltGateFast`
        // (NFR-ERR-1 call-site hot path). Slow path delegates to
        // `haltSlowPath` which reads `expr.span.start` itself.
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
      this.ctx.pipeValue = savedPipeValue;
      return args;
    }

    /**
     * Invoke any callable (host function, script closure, runtime function).
     * Dispatches to appropriate invocation method based on callable kind.
     */
    protected async invokeCallable(
      callable: RillCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName?: string,
      internal?: boolean
    ): Promise<RillValue> {
      this.checkAborted();

      // Fast path (AC-N2, NFR-ERR-1): internal iterator-body invocations bypass
      // CallFrame push/pop and the surrounding try/finally. The frame is not
      // user-recoverable for these sites, so skipping eliminates per-element
      // object allocation plus unwind overhead. Stream tracking is preserved.
      if (internal === true) {
        let result: RillValue;
        if (callable.kind === 'script') {
          result = await this.invokeScriptCallable(
            callable,
            args,
            callLocation
          );
        } else {
          result = await this.invokeFnCallable(
            callable,
            args,
            callLocation,
            functionName
          );
        }

        // IR-14: Track returned streams for scope exit cleanup
        if (isStream(result)) {
          this.trackStream(result as RillStream);
        }

        return result;
      }

      // Push call frame before invocation (IR-2, IC-9)
      // Call stack captures the call site location, not the function body location
      if (callLocation) {
        const name =
          functionName ??
          (callable.kind === 'script' ? '<closure>' : '<callable>');
        const frame: CallFrame = {
          location: {
            start: callLocation,
            end: callLocation,
          },
          functionName: name,
          sourceId: this.ctx.sourceId,
        };
        pushCallFrame(this.ctx, frame);
      }

      try {
        let result: RillValue;
        if (callable.kind === 'script') {
          result = await this.invokeScriptCallable(
            callable,
            args,
            callLocation
          );
        } else {
          result = await this.invokeFnCallable(
            callable,
            args,
            callLocation,
            functionName
          );
        }

        // IR-14: Track returned streams for scope exit cleanup
        if (isStream(result)) {
          this.trackStream(result as RillStream);
        }

        return result;
      } catch (error) {
        // Snapshot call stack onto error before finally pops the frame.
        // First snapshot wins — nested calls capture the deepest stack.
        if (error instanceof RillError && this.ctx.callStack.length > 0) {
          const ctx = error.context as Record<string, unknown> | undefined;
          if (ctx && !ctx['callStack']) {
            ctx['callStack'] = [...this.ctx.callStack];
          } else if (!ctx) {
            // context is readonly on the property, but we can override via cast
            // for errors constructed without a context object
            (error as { context: Record<string, unknown> }).context = {
              callStack: [...this.ctx.callStack],
            };
          }
        }
        throw error;
      } finally {
        // Pop call frame after invocation completes (IR-3)
        // Ensure pop happens even on error paths
        if (callLocation) {
          popCallFrame(this.ctx);
        }
      }
    }

    /**
     * Invoke runtime or application callable (native functions).
     * Handles bound dict for property-style callables.
     * Validates typed ApplicationCallable arguments before invocation.
     */
    protected async invokeFnCallable(
      callable: RuntimeCallable | ApplicationCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName = 'callable'
    ): Promise<RillValue> {
      // AC-E9: Post-dispose gate. Any extension dispatch after `dispose()`
      // short-circuits with `#DISPOSED` rather than invoking user code.
      if (this.ctx.isDisposed()) {
        return this.ctx.createDisposedResult();
      }

      // Apply boundDict BEFORE validation (property-style callables need dict as first arg)
      const effectiveArgs =
        callable.boundDict && args.length === 0 ? [callable.boundDict] : args;

      // Marshal arguments for typed ApplicationCallable (IC-1).
      // Skip when params is undefined (untyped callable() factory).
      // Untyped callables still receive RillValue[] cast as Record to preserve
      // existing runtime behavior without changing the fn contract.
      let fnArgs: Record<string, RillValue>;
      if (isApplicationCallable(callable) && callable.params !== undefined) {
        fnArgs = marshalArgs(effectiveArgs, callable.params, {
          functionName,
          location: callLocation,
        });
      } else {
        fnArgs = effectiveArgs as unknown as Record<string, RillValue>;
      }

      // EC-11: Register the dispatch promise in the lifecycle inflight set
      // so `dispose()` awaits its settlement before flipping the disposed
      // flag. No-op for minimal contexts that never participate in dispose.
      const raw = callable.fn(fnArgs, this.ctx, callLocation);
      const dispatchPromise =
        raw instanceof Promise ? raw : Promise.resolve(raw);
      this.ctx.trackInflight(dispatchPromise);

      try {
        return await dispatchPromise;
      } catch (error) {
        // AC-E4 / EC-6: Tag extension-dispatch throws so the step-level
        // reshape wrapper can distinguish extension-boundary failures
        // (which reshape to `#R999` / `#DISPOSED` invalid values) from
        // internal engine halts (which propagate with existing semantics).
        markExtensionThrow(error);

        if (error instanceof RuntimeError && !error.location && callLocation) {
          // Enrich extension errors with call site location via construction
          const span: SourceSpan = { start: callLocation, end: callLocation };
          const enriched = new RuntimeError(
            error.errorId,
            error.toData().message,
            callLocation,
            error.context,
            span
          );
          markExtensionThrow(enriched);
          throw enriched;
        }
        throw error;
      }
    }

    /**
     * Create callable context for script closure invocation.
     * Sets up parent scope for late-bound variable resolution.
     */
    protected createCallableContext(callable: ScriptCallable): RuntimeContext {
      // Create a child context with the defining scope as parent
      // This enables late-bound variable resolution through the scope chain

      // Determine initial pipeValue:
      // - Zero-param closures (||{ ... }): inherit from caller (for dict dispatch)
      // - Explicit-param closures (|a,b|{ ... }): clear to prevent leakage
      // - boundDict always overrides
      const hasExplicitParams =
        callable.params.length > 0 && callable.params[0]!.name !== '$';

      const defScope = callable.definingScope as RuntimeContext;
      const callableCtx: RuntimeContext = {
        ...this.ctx,
        parent: defScope,
        variables: new Map(),
        variableTypes: new Map(),
        pipeValue: hasExplicitParams ? null : this.ctx.pipeValue,
        sourceId: defScope.sourceId ?? this.ctx.sourceId,
        sourceText: defScope.sourceText ?? this.ctx.sourceText,
      };

      if (callable.boundDict) {
        callableCtx.pipeValue = callable.boundDict;
      }

      return callableCtx;
    }

    /**
     * Validate parameter type against actual value using structural matching.
     * Throws RuntimeError on type mismatch.
     * When param.type is undefined, returns without validation (any-typed).
     */
    protected validateParamType(
      param: RillParam,
      value: RillValue,
      callLocation?: SourceLocation
    ): void {
      if (param.type === undefined) return;

      if (!structureMatches(value, param.type)) {
        const expectedType = formatStructure(param.type);
        const actualType = inferType(value);
        throw new RuntimeError(
          'RILL-R001',
          `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${actualType}`,
          callLocation,
          { paramName: param.name, expectedType, actualType }
        );
      }
    }

    /**
     * Evaluate yield: validate chunk type and throw YieldSignal (IR-6).
     *
     * When inside a stream closure body (activeStreamChannel is set),
     * pushes the value to the stream channel instead of throwing.
     * When no stream channel is active, throws YieldSignal directly
     * (for nested evaluation contexts that catch it).
     *
     * Validates pipe value against declared chunk type at emission (FR-STREAM-10).
     * Throws TYPE_MISMATCH if chunk type does not match declared type.
     */
    protected evaluateYield(
      value: RillValue,
      location?: SourceLocation
    ): never | Promise<void> {
      // Validate chunk type if constrained
      if (this.activeStreamChunkType !== null) {
        if (!structureMatches(value, this.activeStreamChunkType)) {
          const expected = formatStructure(this.activeStreamChunkType);
          const actual = inferType(value);
          throwTypeHalt(
            {
              location,
              sourceId: this.ctx.sourceId,
              fn: 'yield',
            },
            'TYPE_MISMATCH',
            `Yielded value type mismatch: expected ${expected}, got ${actual}`,
            'runtime',
            { expected, actual }
          );
        }
      }

      // Push to stream channel if inside a stream closure body
      if (this.activeStreamChannel) {
        return this.activeStreamChannel.push(value);
      }

      // Fallback: throw YieldSignal (caught by stream body wrapper)
      throw new YieldSignal(value);
    }

    /**
     * Invoke script callable with positional arguments.
     * Handles parameter binding, default values, and type checking.
     *
     * Stream closures (returnType.structure.kind === 'stream') are detected
     * and dispatched to invokeStreamClosure for lazy body execution (IR-13).
     */
    protected async invokeScriptCallable(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      // IR-13: Stream closure detection — dispatch to stream-specific invocation
      if (callable.returnType.structure.kind === 'stream') {
        return this.invokeStreamClosure(callable, args, callLocation);
      }

      return this.invokeRegularScriptCallable(callable, args, callLocation);
    }

    /**
     * Invoke a regular (non-stream) script callable.
     * Extracted from invokeScriptCallable for clarity after stream dispatch.
     */
    private async invokeRegularScriptCallable(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      const callableCtx = this.createCallableContext(callable);

      // Fast path (Task 7.3): single-arg, untyped, plain named param — the
      // dominant map/each/fold/filter iterator-body shape. Skips marshalArgs,
      // its error checks, and the Object.entries allocation that otherwise
      // re-pays per iteration.
      //
      // Excluded (routed through marshalArgs below):
      // - multi-param callables (arity checks, default hydration)
      // - typed params (Stage 2.5 field-default hydration + Stage 3 type check)
      // - arg-count mismatches (excess args or missing required)
      const params = callable.params;
      if (
        params.length === 1 &&
        args.length === 1 &&
        params[0]!.type === undefined
      ) {
        const only = params[0]!;
        callableCtx.variables.set(only.name, args[0]!);
        // IR-4: Block closure pipe sync — first param named '$' means block closure.
        if (only.name === '$') {
          callableCtx.pipeValue = args[0]!;
        }
      } else {
        // Marshal positional args to named record (IC-1).
        // Script callables always have params defined.
        const record = marshalArgs(args, params, {
          functionName: '<anonymous>',
          location: callLocation,
        });

        // Bind each named value into the callable context.
        for (const [name, value] of Object.entries(record)) {
          callableCtx.variables.set(name, value);
        }

        // IR-4: Block closure pipe sync — first param named '$' means block closure.
        // Sync pipeValue so bare '$' references resolve correctly inside the body.
        if (params[0]?.name === '$') {
          callableCtx.pipeValue = record['$']!;
        }
      }

      // EC-1: Reject empty block bodies before execution (AC-17)
      if (
        callable.body.type === 'Block' &&
        (callable.body as BlockNode).statements.length === 0
      ) {
        throw new RuntimeError(
          'RILL-R043',
          'Closure body produced no value',
          callLocation,
          { context: 'Closure body' }
        );
      }

      // Switch context to callable context
      const savedCtx = this.ctx;
      this.ctx = callableCtx;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this as any).evaluateBodyExpression(
          callable.body
        );
        // IR-4: Assert return value against declared returnType (AC-14, AC-15, AC-16)
        if (callable.returnType.typeName !== 'any') {
          // EC-4: Type assertion — value must match the declared scalar type
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).assertType(
            result,
            callable.returnType.structure,
            callLocation
          );
        }
        return result;
      } catch (error) {
        // Enrich errors with sourceId and sourceText from the callable's execution context
        // First assignment wins — preserves the deepest (most specific) source
        if (
          error instanceof RillError &&
          !error.sourceId &&
          callableCtx.sourceId
        ) {
          (error as { sourceId: string }).sourceId = callableCtx.sourceId;
          if (callableCtx.sourceText) {
            const ctx = (error.context ?? {}) as Record<string, unknown>;
            ctx['sourceText'] = callableCtx.sourceText;
            (error as { context: Record<string, unknown> }).context = ctx;
          }
        }
        throw error;
      } finally {
        this.ctx = savedCtx;
      }
    }

    /**
     * Invoke a stream closure: produces a RillStream instead of body result (IR-13).
     *
     * Sets up a rendezvous channel between the closure body and an async generator.
     * The body executes lazily as chunks are consumed:
     * - yield in body → pushes chunk to channel → consumer yields to iterator
     * - return in body → sets resolution value
     * - Body end without return → resolution is null
     *
     * Each call produces a new, independent stream instance (idempotency).
     *
     * Error contracts:
     * - Chunk type mismatch at yield → TYPE_MISMATCH (validated by evaluateYield)
     * - Resolution type mismatch → TYPE_MISMATCH
     */
    private async invokeStreamClosure(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      const callableCtx = this.createCallableContext(callable);

      // Marshal positional args to named record (IC-1).
      const record = marshalArgs(args, callable.params, {
        functionName: '<anonymous>',
        location: callLocation,
      });

      // Bind each named value into the callable context.
      for (const [name, value] of Object.entries(record)) {
        callableCtx.variables.set(name, value);
      }

      // IR-4: Block closure pipe sync
      if (callable.params[0]?.name === '$') {
        callableCtx.pipeValue = record['$']!;
      }

      // Extract chunk and ret types from the stream structure
      const streamStructure = callable.returnType.structure as {
        kind: 'stream';
        chunk?: TypeStructure;
        ret?: TypeStructure;
      };

      // Create channel and async generator for lazy body execution
      const channel = createStreamChannel() as StreamChannel & {
        readonly resolution: RillValue;
      };

      // Start body execution asynchronously.
      // Arrow function captures `this` from invokeStreamClosure scope.
      // The body runs concurrently with consumption, blocking at each yield
      // until the consumer pulls the next chunk.
      const bodyPromise = (async () => {
        const savedCtx = this.ctx;
        const savedChannel = this.activeStreamChannel;
        const savedChunkType = this.activeStreamChunkType;
        this.ctx = callableCtx;
        this.activeStreamChannel = channel;
        this.activeStreamChunkType = streamStructure.chunk ?? null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (this as any).evaluateBodyExpression(
            callable.body
          );
          // Validate resolution type if declared
          if (streamStructure.ret !== undefined) {
            if (!structureMatches(result, streamStructure.ret)) {
              const expected = formatStructure(streamStructure.ret);
              const actual = inferType(result);
              throwTypeHalt(
                {
                  location: callLocation,
                  sourceId: this.ctx.sourceId,
                  fn: 'stream-resolve',
                },
                'TYPE_MISMATCH',
                `Stream resolution type mismatch: expected ${expected}, got ${actual}`,
                'runtime',
                { expected, actual }
              );
            }
          }
          channel.close(result);
        } catch (error) {
          if (error instanceof ReturnSignal) {
            // return in stream body sets resolution value
            const result = error.value;
            if (streamStructure.ret !== undefined) {
              if (!structureMatches(result, streamStructure.ret)) {
                const expected = formatStructure(streamStructure.ret);
                const actual = inferType(result);
                try {
                  throwTypeHalt(
                    {
                      location: callLocation,
                      sourceId: this.ctx.sourceId,
                      fn: 'stream-resolve',
                    },
                    'TYPE_MISMATCH',
                    `Stream resolution type mismatch: expected ${expected}, got ${actual}`,
                    'runtime',
                    { expected, actual }
                  );
                } catch (haltErr) {
                  channel.error(haltErr);
                }
                return;
              }
            }
            channel.close(result);
          } else {
            channel.error(error);
          }
        } finally {
          this.ctx = savedCtx;
          this.activeStreamChannel = savedChannel;
          this.activeStreamChunkType = savedChunkType;
        }
      })();

      // Create async generator that pulls from the channel
      async function* generateChunks(): AsyncGenerator<RillValue> {
        try {
          while (true) {
            const result = await channel.pull();
            if (result.done) return;
            yield result.value;
          }
        } finally {
          // Ensure body promise settles to prevent unhandled rejections
          await bodyPromise.catch(() => {});
        }
      }

      // Build the RillStream (IR-13)
      const stream = createRillStream({
        chunks: generateChunks(),
        resolve: async () => {
          // Wait for body to complete
          await bodyPromise.catch(() => {});
          return channel.resolution;
        },
        chunkType: streamStructure.chunk,
        retType: streamStructure.ret,
      });

      return stream;
    }

    /**
     * Invoke a stream as a function (IR-12).
     * Drains remaining chunks internally, calls resolve, caches result.
     * Subsequent calls return the cached value (idempotent).
     *
     * Drain is necessary for stream closures where the body blocks at
     * yield until the consumer pulls. Without draining, resolve() would
     * hang because the body never completes.
     */
    private async invokeStream(stream: RillStream): Promise<RillValue> {
      const resolveFn = (
        stream as unknown as Record<
          string,
          (() => Promise<RillValue>) | undefined
        >
      )['__rill_stream_resolve'];
      if (typeof resolveFn !== 'function') {
        throw new RuntimeError('RILL-R002', 'Stream has no resolve function');
      }

      // Drain remaining chunks by walking the stream's linked list (AC-4).
      // This unblocks the body (which may be waiting at a yield/push).
      let current: RillStream = stream;
      while (!current.done) {
        const nextCallable = current['next'];
        if (!nextCallable || !isCallable(nextCallable)) break;
        try {
          const next = await this.invokeCallable(nextCallable, []);
          if (
            typeof next !== 'object' ||
            next === null ||
            !isStream(next as RillValue)
          )
            break;
          current = next as unknown as RillStream;
        } catch {
          // Drain errors are expected when stream is already consumed
          break;
        }
      }

      return resolveFn();
    }

    /**
     * Evaluate host function call: functionName(args)
     * Looks up function in context and invokes it.
     */
    protected async evaluateHostCall(node: HostCallNode): Promise<RillValue> {
      this.checkAborted(node);

      const fn = this.ctx.functions.get(node.name);
      if (!fn) {
        throw new RuntimeError(
          'RILL-R006',
          `Unknown function: ${node.name}`,
          this.getNodeLocation(node),
          { functionName: node.name }
        );
      }

      // EC-10/EC-11: spread-aware path for host calls
      const hasSpread = node.args.some((a) => a.type === 'SpreadArg');
      if (hasSpread) {
        const isUntypedBuiltin =
          typeof fn === 'function' ||
          (isApplicationCallable(fn) && (fn.params?.length ?? 0) === 0);
        if (isUntypedBuiltin) {
          // EC-10: built-in with no param metadata — spread not supported
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in function '${node.name}'`,
            this.getNodeLocation(node),
            { functionName: node.name }
          );
        }
        // EC-11: ApplicationCallable — bindArgsToParams handles no-params guard
        const boundArgs = await this.bindArgsToParams(
          node.args,
          fn,
          node.span.start
        );
        const orderedArgs = fn.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );

        // Observability: onHostCall before execution
        this.ctx.observability.onHostCall?.({
          name: node.name,
          args: orderedArgs,
        });

        const startTime = performance.now();
        const wrappedPromise = this.withTimeout(
          this.invokeCallable(fn, orderedArgs, node.span.start, node.name),
          this.ctx.timeout,
          node.name,
          node
        );
        const result = await wrappedPromise;
        const durationMs = performance.now() - startTime;
        this.ctx.observability.onFunctionReturn?.({
          name: node.name,
          value: result,
          durationMs,
        });
        return result;
      }

      const args = await this.evaluateArgs(node.args);

      // Add pipe value to empty args list for untyped callables.
      // Typed zero-param callables (params is a real empty array) must NOT receive
      // injected pipeValue — they declare zero parameters and marshalArgs enforces it.
      // Untyped callables (callable() factory) have params === undefined (cast).
      const isTypedZeroParam =
        typeof fn !== 'function' &&
        isApplicationCallable(fn) &&
        fn.params !== undefined &&
        fn.params.length === 0;
      if (
        args.length === 0 &&
        this.ctx.pipeValue !== null &&
        !isTypedZeroParam
      ) {
        args.push(this.ctx.pipeValue);
      }

      // Observability: onHostCall before execution
      this.ctx.observability.onHostCall?.({ name: node.name, args });

      const startTime = performance.now();

      // Use invokeCallable for consistent validation, invocation, and call stack management
      const wrappedPromise = this.withTimeout(
        (async () => {
          // Handle both CallableFn and ApplicationCallable
          if (typeof fn === 'function') {
            // Raw CallableFn - wrap in minimal callable and invoke through invokeCallable
            const callable: RuntimeCallable = {
              __type: 'callable' as const,
              kind: 'runtime' as const,
              fn,
              isProperty: false,
              params: [],
              annotations: {},
              returnType: anyTypeValue,
            };
            return this.invokeCallable(
              callable,
              args,
              node.span.start,
              node.name
            );
          } else {
            // ApplicationCallable - use invokeCallable for validation and call stack
            return this.invokeCallable(fn, args, node.span.start, node.name);
          }
        })(),
        this.ctx.timeout,
        node.name,
        node
      );

      const result = await wrappedPromise;
      const durationMs = performance.now() - startTime;

      // Observability: onFunctionReturn after execution
      this.ctx.observability.onFunctionReturn?.({
        name: node.name,
        value: result,
        durationMs,
      });

      return result;
    }

    /**
     * Evaluate host function reference: ns::name (no parens, namespaced).
     *
     * When pipeValue is null (value-capture context): returns the
     * ApplicationCallable directly without invoking [IR-4].
     *
     * When pipeValue is set (pipe/branch context): invokes the callable
     * with the pipe value as the implicit argument, consistent with how
     * bare HostRef behaves as a pipe-stage expression [IR-4].
     *
     * Throws RILL-R006 when the function name is not registered [EC-4].
     */
    protected async evaluateHostRef(node: HostRefNode): Promise<RillValue> {
      this.checkAborted(node);

      const fn = this.ctx.functions.get(node.name);
      if (!fn) {
        throw new RuntimeError(
          'RILL-R006',
          `Function "${node.name}" not found`,
          this.getNodeLocation(node),
          { functionName: node.name }
        );
      }

      // Build ApplicationCallable wrapper for raw CallableFn; pass through
      // ApplicationCallable objects directly.
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

      // Value-capture context: no pipe value → return callable without invoking [IR-4]
      if (this.ctx.pipeValue === null) {
        return appCallable as RillValue;
      }

      // Pipe/branch context: pipe value present.
      // Typed zero-param callables (params is a real empty array) must be invoked
      // with no arguments — injecting pipeValue would cause RILL-R045.
      // Untyped callables (callable() factory) have params === undefined (cast).
      const isTypedZeroParam =
        appCallable.params !== undefined && appCallable.params.length === 0;
      const args: RillValue[] = isTypedZeroParam ? [] : [this.ctx.pipeValue];
      return this.invokeCallable(
        appCallable,
        args,
        this.getNodeLocation(node),
        node.name
      );
    }

    /**
     * Evaluate closure call: $fn(args)
     * Delegates to evaluateClosureCallWithPipe using current pipe value.
     */
    protected async evaluateClosureCall(
      node: ClosureCallNode
    ): Promise<RillValue> {
      return this.evaluateClosureCallWithPipe(node, this.ctx.pipeValue);
    }

    /**
     * Evaluate closure call with pipe input: value -> $fn(args)
     * Supports access chains like $math.double(args).
     */
    protected async evaluateClosureCallWithPipe(
      node: ClosureCallNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      // Get the base variable
      let value: RillValue | undefined = getVariable(this.ctx, node.name);
      if (value === undefined || value === null) {
        throw new RuntimeError(
          'RILL-R005',
          `Unknown variable: $${node.name}`,
          this.getNodeLocation(node),
          { variableName: node.name }
        );
      }

      // Traverse accessChain to get the closure (e.g., $math.double)
      const fullPath = ['$' + node.name, ...node.accessChain].join('.');
      for (const prop of node.accessChain) {
        if (value === null) {
          throw new RuntimeError(
            'RILL-R009',
            `Cannot access property '${prop}' on null`,
            this.getNodeLocation(node)
          );
        }
        if (isDict(value)) {
          value = (value as Record<string, RillValue>)[prop];
          if (value === undefined || value === null) {
            throw new RuntimeError(
              'RILL-R009',
              `Dict has no field '${prop}'`,
              this.getNodeLocation(node)
            );
          }
        } else {
          throw new RuntimeError(
            'RILL-R002',
            `Cannot access property on non-dict value at '${fullPath}'`,
            this.getNodeLocation(node)
          );
        }
      }

      // IR-12: Stream invocation — $s() returns the resolution value
      if (isStream(value)) {
        return this.invokeStream(value as RillStream);
      }

      if (!isCallable(value)) {
        throw new RuntimeError(
          'RILL-R002',
          `'${fullPath}' is not callable`,
          this.getNodeLocation(node),
          { path: fullPath, actualType: inferType(value) }
        );
      }

      const closure = value;

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        if (!isScriptCallable(closure) && !isApplicationCallable(closure)) {
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in callable at '${fullPath}'`,
            this.getNodeLocation(node)
          );
        }
        const boundArgs = await this.bindArgsToParams(
          node.args,
          closure,
          node.span.start
        );
        const orderedArgs = closure.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeCallable(
          closure,
          orderedArgs,
          node.span.start,
          fullPath
        );
      }

      const args = await this.evaluateArgs(node.args);

      // If no explicit args and has pipe input, add pipe value as first arg
      // UNLESS closure has zero parameters (explicit zero-param signature)
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

      return this.invokeCallable(closure, args, node.span.start, fullPath);
    }

    /**
     * Evaluate $.field as property access on the pipe value.
     * This allows -> $.a to access property 'a' of the current pipe value.
     */
    protected async evaluatePipePropertyAccess(
      node: VariableNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      let value = pipeInput;

      for (const access of node.accessChain) {
        if (value === null) {
          throw new RuntimeError(
            'RILL-R009',
            `Cannot access property on null`,
            this.getNodeLocation(node)
          );
        }

        // Check if this is a bracket access (has accessKind discriminator)
        if ('accessKind' in access) {
          // bracket access - delegate to evaluateVariableAsync
          // (Not in scope for this mixin - will be handled by VariablesMixin)
          throw new RuntimeError(
            'RILL-R002',
            'Bracket access not supported in this context',
            this.getNodeLocation(node)
          );
        }

        // Must be a FieldAccess (literal, variable, computed, block, alternatives)
        // TypeScript now knows access is FieldAccess due to discriminated union
        if (access.kind === 'literal') {
          const field = access.field;
          value = await this.accessDictField(
            value,
            field,
            this.getNodeLocation(node)
          );
        } else {
          // Other field access types (variable, computed, block, alternatives)
          // are handled by VariablesMixin
          throw new RuntimeError(
            'RILL-R002',
            `Field access kind '${access.kind}' not supported in this context`,
            this.getNodeLocation(node)
          );
        }
      }

      // Handle default value from VariableNode (not PropertyAccess)
      if (value === null && node.defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value = await (this as any).evaluateExpression(node.defaultValue);
      }

      return value;
    }

    /**
     * Evaluate variable invocation with pipe: value -> $var
     * If variable is callable, invokes it with pipe value.
     */
    protected async evaluateVariableInvoke(
      node: PipeInvokeNode,
      _pipeInput: RillValue
    ): Promise<RillValue> {
      // NOTE: This method signature in spec doesn't match usage pattern.
      // PipeInvokeNode is for -> (args) syntax, not variable invocation.
      // The actual variable invoke logic is in evaluateVariableAsync (VariablesMixin).
      // This stub satisfies the spec interface but delegates to correct implementation.
      throw new RuntimeError(
        'RILL-R002',
        'evaluateVariableInvoke is a placeholder - use evaluateVariableAsync from VariablesMixin',
        this.getNodeLocation(node)
      );
    }

    /**
     * Evaluate pipe invoke: value -> (args)
     * Calls the input value as a closure with the given arguments.
     */
    protected async evaluatePipeInvoke(
      node: PipeInvokeNode,
      input: RillValue
    ): Promise<RillValue> {
      if (!isScriptCallable(input)) {
        throw new RuntimeError(
          'RILL-R002',
          `Cannot invoke non-closure value (got ${typeof input})`,
          this.getNodeLocation(node)
        );
      }

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        const boundArgs = await this.bindArgsToParams(
          node.args,
          input,
          node.span.start
        );
        const orderedArgs = input.params.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeScriptCallable(input, orderedArgs, node.span.start);
      }

      const args = await this.evaluateArgs(node.args);

      return this.invokeScriptCallable(input, args, node.span.start);
    }

    /**
     * Evaluate method call on receiver: value.method(args)
     * Handles both built-in methods and dict-bound callables.
     */
    protected async evaluateMethod(
      node: MethodCallNode | InvokeNode,
      receiver: RillValue
    ): Promise<RillValue> {
      this.checkAborted(node);

      // Handle postfix invocation: expr(args) - calls receiver as a closure
      if (node.type === 'Invoke') {
        return this.evaluateInvoke(node, receiver);
      }

      if (isCallable(receiver)) {
        throw new RuntimeError(
          'RILL-R003',
          `Method .${node.name} not available on callable (invoke with -> $() first)`,
          this.getNodeLocation(node),
          { methodName: node.name, receiverType: 'callable' }
        );
      }

      // IR-3: .name on type values returns the typeName string (method path)
      // IR-4: .signature on type values returns formatStructure(structure)
      if (isTypeValue(receiver)) {
        if (node.name === 'name') {
          return receiver.typeName;
        }
        if (node.name === 'signature') {
          return formatStructure(receiver.structure);
        }
      }

      const args = await this.evaluateArgs(node.args);

      // §9.3: Resolve method via typeMethodDicts (type method takes priority over dict key)
      // AC-27: Type method has priority over dict value key.
      const typeName = inferType(receiver);
      const typeDict = this.ctx.typeMethodDicts.get(typeName);
      const typeMethod = typeDict?.[node.name];

      if (typeMethod !== undefined && isApplicationCallable(typeMethod)) {
        // IC-1: marshalArgs handles type method dispatch.
        // effectiveArgs prepends receiver as first element; after task 2.3 typeMethod.params
        // will include the receiver param so the counts align.
        // UNVALIDATED_METHOD_PARAMS methods handle their own validation internally;
        // skip marshalArgs for them and pass the positional array via cast.
        const callLocation = this.getNodeLocation(node);
        const effectiveArgs = [receiver, ...args];
        let methodArgs: Record<string, RillValue>;
        if (typeMethod.params === undefined) {
          // Untyped method: pass positional array via cast.
          methodArgs = effectiveArgs as unknown as Record<string, RillValue>;
        } else if (UNVALIDATED_METHOD_PARAMS.has(node.name)) {
          // UNVALIDATED_METHOD_PARAMS: method handles its own arity and type
          // validation with custom error messages. Pass the actual user args
          // via __positionalArgs so buildMethodEntry reconstructs positionalArgs
          // with the correct length, letting method body arity checks fire.
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
          const result = typeMethod.fn(methodArgs, this.ctx, callLocation);
          return result instanceof Promise ? await result : result;
        } catch (error) {
          if (
            error instanceof RuntimeError &&
            !error.location &&
            callLocation
          ) {
            const span: SourceSpan = { start: callLocation, end: callLocation };
            throw new RuntimeError(
              error.errorId,
              error.toData().message,
              callLocation,
              error.context,
              span
            );
          }
          throw error;
        }
      }

      // Dict-bound closure lookup: only reached when method not in type dict
      if (isDict(receiver)) {
        const dictValue = receiver[node.name];
        if (dictValue !== undefined && isCallable(dictValue)) {
          return this.invokeCallable(
            dictValue,
            args,
            this.getNodeLocation(node),
            node.name
          );
        }
      }

      // Property access on dict (no-arg only): only reached when method not in type dict
      if (
        isDict(receiver) &&
        args.length === 0 &&
        Object.hasOwn(receiver, node.name)
      ) {
        return receiver[node.name] as RillValue;
      }

      // EC-5: Unknown dot property on type value raises RILL-R009
      if (isTypeValue(receiver)) {
        throw new RuntimeError(
          'RILL-R009',
          `Property '${node.name}' not found on type value (available: name, signature)`,
          this.getNodeLocation(node),
          { property: node.name, type: 'type value' }
        );
      }

      // RILL-R003: method exists on other types but not this receiver's type.
      // Methods in unvalidatedMethodReceivers handle their own receiver validation
      // with specific error messages; skip generic RILL-R003 for them and let the
      // method body run its own check (they exist in at least one type dict).
      if (!this.ctx.unvalidatedMethodReceivers.has(node.name)) {
        const supportedTypes: string[] = [];
        for (const [dictType, dict] of this.ctx.typeMethodDicts) {
          if (dict[node.name] !== undefined) {
            supportedTypes.push(dictType);
          }
        }
        if (supportedTypes.length > 0) {
          throw new RuntimeError(
            'RILL-R003',
            `Method '${node.name}' not supported on ${typeName}; supported: ${supportedTypes.join(', ')}`,
            this.getNodeLocation(node),
            { methodName: node.name, receiverType: typeName }
          );
        }
      } else {
        // unvalidatedMethodReceivers: dispatch to the method in ANY type dict so the
        // method body can run its own custom receiver validation and error message.
        for (const [, dict] of this.ctx.typeMethodDicts) {
          const fallbackMethod = dict[node.name];
          if (
            fallbackMethod !== undefined &&
            isApplicationCallable(fallbackMethod)
          ) {
            try {
              // Unvalidated methods handle their own receiver validation.
              // Build named record with receiver so buildMethodEntry extracts it correctly;
              // the method body performs its own receiver type check with a custom error.
              const fbMethodArgs: Record<string, RillValue> = { receiver };
              if (fallbackMethod.params) {
                for (let i = 1; i < fallbackMethod.params.length; i++) {
                  const p = fallbackMethod.params[i];
                  if (p) fbMethodArgs[p.name] = args[i - 1] ?? null;
                }
              }
              const result = fallbackMethod.fn(
                fbMethodArgs,
                this.ctx,
                this.getNodeLocation(node)
              );
              return result instanceof Promise ? await result : result;
            } catch (error) {
              const callLocation = this.getNodeLocation(node);
              if (
                error instanceof RuntimeError &&
                !error.location &&
                callLocation
              ) {
                const span: SourceSpan = {
                  start: callLocation,
                  end: callLocation,
                };
                throw new RuntimeError(
                  error.errorId,
                  error.toData().message,
                  callLocation,
                  error.context,
                  span
                );
              }
              throw error;
            }
          }
        }
      }

      // EC-1: Method not found on any type dict → RILL-R007
      throw new RuntimeError(
        'RILL-R007',
        `Unknown method: ${node.name} on type ${typeName}`,
        this.getNodeLocation(node),
        { methodName: node.name, typeName }
      );
    }

    /**
     * Evaluate postfix invocation: expr(args)
     * Calls the receiver value as a closure with the given arguments.
     */
    protected async evaluateInvoke(
      node: InvokeNode,
      receiver: RillValue
    ): Promise<RillValue> {
      // IR-12: Stream invocation — $s() returns the resolution value
      if (isStream(receiver)) {
        return this.invokeStream(receiver as RillStream);
      }

      if (!isCallable(receiver)) {
        throw new RuntimeError(
          'RILL-R002',
          `Cannot invoke non-callable value (got ${inferType(receiver)})`,
          this.getNodeLocation(node),
          { actualType: inferType(receiver) }
        );
      }

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        if (!isScriptCallable(receiver) && !isApplicationCallable(receiver)) {
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in callable`,
            this.getNodeLocation(node)
          );
        }
        const boundArgs = await this.bindArgsToParams(
          node.args,
          receiver,
          node.span.start
        );
        const orderedArgs = receiver.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeCallable(receiver, orderedArgs, node.span.start);
      }

      const args = await this.evaluateArgs(node.args);
      return this.invokeCallable(receiver, args, this.getNodeLocation(node));
    }

    /**
     * Evaluate annotation reflection access: .^key
     * Resolves annotation metadata from callable values.
     *
     * All 3 callable kinds (script, application, runtime) support annotation reflection.
     * Throws RILL-R003 for non-callable, non-type-value targets.
     * Throws RILL-R008 for unknown annotation keys or type value receivers.
     */
    protected async evaluateAnnotationAccess(
      value: RillValue,
      key: string,
      location: SourceLocation
    ): Promise<RillValue> {
      // IR-2: .^type returns a RillTypeValue for any rill value
      if (key === 'type') {
        const typeValue: RillTypeValue = Object.freeze({
          __rill_type: true as const,
          typeName: inferType(value) as RillTypeName,
          structure: inferStructure(value),
        });
        return typeValue;
      }

      // EC-5: type values are not annotation containers — any ^key raises RILL-R008
      if (isTypeValue(value)) {
        throw new RuntimeError(
          'RILL-R008',
          `Annotation access not supported on type values`,
          location,
          { annotationKey: key }
        );
      }

      // IR-11: Stream reflection — ^chunk and ^output on stream values
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
        throw new RuntimeError(
          'RILL-R003',
          `annotation not found: ^${key}`,
          location,
          { actualType: 'stream' }
        );
      }

      // Non-callable values do not support annotation reflection
      if (!isCallable(value)) {
        throw new RuntimeError(
          'RILL-R003',
          `annotation not found: ^${key}`,
          location,
          { actualType: inferType(value) }
        );
      }

      // IR-3: ^description reads from callable.annotations["description"], returns {} if absent
      if (key === 'description') {
        return value.annotations['description'] ?? {};
      }

      // IR-3: ^input computes from callable.params for all kinds.
      // Each param's RillType is converted to a RillTypeValue so it is recognized
      // as a type token (not a plain dict) in rill's type system.
      if (key === 'input') {
        // Untyped host callables have params set to undefined at runtime (see callable() factory)
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

      // IR-3: ^output reads callable.returnType directly for all kinds
      if (key === 'output') {
        return value.returnType;
      }

      // Access annotation from callable.annotations for all callable kinds
      const annotationValue = value.annotations[key];

      // EC-4: unknown annotation key throws RILL-R008
      if (annotationValue === undefined) {
        throw new RuntimeError(
          'RILL-R008',
          `Annotation '${key}' not found`,
          location,
          { annotationKey: key }
        );
      }

      return annotationValue;
    }

    /**
     * Bind argument nodes to callable parameters when a SpreadArgNode is present.
     *
     * Evaluates positional args LTR, evaluates the spread expression, dispatches
     * by value type (Tuple, Ordered, or Dict), validates bindings, and returns
     * a BoundArgs map of param name → value.
     *
     * Output is compatible with marshalArgs stages 2-3 (IR-1):
     * - All params present in returned map (defaults applied, missing required throws)
     * - Stage 1 (excess args) is NOT checked here; bindArgsToParams validates arity
     *   differently per spread source type (tuple length, dict key match, etc.)
     * - Phase 2 callers convert BoundArgs.params to positional RillValue[] then
     *   feed into marshalArgs stages 2-3 for type-checking
     *
     * EC-3: bare ... with null pipe value → RuntimeError
     * EC-4: spread value is not tuple/dict/ordered → RuntimeError
     * EC-5: dict spread key matches no parameter → RuntimeError
     * EC-6: ordered spread key at position N mismatches param at position N → RuntimeError
     * EC-7: duplicate binding (positional + spread) → RuntimeError
     * EC-8: missing required parameter after all args processed → RuntimeError
     * EC-9: extra tuple values exceed param count → RuntimeError
     * EC-11: ApplicationCallable with no params metadata → RuntimeError
     */
    protected async bindArgsToParams(
      argNodes: (ExpressionNode | SpreadArgNode)[],
      callable: ScriptCallable | ApplicationCallable,
      callLocation: SourceLocation
    ): Promise<BoundArgs> {
      // EC-11: ApplicationCallable must have params metadata for spread to work
      if (callable.kind === 'application' && callable.params === undefined) {
        const name = callable.fn.name !== '' ? callable.fn.name : '<anonymous>';
        throw new RuntimeError(
          'RILL-R001',
          `Spread not supported for host function '${name}': parameter metadata required`,
          callLocation
        );
      }

      const params = callable.params as readonly { name: string }[];
      const bound = new Map<string, RillValue>();

      // Positional index: next unbound parameter position
      let positionalIndex = 0;

      // Save pipe value so evaluating args does not mutate it permanently
      const savedPipeValue = this.ctx.pipeValue;

      try {
        for (const argNode of argNodes) {
          if (argNode.type !== 'SpreadArg') {
            // Positional argument
            const param = params[positionalIndex];
            if (param === undefined) {
              // Extra positional arg beyond param count — EC-9 reports after spread
              // but for pure positional excess, error here with the positional count
              throw new RuntimeError(
                'RILL-R001',
                `Extra positional argument at position ${positionalIndex} (function has ${params.length} parameters)`,
                callLocation
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = await (this as any).evaluateExpression(argNode);
            bound.set(param.name, value);
            positionalIndex++;
          } else {
            // SpreadArg: evaluate the expression
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const spreadValue = await (this as any).evaluateExpression(
              argNode.expression
            );

            // EC-3: bare ... with no pipe value evaluates to null
            if (spreadValue === null) {
              throw new RuntimeError(
                'RILL-R001',
                'Spread requires an active pipe value ($)',
                callLocation
              );
            }

            // Dispatch by type: isOrdered BEFORE isDict per spec (IC-3 algorithm step 2)
            if (isTuple(spreadValue)) {
              // Tuple: fill remaining params positionally LTR (EC-9)
              const tupleEntries = spreadValue.entries;
              const remaining = params.length - positionalIndex;
              if (tupleEntries.length > remaining) {
                throw new RuntimeError(
                  'RILL-R001',
                  `Spread tuple has ${tupleEntries.length} values but only ${remaining} parameter(s) remain`,
                  callLocation
                );
              }
              for (let i = 0; i < tupleEntries.length; i++) {
                const param = params[positionalIndex + i]!;
                // EC-7: duplicate binding
                if (bound.has(param.name)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${param.name}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(param.name, tupleEntries[i]!);
              }
              positionalIndex += tupleEntries.length;
            } else if (isOrdered(spreadValue)) {
              // Ordered: match key by name AND position
              // Key at position N within ordered value must match param at (spreadStart + N)
              const orderedEntries = spreadValue.entries;
              for (let i = 0; i < orderedEntries.length; i++) {
                const [key, value] = orderedEntries[i]!;
                const expectedParam = params[positionalIndex + i];
                // EC-6: key-order mismatch
                if (expectedParam === undefined || expectedParam.name !== key) {
                  const expectedName = expectedParam?.name ?? '<none>';
                  throw new RuntimeError(
                    'RILL-R001',
                    `Ordered spread key '${key}' at position ${i} does not match expected parameter '${expectedName}' at position ${positionalIndex + i}`,
                    callLocation
                  );
                }
                // EC-7: duplicate binding
                if (bound.has(key)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${key}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(key, value);
              }
              positionalIndex += orderedEntries.length;
            } else if (isDict(spreadValue)) {
              // Dict: match each key to param by name (order irrelevant)
              const dictValue = spreadValue as Record<string, RillValue>;
              const paramNames = new Set(params.map((p) => p.name));
              for (const [key, value] of Object.entries(dictValue)) {
                // EC-5: key matches no parameter
                if (!paramNames.has(key)) {
                  const validParams = params.map((p) => p.name).join(', ');
                  throw new RuntimeError(
                    'RILL-R001',
                    `Dict spread key '${key}' does not match any parameter. Valid parameters: ${validParams}`,
                    callLocation
                  );
                }
                // EC-7: duplicate binding
                if (bound.has(key)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${key}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(key, value);
              }
            } else {
              // EC-4: spread value is not tuple/dict/ordered
              const actualType = inferType(spreadValue);
              throw new RuntimeError(
                'RILL-R001',
                `Spread requires a tuple, dict, or ordered value, got ${actualType}`,
                callLocation
              );
            }
          }
        }
      } finally {
        this.ctx.pipeValue = savedPipeValue;
      }

      return { params: bound };
    }

    /**
     * Evaluate .params property access on callables.
     * Builds dict from callable parameter metadata.
     *
     * Returns dict keyed by parameter name, where each entry is a dict with:
     * - type: string (if param has type annotation)
     * - __annotations: dict (if param has parameter-level annotations)
     *
     * Empty params callable returns empty dict [].
     * Works on all 3 callable kinds via CallableBase.params.
     * Throws RILL-R003 for non-callable targets.
     */
    protected async evaluateParamsProperty(
      callable: RillValue,
      location: SourceLocation
    ): Promise<Record<string, RillValue>> {
      // All callable kinds support .params reflection via CallableBase.params
      if (!isCallable(callable)) {
        throw new RuntimeError(
          'RILL-R003',
          `Cannot access .params on ${inferType(callable)}`,
          location,
          { actualType: inferType(callable) }
        );
      }

      // Build params dict from CallableBase.params — works for all 3 callable kinds
      const paramsDict: Record<string, RillValue> = {};

      for (const param of callable.params ?? []) {
        const paramEntry: Record<string, RillValue> = {};

        // Add type field if param has type annotation
        if (param.type !== undefined) {
          paramEntry['type'] = formatStructure(param.type);
        }

        // Add __annotations field if param has parameter-level annotations
        if (Object.keys(param.annotations).length > 0) {
          paramEntry['__annotations'] = param.annotations;
        }

        paramsDict[param.name] = paramEntry;
      }

      return paramsDict;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ClosuresMixin = createClosuresMixin as any;
