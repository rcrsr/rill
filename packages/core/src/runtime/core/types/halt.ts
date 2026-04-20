/**
 * Runtime Halt Signal and Type-Halt Builder
 *
 * Low-level primitives shared by the access-halt gate, the evaluator
 * mixins, and the standalone type-layer helpers. Living in `types/`
 * keeps the signal class reachable from `types/operations.ts` and
 * `types/registrations.ts` without creating a layer inversion.
 *
 * `RuntimeHaltSignal` carries an invalid `RillValue` as its payload and
 * is thrown by:
 *   - the access-halt gate when an access site reads an invalid value,
 *   - the evaluator mixins when a type assertion / conversion / check
 *     fails and must surface as a typed-atom invalid (FR-ERR-17).
 *
 * `throwTypeHalt` is the canonical constructor for type-assertion halts
 * produced by evaluator mixins and type-layer helpers. It builds the
 * invalid value via `invalidate`, appends a `type` trace frame, and
 * throws a catchable `RuntimeHaltSignal` so `guard` / `retry` may
 * recover the invalid (spec FR-ERR-17, DEC-11).
 */

import type { SourceLocation } from '../../../types.js';
import { invalidate } from './status.js';
import { createTraceFrame, type TraceKind } from './trace.js';
import type { RillValue } from './structures.js';

// ============================================================
// RUNTIME HALT SIGNAL
// ============================================================

/**
 * Thrown by the access gate and by evaluator / type-layer helpers to
 * halt evaluation. Carries the invalid RillValue as its payload.
 *
 * `catchable` distinguishes recoverable halts (access-gate halts and
 * operational type failures) from programmer-error halts (`error`,
 * `assert`, per FR-ERR-10 / FR-ERR-11). Guard and retry only catch
 * signals with `catchable === true`; non-catchable halts propagate
 * through recovery blocks unconditionally.
 */
export class RuntimeHaltSignal extends Error {
  readonly value: RillValue;
  readonly catchable: boolean;

  constructor(value: RillValue, catchable: boolean) {
    super('runtime halt');
    this.name = 'RuntimeHaltSignal';
    this.value = value;
    this.catchable = catchable;
  }
}

// ============================================================
// SITE FORMATTING
// ============================================================

/**
 * Formats a source location into `file:line:col` form, matching the
 * `TraceFrame.site` contract. Falls back to `"<unknown>"` when no
 * location is available (synthesized nodes, type-layer helpers).
 * `sourceId` defaults to `"<script>"` when the runtime context did not
 * supply one.
 */
export function formatSite(
  location: SourceLocation | undefined,
  sourceId: string | undefined
): string {
  if (location === undefined) {
    return sourceId ?? '<unknown>';
  }
  const file = sourceId ?? '<script>';
  return `${file}:${location.line}:${location.column}`;
}

// ============================================================
// TYPE-HALT BUILDER
// ============================================================

/**
 * Site descriptor used by `throwTypeHalt`.
 *
 * `fn` is free-form: operator symbol (`"->"`, `":"`, `":?"`), host fn
 * name, type-op name (`"assertType"`, `"convert"`, `"deserialize"`),
 * or empty string when not applicable.
 */
export interface TypeHaltSite {
  readonly location?: SourceLocation | undefined;
  readonly sourceId?: string | undefined;
  readonly fn: string;
}

/**
 * Build an invalid RillValue carrying a typed atom and a trace frame,
 * then throw a catchable `RuntimeHaltSignal` wrapping it (FR-ERR-17).
 *
 * `code` names the atom (e.g. `"TYPE_MISMATCH"`, `"INVALID_INPUT"`).
 * `kind` selects the trace-frame kind; defaults to `"type"` because the
 * overwhelming majority of sites are type-assertion / conversion
 * failures. Sites that describe parse-time invariants (unsupported
 * expression types, missing operands) pass `"host"`.
 *
 * `raw` accepts arbitrary provider metadata; `message` is stored under
 * `raw.message` so `.!message` surfaces it. Additional fields (such as
 * `expectedType`, `actualType`) flow through untouched.
 */
export function throwTypeHalt(
  site: TypeHaltSite,
  code: string,
  message: string,
  provider: string,
  raw?: Record<string, unknown>,
  kind: TraceKind = 'type'
): never {
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind,
    fn: site.fn,
  });
  const invalid = invalidate(
    {},
    {
      code,
      provider,
      raw: { message, ...(raw ?? {}) },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, true);
}
