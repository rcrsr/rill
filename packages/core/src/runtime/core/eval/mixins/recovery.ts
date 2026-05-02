/**
 * RecoveryMixin: Guard / Retry Blocks, Status Probes, and Timeout Blocks
 *
 * Provides evaluator methods for the four recovery-related AST nodes:
 * - `GuardBlock` (`guard { body }` / `guard<on: [...]> { body }`)
 * - `RetryBlock` (`retry<limit: N> { body }` / `retry<limit: N, on: [...]> { body }`)
 * - `StatusProbe` (`$x.!`, `$x.!code`, `$x.!message`, ...)
 * - `TimeoutBlock` (`timeout<total: d> { body }` / `timeout<idle: d> { body }`)
 *
 * Interface requirements (from spec §Architecture Overview Data Flow,
 * IC-1, EC-7, EC-8, EC-9):
 * - Guard catches `RuntimeHaltSignal` at block boundary, appends a
 *   `guard-caught` trace frame, returns the invalid value as block
 *   result.
 * - Retry<limit: N> re-enters its body on caught halt up to N attempts;
 *   appends one `guard-caught` frame per failed attempt.
 * - `<on: list[#X, ...]>` filter: non-matching halts propagate (NOT
 *   caught).
 * - Status probes bypass the access-halt gate and read the sidecar
 *   directly.
 * - `error "..."` and `assert` raise non-catchable halts: guard /
 *   retry re-throw them unconditionally (FR-ERR-10, FR-ERR-11).
 * - TimeoutBlock creates a fresh AbortController, chains it to ctx.signal,
 *   arms a wall-time (total) or idle-tick (idle) timer, and on expiry
 *   aborts the controller and throws a catchable halt carrying
 *   #TIMEOUT_TOTAL or #TIMEOUT_IDLE. [IR-1, IR-2, EC-1, EC-2]
 *
 * @internal
 */

import type {
  AtomLiteralNode,
  GuardBlockNode,
  RetryBlockNode,
  StatusProbeNode,
  TimeoutBlockNode,
} from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import type { RillDuration } from '../../types/structures.js';
import {
  getStatus,
  appendTraceFrame,
  invalidate,
  isInvalid,
} from '../../types/status.js';
import { createTraceFrame } from '../../types/trace.js';
import type { RillAtom } from '../../types/atom-registry.js';
import { resolveAtom } from '../../types/atom-registry.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';
import { RuntimeHaltSignal, formatAccessSite } from './access.js';
import { isDuration } from '../../types/guards.js';
import { inferType } from '../../types/registrations.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import type { RuntimeContext, TimeoutScheduler } from '../../types/runtime.js';
import { ControlSignal } from '../../signals.js';

// ============================================================
// AC-B2: Minimum retry attempts (engineer-consistent choice)
// ============================================================

/**
 * Minimum retry attempts. The parser rejects `limit:` values `< 1`, so this
 * guard only fires when a host synthesises a `RetryBlock` AST node directly
 * with `attempts <= 0`. Such a node executes zero times and returns an
 * invalid `#R001` per AC-B2 (plan task 2.3); the body never runs.
 */
const RETRY_MIN_ATTEMPTS = 1;

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolves a node's atom-literal `onCodes` filter into a set of
 * interned `RillAtom` references. Returns `undefined` when the filter
 * is absent (meaning: catch every catchable halt).
 *
 * The registry interns atoms once per name, so identity comparison
 * (`===`) is sufficient for membership checks.
 */
function resolveOnCodes(
  onCodes: AtomLiteralNode[] | undefined
): ReadonlySet<RillAtom> | undefined {
  if (onCodes === undefined || onCodes.length === 0) return undefined;
  const codes = new Set<RillAtom>();
  for (const lit of onCodes) {
    codes.add(resolveAtom(lit.name));
  }
  return codes;
}

/**
 * Returns true when `signal` is catchable AND its invalid value's
 * status code matches the `onCodes` filter (or the filter is absent).
 *
 * Non-catchable halts (from `error` / `assert`) never match; this
 * enforces FR-ERR-10 / FR-ERR-11.
 */
