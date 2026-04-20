/**
 * AccessMixin: Centralised Access-Halt Gate
 *
 * Provides the gate helper that every invalid-value access site routes
 * through. When a RillValue carries a non-`#ok` status sidecar
 * (`isInvalid(value) === true`), any of the following access sites must
 * call this gate to convert the implicit halt into an explicit runtime
 * halt signal:
 *
 * - pipe (`$invalid -> ...`)
 * - field projection (`$invalid.field`)
 * - index access (`$invalid[0]`)
 * - arithmetic / comparison
 * - spread (`...$invalid`)
 * - function argument (`fn($invalid)`)
 *
 * The gate appends an `access`-kind TraceFrame to the value's status
 * sidecar and throws a catchable `RuntimeHaltSignal`. Guard / retry
 * blocks catch the signal and recover the invalid value; any other
 * frame lets the signal propagate.
 *
 * Interface requirements (from spec FR-ERR-14, EC-7):
 * - Access on invalid value halts (catchable by guard / retry).
 * - Status-probe sites (`.!`, `.!field`) bypass the gate entirely.
 *
 * Wiring into the evaluator base (pipe / field / index / spread / arg /
 * arith call sites) is owned by task 2.2; this task only exports the
 * gate helper and the halt-signal type.
 *
 * @internal
 */

import type { SourceLocation } from '../../../../types.js';
import {
  STATUS_SYM,
  appendTraceFrame,
  isInvalid,
  type RillStatus,
} from '../../types/status.js';
import { createTraceFrame } from '../../types/trace.js';
import { RuntimeHaltSignal } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';

// ============================================================
// RUNTIME HALT SIGNAL (re-exported from types/halt.ts)
// ============================================================

/**
 * `RuntimeHaltSignal` is re-exported so existing imports from this
 * module continue to compile. The canonical definition lives in
 * `types/halt.ts` (the type-layer primitive shared with the type-halt
 * builder used by evaluator mixins and standalone type helpers).
 */
export { RuntimeHaltSignal };

// ============================================================
// GATE HELPERS
// ============================================================

/**
 * Describes the access site for trace-frame population.
 *
 * `fn` is free-form: operator symbol (`"->"`, `"."`, `"[]"`, `"..."`,
 * `"+"`), host fn name, or method name. Empty string when not
 * applicable; matches the TraceFrame.fn contract.
 */
export interface AccessSite {
  readonly location?: SourceLocation | undefined;
  readonly sourceId?: string | undefined;
  readonly fn: string;
}

/**
 * Formats a source location into `file:line:col` form, matching the
 * TraceFrame.site contract. Used by the access gate to populate
 * `access` frames.
 *
 * Falls back to `"<unknown>"` when no location is available (e.g.,
 * synthesized nodes). `sourceId` defaults to `"<script>"` when the
 * runtime context did not supply one.
 */
export function formatAccessSite(
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
 * Access-halt gate. Routes every access on a potentially-invalid
 * RillValue through a single chokepoint.
 *
 * Contract:
 * - Valid input (`isInvalid(value) === false`): returns `value`
 *   unchanged, zero allocations.
 * - Invalid input: appends an `access`-kind TraceFrame and throws a
 *   catchable `RuntimeHaltSignal` carrying the extended invalid value.
 *
 * Callers supply the access site (location, sourceId, fn) so the frame
 * reports the precise operator / host fn that triggered the halt.
 */
export function accessHaltGate(value: RillValue, site: AccessSite): RillValue {
  if (!isInvalid(value)) {
    return value;
  }
  const frame = createTraceFrame({
    site: formatAccessSite(site.location, site.sourceId),
    kind: 'access',
    fn: site.fn,
  });
  const next = appendTraceFrame(value, frame);
  throw new RuntimeHaltSignal(next, true);
}

/**
 * Hot-path variant of {@link accessHaltGate}.
 *
 * The valid-path body is inlined: a single property read against the
 * Symbol-keyed sidecar. When no sidecar is present (the overwhelming
 * majority of runtime values on NFR-ERR-1 benchmarks), the value is
 * returned immediately with zero allocations. Only the slow path
 * constructs the `AccessSite` record and invokes `formatAccessSite`.
 *
 * Callers that cannot defer site construction (e.g. sites needing the
 * AccessSite regardless of validity) should use {@link accessHaltGate}.
 *
 * @param value - Value to gate.
 * @param fn - Operator symbol / host fn name / `"arg"` / `"..."` — see
 *             {@link AccessSite} for the contract.
 * @param locFn - Lazy producer of the source location (deferred to the
 *                slow path; not invoked on valid values).
 */
export function accessHaltGateFast(
  value: RillValue,
  fn: string,
  locFn: () => SourceLocation | undefined,
  sourceId: string | undefined
): RillValue {
  // Fast path: inline the symbol-keyed probe. Primitives (string /
  // number / boolean / null) and any object without the sidecar symbol
  // fall through immediately.
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { [STATUS_SYM]?: RillStatus })[STATUS_SYM] === undefined
  ) {
    return value;
  }
  // Slow path: full gate semantics. Re-check validity via `isInvalid`
  // because a sidecar may carry `#ok` after guard/retry recovery.
  if (!isInvalid(value)) {
    return value;
  }
  const frame = createTraceFrame({
    site: formatAccessSite(locFn(), sourceId),
    kind: 'access',
    fn,
  });
  const next = appendTraceFrame(value, frame);
  throw new RuntimeHaltSignal(next, true);
}

/**
 * Out-of-line slow-path helper for inlined access-halt probes (RI-4).
 *
 * Call sites in hot loops (e.g. `evaluateBinaryExpr` arithmetic branch)
 * inline the Symbol-keyed sidecar probe directly, avoiding the arrow
 * closure allocation required by {@link accessHaltGateFast}'s `locFn`
 * parameter. When the inlined probe detects a sidecar, it invokes this
 * helper to perform the full halt semantics.
 *
 * Contract: callers guarantee `value` carries a `STATUS_SYM` sidecar.
 * This helper re-checks validity via `isInvalid` (guard/retry recovery
 * may have reset the code to `#ok`) before allocating the trace frame.
 *
 * The helper reads `node.span.start` itself and constructs the
 * `AccessSite` inline; no additional closures are allocated in the slow
 * branch versus the canonical gate.
 */
export function haltSlowPath(
  value: RillValue,
  fn: string,
  node: { readonly span: { readonly start: SourceLocation } },
  sourceId: string | undefined
): RillValue {
  // A sidecar may carry `#ok` after guard/retry recovery; re-check
  // before paying for frame allocation.
  if (!isInvalid(value)) {
    return value;
  }
  const frame = createTraceFrame({
    site: formatAccessSite(node.span.start, sourceId),
    kind: 'access',
    fn,
  });
  const next = appendTraceFrame(value, frame);
  throw new RuntimeHaltSignal(next, true);
}
