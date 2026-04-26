/**
 * CallableInvocationStrategy
 *
 * Encapsulates the three-phase callable invocation protocol:
 *   Phase 1 – validate: guard non-callable targets before any evaluation
 *   Phase 2 – bind: delegate to ArgumentsBinder for spread-aware binding
 *   Phase 3 – invoke: own the call-stack frame try/catch/finally
 *
 * Instantiated once per evaluation context (no per-call allocation).
 *
 * Error codes:
 *   RILL-R001 – non-callable target [EC-4], argument binding failure [EC-5]
 *   Original code preserved – callable body RillError [EC-6], re-thrown after
 *                              frame is appended to callStack
 *   Wrapped as RuntimeError – callable body non-Rill error [EC-7]
 *
 * @internal
 */

import type {
  SourceLocation,
  SourceSpan,
  ExpressionNode,
  SpreadArgNode,
  CallFrame,
} from '../../../../types.js';
import { RillError } from '../../../../types.js';
import { RuntimeHaltSignal, throwCatchableHostHalt } from '../../types/halt.js';
import { getStatus, mergeRaw } from '../../types/status.js';
import { isExtensionThrow, markExtensionThrow } from '../../extension-throw.js';
import type { RillCallable } from '../../callable.js';
import { isCallable } from '../../callable.js';
import { pushCallFrame, popCallFrame } from '../../context.js';
import type { RuntimeContext } from '../../types/runtime.js';
import type { RillValue } from '../../types/structures.js';
import type { ArgumentsBinder, BoundArguments } from './arguments-binder.js';

// ============================================================
// CALLER TYPE
// ============================================================

/**
 * Injected executor: performs the actual callable dispatch.
 * Provided by the evaluator so the strategy stays decoupled from
 * invokeScriptCallable / invokeFnCallable mixin internals.
 */
export type InvocationCaller = (
  callable: RillCallable,
  args: RillValue[],
  location: SourceLocation | undefined,
  functionName?: string
) => Promise<RillValue>;

// ============================================================
// CALLABLE INVOCATION STRATEGY
// ============================================================

/**
 * Four-phase callable invocation strategy.
 *
 * Construct once per evaluation context and reuse across calls.
 * Each public method covers exactly one phase; callers sequence them.
 */
export class CallableInvocationStrategy {
  private readonly getCtx: () => RuntimeContext;
  private readonly binder: ArgumentsBinder;
  private readonly caller: InvocationCaller;

  constructor(
    getCtx: () => RuntimeContext,
    binder: ArgumentsBinder,
    caller: InvocationCaller
  ) {
    this.getCtx = getCtx;
    this.binder = binder;
    this.caller = caller;
  }

  // ============================================================
  // PHASE 1 – VALIDATE
  // ============================================================

  /**
   * Guard non-callable targets before any argument evaluation.
   *
   * EC-4 / AC-12: throws RILL-R001 when `target` is not a callable,
   * embedding `path` and `location` in the error context.
   */
  validate(target: RillCallable, path: string, location: SourceLocation): void {
    if (!isCallable(target as RillValue)) {
      throwCatchableHostHalt(
        { location, sourceId: this.getCtx().sourceId, fn: 'validate' },
        'RILL_R001',
        `'${path}' is not callable`,
        { path }
      );
    }
  }

  // ============================================================
  // PHASE 2 – BIND
  // ============================================================

  /**
   * Evaluate and bind arguments to the callable's parameter list.
   *
   * Delegates to `ArgumentsBinder` as the single spread-detection owner.
   * EC-5: binding failures surface from ArgumentsBinder unchanged.
   */
  async bind(
    callable: RillCallable,
    args: (ExpressionNode | SpreadArgNode)[],
    pipeInput: RillValue | undefined,
    evaluate: (node: ExpressionNode) => Promise<RillValue>,
    location: SourceLocation
  ): Promise<BoundArguments> {
    return this.binder.bind(
      args,
      callable,
      pipeInput,
      evaluate,
      location,
      this.getCtx().sourceId
    );
  }

  // ============================================================
  // PHASE 4 – INVOKE
  // ============================================================

  /**
   * Push a call-stack frame, execute the callable, then pop the frame.
   *
   * Owns the try/catch/finally pattern from closures.ts:478-523.
   * Callers must NOT re-catch for frame enrichment — this method is
   * the single frame-enrichment site.
   *
   * AC-16: `finally` guarantees frame pop on both success and failure.
   * AC-18: each call pushes/pops its own frame, preventing cross-call
   *        contamination in re-entrant (nested) invocations.
   *
   * EC-6: body RillError — callStack snapshot appended, error re-thrown.
   * EC-7: body non-Rill error — wrapped as RuntimeError (RILL-R001).
   */
  async invoke(
    callable: RillCallable,
    args: BoundArguments,
    location: SourceLocation,
    functionName?: string
  ): Promise<RillValue> {
    // Read ctx lazily — callers may rebind their `this.ctx` during script
    // callable execution (e.g. nested closure contexts). Capturing at
    // construction would leave the frame pointing at a stale sourceId.
    const ctx = this.getCtx();
    const frameName =
      functionName ?? (callable.kind === 'script' ? '<closure>' : '<callable>');

    const span: SourceSpan = { start: location, end: location };
    const frame: CallFrame = {
      location: span,
      functionName: frameName,
      sourceId: ctx.sourceId,
    };
    pushCallFrame(ctx, frame);

    try {
      // Pass the original functionName through — downstream marshalling
      // (e.g. marshalArgs in invokeFnCallable) preserves its own default
      // when `functionName` is undefined. Only the call frame uses `frameName`.
      return await this.caller(
        callable,
        [...args.params.values()],
        location,
        functionName
      );
    } catch (error) {
      // EC-6: snapshot call stack onto the error before finally pops frame.
      // First snapshot wins — nested calls capture the deepest stack.
      if (error instanceof RillError && ctx.callStack.length > 0) {
        const errCtx = error.context as Record<string, unknown> | undefined;
        if (errCtx && !errCtx['callStack']) {
          errCtx['callStack'] = [...ctx.callStack];
        } else if (!errCtx) {
          // context is readonly on the property; override via cast for errors
          // constructed without a context object.
          (error as { context: Record<string, unknown> }).context = {
            callStack: [...ctx.callStack],
          };
        }
      } else if (
        error instanceof RuntimeHaltSignal &&
        ctx.callStack.length > 0
      ) {
        // Halt path: attach call stack to raw so the host-boundary bridge
        // surfaces it on RuntimeError.context.callStack (AC-NOD-6 parity).
        const priorRaw = getStatus(error.value).raw;
        if (!('callStack' in priorRaw)) {
          const enriched = mergeRaw(error.value, {
            callStack: [...ctx.callStack] as unknown as RillValue,
          });
          const newSignal = new RuntimeHaltSignal(enriched, error.catchable);
          // Preserve extension-throw tag across the rewrap (markExtensionThrow
          // tracks identity in a WeakSet, so the new signal needs re-marking).
          if (isExtensionThrow(error)) {
            markExtensionThrow(newSignal);
          }
          throw newSignal;
        }
      }
      throw error;
    } finally {
      // AC-16: pop frame on both success and failure paths.
      popCallFrame(ctx);
    }
  }
}