function shouldCatch(
  signal: RuntimeHaltSignal,
  onCodes: ReadonlySet<RillAtom> | undefined
): boolean {
  if (!signal.catchable) return false;
  if (onCodes === undefined) return true;
  const status = getStatus(signal.value);
  return onCodes.has(status.code);
}

/**
 * RecoveryMixin implementation.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - ControlFlowMixin: evaluateBody(node) (for body execution)
 * - CoreMixin / VariablesMixin: evaluateExpression() (for probe target)
 *
 * Methods added:
 * - evaluateGuardBlock(node) -> Promise<RillValue>
 * - evaluateRetryBlock(node) -> Promise<RillValue>
 * - evaluateStatusProbe(node) -> Promise<RillValue>
 */
function createRecoveryMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class RecoveryEvaluator extends Base {
    /**
     * Evaluate a guard block.
     *
     * Runs the body once. On a catchable halt whose code matches the
     * optional `onCodes` filter, appends a `guard-caught` trace frame
     * and returns the invalid value as the block result. Non-matching
     * halts and non-catchable halts (error / assert) propagate.
     */
    protected async evaluateGuardBlock(
      node: GuardBlockNode
    ): Promise<RillValue> {
      const onCodes = resolveOnCodes(node.onCodes);
      try {
        return await (this as unknown as EvaluatorInterface).evaluateBody(
          node.body
        );
      } catch (e) {
        if (e instanceof RuntimeHaltSignal && shouldCatch(e, onCodes)) {
          const frame = createTraceFrame({
            site: formatAccessSite(
              this.getNodeLocation(node),
              this.ctx.sourceId
            ),
            kind: 'guard-caught',
            fn: 'guard',
          });
          return appendTraceFrame(e.value, frame);
        }
        throw e;
      }
    }

    /**
     * Evaluate a retry block.
     *
     * Re-enters the body up to `node.attempts` times. Each caught halt
     * that matches the `onCodes` filter appends one `guard-caught`
     * frame to a running invalid value and advances to the next
     * attempt. On success, returns the body's result. If every attempt
     * halts, returns the final invalid value with all N frames.
     *
     * AC-B2: A `RetryBlock` node with `attempts <= 0` (only reachable via
     * host-synthesised AST; the parser rejects `limit: N` for N < 1) executes
     * zero times and returns an invalid `#R001` (programmer error).
     */
    protected async evaluateRetryBlock(
      node: RetryBlockNode
    ): Promise<RillValue> {
      const onCodes = resolveOnCodes(node.onCodes);

      // AC-B2: a synthesised RetryBlock with attempts <= 0 executes zero times and yields
      // an invalid `#R001` fallback. The body never runs; the returned
      // value carries a single `guard-caught` frame so traces still
      // reflect that recovery was attempted and no body ran.
      if (node.attempts < RETRY_MIN_ATTEMPTS) {
        const site = formatAccessSite(
          this.getNodeLocation(node),
          this.ctx.sourceId
        );
        // Empty-dict base carries the sidecar; primitives cannot hold
        // status metadata (status.ts#attachStatus) so the invalid
        // fallback materialises as `{}` with an attached `#R001` status.
        const base: RillValue = {};
        const invalid = invalidate(
          base,
          {
            code: 'R001',
            provider: 'retry',
            raw: {
              message: `retry attempts must be >= ${RETRY_MIN_ATTEMPTS}, got ${node.attempts}`,
            },
          },
          createTraceFrame({ site, kind: 'guard-caught', fn: 'retry' })
        );
        return invalid;
      }

      let lastInvalid: RillValue | undefined;
      for (let attempt = 0; attempt < node.attempts; attempt++) {
        try {
          return await (this as unknown as EvaluatorInterface).evaluateBody(
            node.body
          );
        } catch (e) {
          if (e instanceof RuntimeHaltSignal && shouldCatch(e, onCodes)) {
            const frame = createTraceFrame({
              site: formatAccessSite(
                this.getNodeLocation(node),
                this.ctx.sourceId
              ),
              kind: 'guard-caught',
              fn: 'retry',
            });
            // Accumulate frames across attempts: attempt 1 seeds
            // lastInvalid from the thrown value; subsequent attempts
            // append to the running accumulator. AC-E8 requires N
            // guard-caught frames after N exhausted attempts.
            lastInvalid = appendTraceFrame(lastInvalid ?? e.value, frame);
            continue;
          }
          throw e;
        }
      }

      // All attempts exhausted; lastInvalid is populated because the
      // loop ran at least once (RETRY_MIN_ATTEMPTS guards the path).
      return lastInvalid as RillValue;
    }

    /**
     * Evaluate a status probe (`.!`, `.!code`, `.!message`, `.!provider`,
     * `.!trace`, `.!<raw-field>`).
     *
     * Bypasses the access-halt gate: reading the sidecar of an invalid
     * value is the one access site that must NOT halt. Instead, the
     * probe materialises sidecar metadata as an ordinary RillValue.
     *
     * Projection semantics:
     * - bare `.!`         -> bool: `false` when valid, `true` when invalid
     *                        (spec AC-1: `$valid.!` is `false`).
     * - `.!code`          -> `:atom` atom value.
     * - `.!message`       -> string.
     * - `.!provider`      -> string.
     * - `.!trace`         -> list of trace-frame dicts.
     * - `.!<other>`       -> lookup in `status.raw`; missing key yields `""`.
     */
    protected async evaluateStatusProbe(
      node: StatusProbeNode
    ): Promise<RillValue> {
      const target = await (
        this as unknown as EvaluatorInterface
      ).evaluateExpression(node.target);
      const status = getStatus(target);

      if (node.field === undefined) {
        // Bare `.!` — per spec AC-1, `.!` returns `false` on a VALID value
        // and `true` on an INVALID value. Reads directly against the
        // sidecar via `isInvalid` so the probe bypasses the access-halt
        // gate and never allocates when the value is valid.
        void status;
        return isInvalid(target);
      }

      switch (node.field) {
        case 'code':
          return {
            __rill_atom: true,
            atom: status.code,
          } as unknown as RillValue;
        case 'message':
          return status.message;
        case 'provider':
          return status.provider;
        case 'trace': {
          // Surface frames as plain dicts so scripts can iterate them
          // with standard list / field operators.
          return status.trace.map(
            (frame) =>
              ({
                site: frame.site,
                kind: frame.kind,
                fn: frame.fn,
                wrapped: frame.wrapped,
              }) as RillValue
          );
        }
        default: {
          // Provider-specific raw bag; missing keys surface as "" so
          // `.!foo` never halts on a valid or invalid value.
          const raw = status.raw as Record<string, RillValue>;
          const val = raw[node.field];
          return val === undefined ? '' : val;
        }
      }
    }

    /**
     * Evaluate a timeout block.
     *
     * Validates that `node.duration` evaluates to a `duration` value [EC-3].
     * Creates a fresh `AbortController` for the timeout scope, chains it to
     * `ctx.signal` via `AbortSignal.any` so either side can cancel. Arms a
     * `setTimeout` (total) or idle-tick (idle) timer via `ctx.scheduler` when
     * injected, falling back to the global scheduler [IR-1, IR-2].
     *
     * On expiry: the chained controller is aborted and a catchable
     * `RuntimeHaltSignal` carrying `#TIMEOUT_TOTAL` or `#TIMEOUT_IDLE` is
     * thrown [EC-1, EC-2]. The host body runs under the chained signal so
     * cooperative host functions observing `ctx.signal` halt naturally.
     *
     * Non-catchable halts (RILL_R010, error, assert) and ControlSignal
     * subclasses propagate through unchanged [EC-5, §NOD.10.4].
     */
    protected async evaluateTimeoutBlock(
      node: TimeoutBlockNode
    ): Promise<RillValue> {
      // Evaluate the duration expression and validate its type [EC-3].
      const durationValue = await (
        this as unknown as EvaluatorInterface
      ).evaluateExpression(node.duration);

      if (!isDuration(durationValue)) {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'timeout',
          },
          'INVALID_INPUT',
          `timeout<${node.kind}:> duration must be a duration value, got ${inferType(durationValue)}`
        );
      }

      // Extract millisecond value from the validated duration.
      const dur = durationValue as RillDuration;
      const durationMs = dur.ms;

      // Build a fresh controller for this timeout scope; chain it to the
      // parent signal (if present) so either side can terminate the body.
      const controller = new AbortController();
      const parentSignal = this.ctx.signal;
      const signalsToChain: AbortSignal[] = parentSignal
        ? [controller.signal, parentSignal]
        : [controller.signal];
      const chainedSignal = AbortSignal.any(signalsToChain);

      // Save ctx.signal and replace it with the chained signal for the body
      // execution so host functions observing ctx.signal see abort correctly.
      const savedSignal = this.ctx.signal;
      (this.ctx as { signal: AbortSignal | undefined }).signal = chainedSignal;

      const site = {
        location: this.getNodeLocation(node),
        sourceId: this.ctx.sourceId,
        fn: 'timeout',
      };

      const sched = this.ctx.scheduler ?? globalScheduler;
      let timerHandle: ReturnType<typeof setTimeout> | undefined;
      let idleTicker: { reset(): void; cancel(): void } | undefined;
      let expired = false;

      // Callback that fires on expiry; produces the halt signal.
      const onExpire = (): void => {
        expired = true;
        controller.abort();
      };

      try {
        if (node.kind === 'total') {
          // Wall-time bound: single setTimeout for the full duration.
          timerHandle = sched.setTimeout(onExpire, durationMs);
        } else {
          // Idle bound: idle-tick helper resets on each body chunk.
          // The idle ticker is created here; the body must call
          // ticker.reset() on each yielded chunk (future task 2.3
          // wires the stream path). For non-stream bodies the timer
          // fires if the body does not complete within idleMs.
          idleTicker = createIdleTicker({
            ctx: this.ctx,
            idleMs: durationMs,
            onIdle: onExpire,
          });
        }

        const result = await (
          this as unknown as EvaluatorInterface
        ).evaluateBody(node.body);

        // The body may complete after the timer fires (e.g. host code
        // ignores ctx.signal). Surface the timeout halt rather than the
        // late result so expiry is enforced consistently.
        if (expired) {
          const atomCode =
            node.kind === 'total' ? TIMEOUT_TOTAL_ATOM : TIMEOUT_IDLE_ATOM;
          throwCatchableHostHalt(
            site,
            atomCode,
            `timeout<${node.kind}:> exceeded after ${durationMs}ms`,
            { durationMs }
          );
        }

        return result;
      } catch (e) {
        // Re-throw ControlSignal subclasses (break/return/yield) and
        // non-catchable RuntimeHaltSignals unconditionally [§NOD.10.4].
        if (e instanceof ControlSignal) throw e;
        if (e instanceof RuntimeHaltSignal && !e.catchable) throw e;

        // If the controller was aborted due to our timer, produce the
        // timeout invalid value. If the parent signal aborted (not us),
        // re-throw the original error to preserve abort semantics.
        if (expired) {
          const atomCode =
            node.kind === 'total' ? TIMEOUT_TOTAL_ATOM : TIMEOUT_IDLE_ATOM;
          throwCatchableHostHalt(
            site,
            atomCode,
            `timeout<${node.kind}:> exceeded after ${durationMs}ms`,
            { durationMs }
          );
        }

        // Otherwise re-throw (e.g. catchable halt from body, or parent abort).
        throw e;
      } finally {
        // Always restore the original signal and clean up timers.
        (this.ctx as { signal: AbortSignal | undefined }).signal = savedSignal;
        sched.clearTimeout(timerHandle);
        idleTicker?.cancel();
      }
    }
  };
}

