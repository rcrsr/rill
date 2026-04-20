/**
 * Trace Frame primitives for error-handling sidecar.
 *
 * A TraceFrame records one boundary event (halt, catch, rethrow, wrap)
 * along the lifecycle of an invalid RillValue. Frames are append-only:
 * origin first, latest last. Guards may add frames but never rewrite or
 * erase prior frames.
 *
 * Authored as a plain, frozen record produced by runtime sites (host
 * invalidation, type coercion, access, guard, wrap). This module owns
 * only the type surface and a small append helper.
 */

import type { RillValue } from './structures.js';

// ============================================================
// TRACE KIND
// ============================================================

/**
 * Normative 6-kind enum for trace frame classification.
 *
 * - `host`            Extension calls `ctx.invalidate`. First frame.
 * - `type`            Type assertion or conversion fails.
 * - `access`          Invalid value is accessed (pipe, method, encode, etc.).
 * - `guard-caught`    A `guard` block catches the halt.
 * - `guard-rethrow`   A caught invalid is re-accessed and halts again.
 * - `wrap`            `error "..."` wraps an invalid value. `wrapped` carries
 *                     prior status dict.
 */
export const TRACE_KINDS = {
  HOST: 'host',
  TYPE: 'type',
  ACCESS: 'access',
  GUARD_CAUGHT: 'guard-caught',
  GUARD_RETHROW: 'guard-rethrow',
  WRAP: 'wrap',
} as const;

export type TraceKind =
  | 'host'
  | 'type'
  | 'access'
  | 'guard-caught'
  | 'guard-rethrow'
  | 'wrap';

// ============================================================
// TRACE FRAME
// ============================================================

/**
 * One entry in the append-only trace chain on an invalid value.
 *
 * | Field    | Constraint                                                  |
 * | site     | Source location in `file.rill:line[:col]` form              |
 * | kind     | One of TRACE_KINDS                                          |
 * | fn       | Host fn name, operator, or type op; `""` when not applicable |
 * | wrapped  | Prior status dict; `{}` except on `wrap` frames             |
 */
export interface TraceFrame {
  readonly site: string;
  readonly kind: TraceKind;
  readonly fn: string;
  readonly wrapped: Readonly<Record<string, RillValue>>;
}

// ============================================================
// FROZEN DEFAULTS
// ============================================================

const EMPTY_WRAPPED: Readonly<Record<string, RillValue>> = Object.freeze({});

// ============================================================
// BUILDERS
// ============================================================

/**
 * Construct a new frozen TraceFrame with normalized defaults.
 *
 * When `wrapped` is omitted or empty, reuses the frozen empty singleton
 * so non-wrap frames never allocate a fresh wrapped object.
 */
export function createTraceFrame(args: {
  site: string;
  kind: TraceKind;
  fn?: string;
  wrapped?: Readonly<Record<string, RillValue>>;
}): TraceFrame {
  const fn = args.fn ?? '';
  const wrapped = args.wrapped ?? EMPTY_WRAPPED;
  return Object.freeze({
    site: args.site,
    kind: args.kind,
    fn,
    wrapped,
  });
}

/**
 * Append `frame` to `frames`, returning a new frozen array.
 *
 * Order preserved: origin first, latest last. Prior frames are referenced
 * (not cloned) per NFR-ERR-3; the returned array is frozen.
 */
export function appendFrame(
  frames: ReadonlyArray<TraceFrame>,
  frame: TraceFrame
): ReadonlyArray<TraceFrame> {
  const next = frames.slice();
  next.push(frame);
  return Object.freeze(next);
}
