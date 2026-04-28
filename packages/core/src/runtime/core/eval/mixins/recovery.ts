/**
 * RecoveryMixin: Guard / Retry Blocks and Status Probes
 *
 * Provides evaluator methods for the three recovery-related AST nodes:
 * - `GuardBlock` (`guard { body }` / `guard<on: [...]> { body }`)
 * - `RetryBlock` (`retry<limit: N> { body }` / `retry<limit: N, on: [...]> { body }`)
 * - `StatusProbe` (`$x.!`, `$x.!code`, `$x.!message`, ...)
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
 *
 * Wiring into the evaluator base (node-type dispatch) is owned by task
 * 2.2; this task only publishes the mixin.
 *
 * @internal
 */

import type {
  AtomLiteralNode,
  GuardBlockNode,
  RetryBlockNode,
  StatusProbeNode,
} from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
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
  };
}

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
};