// ============================================================
// SCHEDULER
// ============================================================

const globalScheduler: TimeoutScheduler = {
  setTimeout(fn, ms) {
    return setTimeout(fn, ms);
  },
  clearTimeout(handle) {
    clearTimeout(handle);
  },
};

// ============================================================
// IDLE-TICK HELPER
// ============================================================

/**
 * Creates an idle-tick scheduler that fires a callback when no activity
 * occurs within `idleMs` milliseconds.
 *
 * Uses `ctx.scheduler` when injected (enables fake-timer test determinism),
 * falling back to the global scheduler. Lifetime is chained to `ctx.signal`:
 * if the parent signal aborts, the idle timer is cancelled automatically.
 *
 * Usage pattern:
 * 1. Call `createIdleTicker` to arm the initial idle timer.
 * 2. Call `ticker.reset()` whenever an activity chunk arrives to restart
 *    the idle window.
 * 3. Call `ticker.cancel()` when the body completes successfully to
 *    prevent the callback from firing after the fact.
 *
 * @param args.ctx       RuntimeContext supplying `signal` and optionally `scheduler`.
 * @param args.idleMs    Idle window in milliseconds.
 * @param args.onIdle    Callback invoked once when the idle window expires.
 * @returns `{ reset, cancel }` control handle.
 */
