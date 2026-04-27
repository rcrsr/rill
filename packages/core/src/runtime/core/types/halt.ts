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
import { appendTraceFrame, getStatus, invalidate } from './status.js';
import { atomName } from './atom-registry.js';
import { createTraceFrame, TRACE_KINDS, type TraceKind } from './trace.js';
import type { RillValue } from './structures.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';

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
function formatSite(
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

// ============================================================
// ABORT HALT BUILDER (IR-1)
// ============================================================

/**
 * Build an invalid RillValue representing an aborted execution, then
 * throw a non-catchable `RuntimeHaltSignal` wrapping it.
 *
 * Emits the `#DISPOSED` atom with `provider="runtime"` and a single
 * `host`-kind trace frame. Callers (typically `checkAborted` on the
 * evaluator base) set `site.fn = "checkAborted"`.
 *
 * Per TD-2, abort halts are non-catchable: guard and retry must not
 * recover them. The builder allocates only when thrown; it is not on
 * the hot path and runs only when abort is detected.
 *
 * @throws RuntimeHaltSignal with code=`#DISPOSED`, catchable=false.
 */
export function throwAbortHalt(site: TypeHaltSite): never {
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  const invalid = invalidate(
    {},
    {
      code: 'DISPOSED',
      provider: 'runtime',
      raw: { message: 'aborted' },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, false);
}

// ============================================================
// AUTO-EXCEPTION HALT BUILDER (IR-2)
// ============================================================

/**
 * Build an invalid RillValue representing an auto-exception pattern
 * match, then throw a non-catchable `RuntimeHaltSignal` wrapping it.
 *
 * Emits the `#R999` atom with `provider="extension"` and a single
 * `host`-kind trace frame. Callers (typically `checkAutoExceptions` on
 * the evaluator base) set `site.fn = "checkAutoExceptions"`.
 *
 * The human-readable message is derived from `pattern` and
 * `matchedValue`; callers do not format it.
 *
 * Caller responsibility (EC-3): the builder does not validate inputs.
 * `pattern` MUST be a non-empty string (the regex source) and
 * `matchedValue` MUST be a string, because auto-exceptions fire only on
 * string pipe values. Violating these preconditions yields a
 * degenerate but still well-formed invalid.
 *
 * @param site            Site descriptor (location, sourceId, fn).
 * @param pattern         Regex source that matched (non-empty string).
 * @param matchedValue    String value that triggered the match.
 * @throws RuntimeHaltSignal with code=`#R999`, catchable=false.
 */
export function throwAutoExceptionHalt(
  site: TypeHaltSite,
  pattern: string,
  matchedValue: string
): never {
  const message = `auto-exception: pattern ${pattern} matched ${JSON.stringify(matchedValue)}`;
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  const invalid = invalidate(
    {},
    {
      code: 'R999',
      provider: 'extension',
      raw: { message, pattern, matchedValue },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, false);
}

// ============================================================
// CATCHABLE HOST HALT BUILDER (IR-3)
// ============================================================

/**
 * Build an invalid RillValue for a user-recoverable evaluator failure, then
 * throw a catchable `RuntimeHaltSignal` wrapping it.
 *
 * Use this builder for runtime errors that a script can recover via `guard`
 * or `retry` — for example: unknown function/variable/method, type mismatches
 * on call arguments, invalid access on a non-dict, callable not found, and
 * similar operator-level failures where the user may reasonably handle the
 * bad path.
 *
 * Emits a `host`-kind trace frame with `provider="runtime"`. The atom is
 * resolved from `code`; unregistered codes fall back to `#R001` (never
 * throw). Phase 2 tasks register per-code atoms and extend
 * `HALT_ATOM_TO_ERROR_ID` in `execute.ts` so escaped halts surface as
 * properly-coded `RuntimeError` instances.
 *
 * `raw` accepts arbitrary provider metadata; `message` is stored under
 * `raw.message` so `.!message` surfaces it. Additional fields flow through
 * untouched.
 *
 * @param site      Site descriptor (location, sourceId, fn).
 * @param code      Atom name in underscore form (e.g. `"RILL_R006"`).
 * @param message   Human-readable error description.
 * @param raw       Optional provider-specific payload (merged with message).
 * @throws RuntimeHaltSignal with catchable=true.
 */
export function throwCatchableHostHalt(
  site: TypeHaltSite,
  code: string,
  message: string,
  raw?: Record<string, unknown>
): never {
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  const invalid = invalidate(
    {},
    {
      code,
      provider: 'runtime',
      raw: { message, ...(raw ?? {}) },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, true);
}

// ============================================================
// FATAL HOST HALT BUILDER (IR-3)
// ============================================================

/**
 * Build an invalid RillValue for a non-recoverable evaluator failure, then
 * throw a non-catchable `RuntimeHaltSignal` wrapping it.
 *
 * Use this builder for fatal runtime errors that must not be caught by
 * `guard` or `retry` — for example: iteration limit exceeded, script
 * produced no value, removed frontmatter keys, internal invariant
 * violations, and similar conditions where allowing recovery would mask
 * programmer errors or leave execution in an undefined state.
 *
 * Emits a `host`-kind trace frame with `provider="runtime"`. The atom is
 * resolved from `code`; unregistered codes fall back to `#R001` (never
 * throw). Phase 2 tasks register per-code atoms and extend
 * `HALT_ATOM_TO_ERROR_ID` in `execute.ts`.
 *
 * `raw` accepts arbitrary provider metadata; `message` is stored under
 * `raw.message` so `.!message` surfaces it.
 *
 * @param site      Site descriptor (location, sourceId, fn).
 * @param code      Atom name in underscore form (e.g. `"RILL_R010"`).
 * @param message   Human-readable error description.
 * @param raw       Optional provider-specific payload (merged with message).
 * @throws RuntimeHaltSignal with catchable=false.
 */
export function throwFatalHostHalt(
  site: TypeHaltSite,
  code: string,
  message: string,
  raw?: Record<string, unknown>
): never {
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  const invalid = invalidate(
    {},
    {
      code,
      provider: 'runtime',
      raw: { message, ...(raw ?? {}) },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, false);
}

// ============================================================
// ERROR WRAP HALT BUILDER (IR-3)
// ============================================================

/**
 * Build an invalid RillValue for an `error "..."` statement, then throw
 * a non-catchable `RuntimeHaltSignal` wrapping it (NFR-HSM-7).
 *
 * Emits the `#RILL_R016` atom with `provider="runtime"` and always
 * appends one `host`-kind trace frame via `invalidate`. Callers
 * (typically `evaluateError`) set `site.fn = "evaluateError"`.
 *
 * Atom name uses underscore form (`RILL_R016`) per ATOM_NAME_REGEX
 * (atom-registry.ts:21). The host-facing error ID `RILL-R016` in
 * `error-registry.ts` is a separate string namespace.
 *
 * When `interpolated === true`, additionally appends a `wrap`-kind
 * frame whose `wrapped` field carries the prior status dict of the
 * invalid (code, message, provider, raw). This preserves the pre-wrap
 * status so `.!trace` consumers can introspect what was wrapped when
 * the error message was built from an interpolated string.
 *
 * When `interpolated === false`, no wrap frame is appended; the trace
 * carries only the standard host frame.
 *
 * @param site           Site descriptor (location, sourceId, fn).
 * @param message        Already-evaluated error message string.
 * @param interpolated   True when the source message used interpolation.
 * @throws RuntimeHaltSignal with code=`#RILL_R016`, catchable=false.
 */
export function throwErrorHalt(
  site: TypeHaltSite,
  message: string,
  interpolated: boolean
): never {
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  let invalid = invalidate(
    {},
    {
      code: ERROR_ATOMS[ERROR_IDS.RILL_R016],
      provider: 'runtime',
      raw: { message },
    },
    frame
  );
  if (interpolated) {
    const priorStatus = getStatus(invalid);
    const wrappedDict: Readonly<Record<string, RillValue>> = Object.freeze({
      code: atomName(priorStatus.code),
      message: priorStatus.message,
      provider: priorStatus.provider,
      raw: priorStatus.raw as RillValue,
    });
    const wrapFrame = createTraceFrame({
      site: formatSite(site.location, site.sourceId),
      kind: TRACE_KINDS.WRAP,
      fn: site.fn,
      wrapped: wrappedDict,
    });
    invalid = appendTraceFrame(invalid, wrapFrame);
  }
  throw new RuntimeHaltSignal(invalid, false);
}
