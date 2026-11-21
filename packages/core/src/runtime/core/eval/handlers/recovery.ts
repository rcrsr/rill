/**
 * Guard / Retry Blocks, Status Probes, and Timeout Blocks
 *
 * Provides evaluator methods for the four recovery-related AST nodes:
 * - `GuardBlock` (`guard { body }` / `guard(on: list[...]) { body }`)
 * - `RetryBlock` (`retry(attempts: N) { body }` / `retry(attempts: N, on: list[...]) { body }`)
 * - `StatusProbe` (`$x.!`, `$x.!code`, `$x.!message`, ...)
 * - `TimeoutBlock` (`timeout(total: d, idle: d) { body }`, either or both limits)
 *
 * Interface requirements:
 * - Guard catches `RuntimeHaltSignal` at block boundary, appends a
 *   `guard-caught` trace frame, returns the invalid value as block
 *   result.
 * - `retry(attempts: N)` re-enters its body on caught halt up to N attempts;
 *   appends one `guard-caught` frame per failed attempt.
 * - `on:` filter: non-matching halts propagate (NOT caught).
 * - Options run once per statement run, before the body, so neither guard
 *   nor retry catches a halt its own options raise.
 * - Status probes bypass the access-halt gate and read the sidecar
 *   directly.
 * - `error "..."` and `assert` raise non-catchable halts: guard /
 *   retry re-throw them unconditionally.
 * - TimeoutBlock creates a fresh AbortController, chains it to ctx.signal,
 *   arms a wall-time (total) and/or idle-tick (idle) timer, and on expiry
 *   aborts the controller and throws a catchable halt carrying
 *   #RILL_R082 (total) or #RILL_R083 (idle).
 *
 * @internal
 */