function createIdleTicker(args: {
  ctx: Pick<RuntimeContext, 'signal' | 'scheduler'>;
  idleMs: number;
  onIdle: () => void;
}): { reset(): void; cancel(): void } {
  const { ctx, idleMs, onIdle } = args;
  const sched = ctx.scheduler ?? globalScheduler;

  let handle: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let abortListener: (() => void) | undefined;

  function arm(): void {
    handle = sched.setTimeout(() => {
      if (!cancelled && !ctx.signal?.aborted) {
        onIdle();
      }
    }, idleMs);
  }

  function detachAbortListener(): void {
    if (abortListener && ctx.signal) {
      ctx.signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    }
  }

  // Abort the idle timer when the parent signal fires. Capture the listener
  // so cancel() can detach it; otherwise long-lived signals (e.g. shared
  // across many timeout blocks) accumulate one listener per ticker.
  if (ctx.signal && !ctx.signal.aborted) {
    abortListener = (): void => {
      cancelled = true;
      sched.clearTimeout(handle);
      detachAbortListener();
    };
    ctx.signal.addEventListener('abort', abortListener, { once: true });
  }

  arm();

  return {
    reset(): void {
      if (cancelled) return;
      sched.clearTimeout(handle);
      arm();
    },
    cancel(): void {
      cancelled = true;
      sched.clearTimeout(handle);
      detachAbortListener();
    },
  };
}