import type {
  GuardBlockNode,
  RetryBlockNode,
  StatusProbeNode,
  TimeoutBlockNode,
} from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { getStatus, appendTraceFrame, isInvalid } from '../../types/status.js';
import { createTraceFrame } from '../../types/trace.js';
import { atomName, toAtomValue } from '../../types/atom-registry.js';
import type { EvalState } from '../state.js';
import type { Carried } from '../../types/declared.js';
import { STATUS_CODE_STRUCTURE } from '../../types/error-code.js';
import { RuntimeHaltSignal, formatAccessSite } from './access.js';
import {
  requireFixedDuration,
  requireTimerDelay,
} from '../../types/duration-limit.js';
import {
  getHostShape,
  throwAbortHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import {
  ERROR_IDS,
  ERROR_ATOMS,
  ERROR_REGISTRY,
  renderMessage,
} from '../../../../error-registry.js';
import type { RuntimeContext } from '../../types/runtime.js';
import { ControlSignal } from '../../signals.js';
import {
  getNodeLocation,
  checkAborted,
  maybeYield,
  defaultScheduler,
} from '../shared.js';
import { evaluateBody } from './control-flow.js';
import { evaluateExpression } from './core.js';
import { evaluateConstructOptions } from './construct-options.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns true when `signal` is catchable AND its invalid value's
 * status code matches the `on` filter (or the filter is absent).
 *
 * Non-catchable halts (from `error` / `assert`) never match.
 */
function shouldCatch(
  signal: RuntimeHaltSignal,
  on: ReadonlySet<string> | undefined
): boolean {
  if (!signal.catchable) return false;
  if (on === undefined) return true;
  const status = getStatus(signal.value);
  return on.has(status.code.name);
}

/**
 * Evaluate a guard block.
 *
 * Runs the body once. On a catchable halt whose code matches the
 * optional `on` filter, appends a `guard-caught` trace frame
 * and returns the invalid value as the block result. Non-matching
 * halts and non-catchable halts (error / assert) propagate.
 */
export async function evaluateGuardBlock(
  s: EvalState,
  node: GuardBlockNode
): Promise<RillValue> {
  // Outside the try so a halt from the options is never caught here.
  const { on } = await evaluateConstructOptions(s, 'guard', node.options, node);
  try {
    return await evaluateBody(s, node.body);
  } catch (e) {
    if (e instanceof RuntimeHaltSignal && shouldCatch(e, on)) {
      const frame = createTraceFrame({
        site: formatAccessSite(getNodeLocation(s, node), s.ctx.sourceId),
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
 * Re-enters the body up to `attempts` times. Each caught halt that matches
 * the `on` filter appends one `guard-caught` frame to a running invalid value
 * and advances to the next attempt. On success, returns the body's result. If
 * every attempt halts, returns the final invalid value with all N frames.
 *
 * The options are evaluated once, before the first attempt.
 */
export async function evaluateRetryBlock(
  s: EvalState,
  node: RetryBlockNode
): Promise<RillValue> {
  const { on, attempts } = await evaluateConstructOptions(
    s,
    'retry',
    node.options,
    node
  );

  if (attempts === undefined || attempts < 1) {
    // fatal: unreachable, option evaluation requires a positive attempts
    throwFatalHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'retry',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'retry options carry no positive attempts'
    );
  }

  let lastHaltValue: RillValue | undefined;
  const caughtFrames: ReturnType<typeof createTraceFrame>[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Outside the try so an abort halt is never retried.
    checkAborted(s, node);
    const yielded = maybeYield(s, node);
    if (yielded) await yielded;
    try {
      return await evaluateBody(s, node.body);
    } catch (e) {
      if (e instanceof RuntimeHaltSignal && shouldCatch(e, on)) {
        // The returned value must describe the FINAL failure, not the
        // first, so only the raw thrown value (code/message) and a single
        // new frame are recorded per attempt - O(1) work here, not a
        // full replay of every frame collected so far.
        caughtFrames.push(
          createTraceFrame({
            site: formatAccessSite(getNodeLocation(s, node), s.ctx.sourceId),
            kind: 'guard-caught',
            fn: 'retry',
          })
        );
        lastHaltValue = e.value;
        continue;
      }
      throw e;
    }
  }

  // All attempts exhausted; lastHaltValue is populated because the
  // loop ran at least once. Build the
  // final trace once, replaying every guard-caught frame on top of the
  // LAST attempt's thrown value so its code/message win while every
  // attempt's frame is preserved.
  if (lastHaltValue === undefined) {
    // fatal: unreachable, the retry loop runs at least once
    throwFatalHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'retry',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'retry finished without a recorded failure'
    );
  }
  let lastInvalid: RillValue = lastHaltValue;
  for (const f of caughtFrames) {
    lastInvalid = appendTraceFrame(lastInvalid, f);
  }
  return lastInvalid;
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
 *                        (`$valid.!` is `false`).
 * - `.!code`          -> atom value, a member of `union(#ok, error_code)`.
 *                        The declared type is carried: `.!code.^type`
 *                        reports `union(#ok, error_code)`.
 * - `.!message`       -> string.
 * - `.!provider`      -> string.
 * - `.!trace`         -> list of trace-frame dicts.
 * - `.!<other>`       -> lookup in `status.raw`; missing key yields `""`.
 */
export async function evaluateStatusProbe(
  s: EvalState,
  node: StatusProbeNode
): Promise<RillValue> {
  return (await evaluateStatusProbeCarried(s, node)).value;
}

/** Status probe paired with its declared type: only `.!code` carries one. */
export async function evaluateStatusProbeCarried(
  s: EvalState,
  node: StatusProbeNode
): Promise<Carried> {
  const value = await evaluateStatusProbeValue(s, node);
  return {
    value,
    declared: node.field === 'code' ? STATUS_CODE_STRUCTURE : undefined,
  };
}

async function evaluateStatusProbeValue(
  s: EvalState,
  node: StatusProbeNode
): Promise<RillValue> {
  const target = await evaluateExpression(s, node.target);

  if (node.field === undefined) {
    // Bare `.!` returns `false` on a VALID value
    // and `true` on an INVALID value. Reads directly against the
    // sidecar via `isInvalid` so the probe bypasses the access-halt
    // gate and never allocates when the value is valid.
    return isInvalid(target);
  }

  const status = getStatus(target);

  switch (node.field) {
    case 'code':
      return toAtomValue(status.code);
    case 'message':
      return status.message;
    case 'provider':
      return status.provider;
    case 'trace': {
      // Surface frames as plain dicts so scripts can iterate them
      // with standard list / field operators.
      return status.trace.map((frame) => ({
        site: frame.site,
        kind: frame.kind,
        fn: frame.fn,
        wrapped: frame.wrapped,
      }));
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
 * Evaluates `node.options` against the `timeout` options type; each present
 * limit (`total`, `idle`) is a `duration`. Creates a fresh
 * `AbortController` for the timeout scope, chains it to `ctx.signal` via
 * `AbortSignal.any` so either side can cancel. Arms a `setTimeout` (total)
 * and/or idle-tick (idle) timer via `ctx.scheduler` when injected, falling
 * back to the global scheduler. With no limit the body runs unbounded.
 *
 * On expiry: the chained controller is aborted and a catchable
 * `RuntimeHaltSignal` carrying `#RILL_R082` (total) or `#RILL_R083` (idle)
 * is thrown. The first limit to fire wins; total is armed first, so a tie
 * fires total. The host body runs under the chained signal so cooperative
 * host functions observing `ctx.signal` halt naturally.
 *
 * Non-catchable halts (RILL_R010, error, assert) and ControlSignal
 * subclasses propagate through unchanged.
 */
export async function evaluateTimeoutBlock(
  s: EvalState,
  node: TimeoutBlockNode
): Promise<RillValue> {
  const site = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: 'timeout',
  };

  const options = await evaluateConstructOptions(
    s,
    'timeout',
    node.options,
    node
  );
  const limits = new Map<TimeoutLimit, number>();
  for (const limit of TIMEOUT_LIMITS) {
    const value = options[limit];
    if (value === undefined) continue;
    const optionName = `timeout(${limit})`;
    limits.set(
      limit,
      requireTimerDelay(
        requireFixedDuration(value, optionName, site),
        optionName,
        site
      )
    );
  }

  // Build a fresh controller for this timeout scope; chain it to the
  // parent signal (if present) so either side can terminate the body.
  const controller = new AbortController();
  const parentSignal = s.ctx.signal;
  const signalsToChain: AbortSignal[] = parentSignal
    ? [controller.signal, parentSignal]
    : [controller.signal];
  const chainedSignal = AbortSignal.any(signalsToChain);

  // Save ctx.signal and replace it with the chained signal for the body
  // execution so host functions observing ctx.signal see abort correctly.
  const savedSignal = s.ctx.signal;
  (s.ctx as { signal: AbortSignal | undefined }).signal = chainedSignal;

  const sched = s.ctx.scheduler ?? defaultScheduler;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  let idleTicker: { reset(): void; cancel(): void } | undefined;
  const savedListeners = s.ctx.activityListeners;
  let fired: TimeoutLimit | undefined;

  // Records the first limit to fire and aborts the body.
  const onExpire = (limit: TimeoutLimit): void => {
    if (fired !== undefined) return;
    fired = limit;
    controller.abort();
  };

  // Throws the catchable halt for the limit that fired.
  const throwExpiry = (limit: TimeoutLimit): never =>
    throwCatchableHostHalt(
      site,
      TIMEOUT_ATOMS[limit],
      renderMessage(TIMEOUT_TEMPLATES[limit], {
        durationMs: limits.get(limit),
      }),
      { durationMs: limits.get(limit) }
    );

  try {
    const totalMs = limits.get('total');
    if (totalMs !== undefined) {
      // Wall-time bound: single setTimeout for the full duration.
      timerHandle = sched.setTimeout(() => onExpire('total'), totalMs);
    }
    const idleMs = limits.get('idle');
    if (idleMs !== undefined) {
      // Idle bound: the timer fires after idleMs with no activity (a stream
      // chunk arriving or a host call returning).
      idleTicker = createIdleTicker({
        ctx: s.ctx,
        idleMs,
        onIdle: () => onExpire('idle'),
      });
      // Activity anywhere in the body, nested timeouts included, restarts
      // the idle window.
      const ticker = idleTicker;
      // The body sees its own listener set: enclosing timeouts' listeners
      // plus this one. A sibling branch keeps the set it already inherited.
      (s.ctx as { activityListeners: Set<() => void> }).activityListeners =
        new Set([...savedListeners, (): void => ticker.reset()]);
    }

    const result = await evaluateBody(s, node.body);

    // The body may complete after the timer fires (e.g. host code
    // ignores ctx.signal). Surface the timeout halt rather than the
    // late result so expiry is enforced consistently.
    if (fired !== undefined) {
      // A host abort that landed alongside the expiry wins over the timeout.
      if (parentSignal?.aborted === true) throwAbortHalt(site);
      throwExpiry(fired);
    }

    return result;
  } catch (e) {
    // Re-throw ControlSignal subclasses (break/return/yield) and
    // non-catchable RuntimeHaltSignals unconditionally.
    if (e instanceof ControlSignal) throw e;
    // A host or parent abort stays a #DISPOSED halt, even when our own
    // timer also fired.
    if (parentSignal?.aborted === true && isAbortHalt(e)) throw e;
    // Our timer aborted the body: the abort halt becomes the catchable
    // timeout halt instead of the non-catchable #DISPOSED.
    if (fired !== undefined && isAbortHalt(e)) throwExpiry(fired);
    // A halt carrying a host error shape stands in for a RuntimeError, so it
    // takes the expiry path below instead of this fatal rethrow.
    if (
      e instanceof RuntimeHaltSignal &&
      !e.catchable &&
      getHostShape(e.value) === undefined
    ) {
      throw e;
    }

    // If the controller was aborted due to our timer, produce the
    // timeout invalid value.
    if (fired !== undefined) throwExpiry(fired);

    // Otherwise re-throw (e.g. catchable halt from body, or parent abort).
    throw e;
  } finally {
    // Always restore the original signal and clean up timers.
    (s.ctx as { signal: AbortSignal | undefined }).signal = savedSignal;
    sched.clearTimeout(timerHandle);
    (s.ctx as { activityListeners: Set<() => void> }).activityListeners =
      savedListeners;
    idleTicker?.cancel();
  }
}

/**
 * True when `e` is the non-catchable `#DISPOSED` halt raised by `throwAbortHalt`.
 * The runtime provider tag separates it from a host's own disposal failure,
 * and survives the re-wrapping done at host-call boundaries.
 */
function isAbortHalt(e: unknown): boolean {
  if (!(e instanceof RuntimeHaltSignal) || e.catchable) return false;
  const status = getStatus(e.value);
  return atomName(status.code) === 'DISPOSED' && status.provider === 'runtime';
}

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
 * 2. Call `ticker.reset()` on activity (stream chunk or host return) to restart
 *    the idle window.
 * 3. Call `ticker.cancel()` when the body completes successfully to
 *    prevent the callback from firing after the fact.
 *
 * @param args.ctx       RuntimeContext supplying `signal` and optionally `scheduler`.
 * @param args.idleMs    Idle window in milliseconds. Must already pass
 *                       `requireTimerDelay`; a larger delay would fire at once.
 * @param args.onIdle    Callback invoked once when the idle window expires.
 * @returns `{ reset, cancel }` control handle.
 */
function createIdleTicker(args: {
  ctx: Pick<RuntimeContext, 'signal' | 'scheduler'>;
  idleMs: number;
  onIdle: () => void;
}): { reset(): void; cancel(): void } {
  const { ctx, idleMs, onIdle } = args;
  const sched = ctx.scheduler ?? defaultScheduler;

  let handle: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let abortListener: (() => void) | undefined;

  function arm(): void {
    handle = sched.setTimeout(() => {
      if (!cancelled && ctx.signal?.aborted !== true) {
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
 * Timeout limits in arming order: total is armed before idle, so a tie
 * fires total. Each maps to its halt atom (RILL-R082 total, RILL-R083 idle).
 */
const TIMEOUT_ATOMS = {
  total: ERROR_ATOMS[ERROR_IDS.RILL_R082],
  idle: ERROR_ATOMS[ERROR_IDS.RILL_R083],
} as const;

type TimeoutLimit = keyof typeof TIMEOUT_ATOMS;

/** Registry message templates for each timeout limit's expiry halt. */
function templateFor(id: string): string {
  const template = ERROR_REGISTRY.get(id)?.messageTemplate;
  if (template === undefined) {
    throw new TypeError(`Unknown error ID: ${id}`);
  }
  return template;
}

const TIMEOUT_TEMPLATES: Readonly<Record<TimeoutLimit, string>> = {
  total: templateFor(ERROR_IDS.RILL_R082),
  idle: templateFor(ERROR_IDS.RILL_R083),
};

const TIMEOUT_LIMITS: readonly TimeoutLimit[] = ['total', 'idle'];