// ============================================================
// TIMEOUT BLOCK EVALUATOR
// ============================================================

/**
 * Atom name for total wall-time timeout (underscore form for resolveAtom).
 * Paired with RILL-R082 in error-registry.ts.
 */
const TIMEOUT_TOTAL_ATOM = ERROR_ATOMS[ERROR_IDS.RILL_R082];

/**
 * Atom name for idle inactivity timeout (underscore form for resolveAtom).
 * Paired with RILL-R083 in error-registry.ts.
 */
const TIMEOUT_IDLE_ATOM = ERROR_ATOMS[ERROR_IDS.RILL_R083];

// Export with type assertion to work around TS4094 limitation.
// TypeScript cannot generate declarations for functions returning
// classes with protected members; the cast matches the convention
// established by AnnotationsMixin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RecoveryMixin = createRecoveryMixin as any;

/**
 * Capability fragment: methods contributed by RecoveryMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type RecoveryMixinCapability = {
  evaluateGuardBlock(node: GuardBlockNode): Promise<RillValue>;
  evaluateRetryBlock(node: RetryBlockNode): Promise<RillValue>;
  evaluateStatusProbe(node: StatusProbeNode): Promise<RillValue>;
  evaluateTimeoutBlock(node: TimeoutBlockNode): Promise<RillValue>;
};
