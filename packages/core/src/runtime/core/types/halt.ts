/**
 * Runtime Halt Signal and Type-Halt Builder
 *
 * Low-level primitives shared by the access-halt gate, the evaluator
 * handlers, and the standalone type-layer helpers. Living in `types/`
 * keeps the signal class reachable from `types/operations.ts` and
 * `types/registrations.ts` without creating a layer inversion.
 *
 * `RuntimeHaltSignal` carries an invalid `RillValue` as its payload and
 * is thrown by:
 *   - the access-halt gate when an access site reads an invalid value,
 *   - the evaluator handlers when a type assertion / conversion / check
 *     fails and must surface as a typed-atom invalid.
 *
 * `throwTypeHalt` is the canonical constructor for type-assertion halts
 * produced by evaluator handlers and type-layer helpers. It builds the
 * invalid value via `invalidate`, appends a `type` trace frame, and
 * throws a catchable `RuntimeHaltSignal` so `guard` / `retry` may
 * recover the invalid.
 */

import type { SourceLocation } from '../../../types.js';
import {
  appendTraceFrame,
  getStatus,
  invalidate,
  withOriginSite,
} from './status.js';
import { atomName, okAtom } from './atom-registry.js';
import { createTraceFrame, TRACE_KINDS, type TraceKind } from './trace.js';
import type { RillValue } from './structures.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';
import { BreakSignal } from '../signals.js';

// ============================================================
// MESSAGE / ERROR-ID DERIVATION
// ============================================================

/**
 * Lookup table resolving an atom's underscore name (e.g. `RILL_R006`) to
 * its registered hyphen-form host error ID (e.g. `RILL-R006`). `ERROR_IDS`
 * keys are exactly the registered atom names, so a plain index probe is
 * the resolution: generic taxonomy atoms (`TYPE_MISMATCH`, `INVALID_INPUT`)
 * and registry fallbacks (`R001`, `R999`) are not `RILL_*`-prefixed keys
 * and correctly miss, yielding `undefined`.
 */
const ERROR_ID_BY_ATOM_NAME = ERROR_IDS as Readonly<Record<string, string>>;

/**
 * Derives the constructor message for a `RuntimeHaltSignal` from the
 * carried value's status sidecar: `#<ATOM>: <message>` when a message is
 * present, `#<ATOM>` alone otherwise. Falls back to the literal
 * `'runtime halt'` only when the value carries no invalid status at all
 * (the `#ok` sentinel) — a case that should never occur in practice
 * since every halt builder invalidates its payload before throwing.
 */
function deriveHaltMessage(value: RillValue): string {
  const status = getStatus(value);
  if (status.code === okAtom()) return 'runtime halt';
  const name = atomName(status.code);
  return status.message.length > 0 ? `#${name}: ${status.message}` : `#${name}`;
}

/**
 * Resolves the carried value's atom against the full `ERROR_IDS`
 * registry (not `execute.ts`'s `HALT_ATOM_TO_ERROR_ID` allowlist — that
 * table additionally gates which atoms `execute.ts` itself is willing to
 * rematerialise as a `RuntimeError`). Returns `undefined` when the atom
 * has no registered host-facing error ID (generic taxonomy atoms,
 * `#R999`, `#DISPOSED`, and the `#ok` sentinel).
 */
function resolveHaltErrorId(value: RillValue): string | undefined {
  const name = atomName(getStatus(value).code);
  return ERROR_ID_BY_ATOM_NAME[name];
}

/**
 * A trace frame's `site` is formatted by `formatSite` below as
 * `<sourceId>:line:col`, `<sourceId>` alone, or a synthetic placeholder
 * (`"<unknown>"` / `"<script>"`) when no real location exists. Parses the
 * numeric suffix back out for host consumption; returns `undefined` when
 * the site carries no line/column (synthesized nodes, type-layer helpers
 * that pass no location).
 */
function parseLocationFromSite(site: string):
  | {
      readonly sourceId: string | undefined;
      readonly line: number;
      readonly column: number;
    }
  | undefined {
  const m = site.match(/^(.*?):(\d+):(\d+)$/);
  if (m === null) return undefined;
  const sourceId =
    m[1] === '<unknown>' || m[1] === '<script>' ? undefined : m[1];
  return { sourceId, line: Number(m[2]), column: Number(m[3]) };
}

/**
 * Resolves the carried value's first trace frame (the origin site, per
 * origin-first frame ordering) into a host-readable location, or
 * `undefined` when the value carries no trace frames or the origin frame
 * has no parseable line/column.
 */
function resolveHaltLocation(value: RillValue):
  | {
      readonly sourceId: string | undefined;
      readonly line: number;
      readonly column: number;
    }
  | undefined {
  const trace = getStatus(value).trace;
  return trace.length > 0 ? parseLocationFromSite(trace[0]!.site) : undefined;
}

/**
 * Rewraps `signal` with the origin trace frame's `site` replaced by a
 * freshly formatted location, when doing so would improve on a
 * placeholder. Never fabricates a new atom or trace frame count; it only
 * rewrites `trace[0].site` via `withOriginSite`.
 *
 * Returns `signal` unchanged when:
 * - the carried value's trace is empty (nothing to enrich), or
 * - the origin frame's site already parses to a real location
 *   (`parseLocationFromSite` succeeds), or
 * - the newly formatted site would itself be a non-locating placeholder
 *   (`location` is `undefined`, so `formatSite` falls back to
 *   `sourceId ?? '<unknown>'`).
 *
 * Otherwise returns a new `RuntimeHaltSignal` wrapping the rewritten
 * value, preserving `catchable`.
 */
export function enrichHaltOriginLocation(
  signal: RuntimeHaltSignal,
  location: SourceLocation | undefined,
  sourceId: string | undefined
): RuntimeHaltSignal {
  const trace = getStatus(signal.value).trace;
  if (trace.length === 0) return signal;
  if (parseLocationFromSite(trace[0]!.site) !== undefined) return signal;
  const newSite = formatSite(location, sourceId);
  if (parseLocationFromSite(newSite) === undefined) return signal;
  return new RuntimeHaltSignal(
    withOriginSite(signal.value, newSite),
    signal.catchable
  );
}

// ============================================================
// RUNTIME HALT SIGNAL
// ============================================================

/**
 * Thrown by the access gate and by evaluator / type-layer helpers to
 * halt evaluation. Carries the invalid RillValue as its payload.
 *
 * `catchable` distinguishes recoverable halts (access-gate halts and
 * operational type failures) from programmer-error halts (`error`,
 * `assert`). Guard and retry only catch
 * signals with `catchable === true`; non-catchable halts propagate
 * through recovery blocks unconditionally.
 *
 * `message`, `errorId`, and `location` are derived from the carried
 * value's status sidecar so a signal that escapes `execute()` uncaught
 * (an atom with no `HALT_ATOM_TO_ERROR_ID` entry in `execute.ts`) still
 * surfaces an informative message, an origin site, and — where the atom
 * is registered — a real error ID, instead of the literal string
 * `'runtime halt'` with no way to identify the failure.
 */
export class RuntimeHaltSignal extends Error {
  readonly value: RillValue;
  readonly catchable: boolean;

  constructor(value: RillValue, catchable: boolean) {
    super(deriveHaltMessage(value));
    this.name = 'RuntimeHaltSignal';
    this.value = value;
    this.catchable = catchable;
  }

  /**
   * The registered host-facing error ID (hyphen form, e.g. `RILL-R006`)
   * for the carried value's atom, or `undefined` when the atom has no
   * registered mapping. Read-only derived property; not stored, so it
   * always reflects the current `value` (which never changes after
   * construction).
   */
  get errorId(): string | undefined {
    return resolveHaltErrorId(this.value);
  }

  /**
   * The origin site of the carried value's first trace frame, or
   * `undefined` when no frame carries a parseable line/column. Read-only
   * derived property; not stored, so it always reflects the current
   * `value` (which never changes after construction).
   */
  get location():
    | {
        readonly sourceId: string | undefined;
        readonly line: number;
        readonly column: number;
      }
    | undefined {
    return resolveHaltLocation(this.value);
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
 * then throw a catchable `RuntimeHaltSignal` wrapping it.
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
      raw: { message, ...raw },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, true);
}

// ============================================================
// ABORT HALT BUILDER
// ============================================================

/**
 * Build an invalid RillValue representing an aborted execution, then
 * throw a non-catchable `RuntimeHaltSignal` wrapping it.
 *
 * Emits the `#DISPOSED` atom with `provider="runtime"` and a single
 * `host`-kind trace frame. Callers (typically `checkAborted` on the
 * evaluator base) set `site.fn = "checkAborted"`.
 *
 * Abort halts are non-catchable: guard and retry must not
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
// AUTO-EXCEPTION HALT BUILDER
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
 * Caller responsibility: the builder does not validate inputs.
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
// CATCHABLE HOST HALT BUILDER
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
      raw: { message, ...raw },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, true);
}

// ============================================================
// FATAL HOST HALT BUILDER
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
      raw: { message, ...raw },
    },
    frame
  );
  throw new RuntimeHaltSignal(invalid, false);
}

// ============================================================
// ERROR WRAP HALT BUILDER
// ============================================================

/**
 * Build an invalid RillValue for an `error "..."` statement, then throw
 * a non-catchable `RuntimeHaltSignal` wrapping it.
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

// ============================================================
// UNHANDLED HOST THROW BUILDER
// ============================================================

/**
 * Sanitize a caught Error's message before embedding it in `raw.message`:
 * strip trailing location suffixes and multi-line stack traces, keeping
 * only the first line. Exported so `context.ts` shares this implementation
 * instead of keeping its own copy, keeping reshape output consistent across
 * every boundary that reshapes an unhandled host throw.
 */
export function sanitizeThrowMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.trim();
}

/**
 * Build an invalid RillValue for an unhandled throw crossing the extension
 * dispatch boundary — a non-`RillError` `Error` instance, or a non-object
 * throw (`throw null`, `throw "str"`) that cannot be tagged by
 * `markExtensionThrow`'s `WeakSet`.
 *
 * Returns the invalid value rather than throwing: like `ctx.invalidate`,
 * the invalid RillValue flows onward as an ordinary call result. Nothing
 * halts until a later access site reads it (the access-halt gate) or a
 * status probe / `guard` inspects it, so a `guard`-wrapped call that
 * hits this path resolves normally with the invalid value rather than
 * unwinding via a thrown signal.
 *
 * Emits the `R999` atom with `provider="extension"` and a single
 * `host`-kind trace frame. `Error` instances carry a sanitized
 * `raw.message`; every other thrown value carries `raw.original =
 * String(thrown)`.
 *
 * The single call-site builder shared by every extension-boundary
 * reshape site so the `#R999` invalid-value shape (atom, provider, trace
 * frame) is defined once.
 *
 * @param site    Site descriptor (location, sourceId, fn).
 * @param thrown  The value caught at the dispatch boundary.
 */
export function makeUnhandledHostThrowInvalid(
  site: TypeHaltSite,
  thrown: unknown
): RillValue {
  const raw =
    thrown instanceof Error
      ? { message: sanitizeThrowMessage(thrown.message) }
      : { original: String(thrown) };
  const frame = createTraceFrame({
    site: formatSite(site.location, site.sourceId),
    kind: TRACE_KINDS.HOST,
    fn: site.fn,
  });
  return invalidate(
    {},
    {
      code: 'R999',
      provider: 'extension',
      raw,
    },
    frame
  );
}

// ============================================================
// BREAK-REJECTION HELPER
// ============================================================

/**
 * Converts an escaped `BreakSignal` into a coded, non-catchable fatal
 * halt; otherwise returns normally so the caller re-throws `e` unchanged.
 *
 * `break` is control-flow syntax meaningful only inside constructs that
 * consume it (`seq`, `acc`, `while`, `for`). When a `BreakSignal` reaches
 * a reject site that does not consume break — a parallel body (`fan`,
 * `filter`, `sort`), a predicate closure, or the top-level statement
 * stepper — it is the script's own control-flow misuse, a programmer
 * error rather than an operational failure `guard` / `retry` should be
 * able to swallow. The halt is therefore built via
 * `throwFatalHostHalt`, which is non-catchable: control-flow signals
 * remain a separate hierarchy from catchable halts, so recovery blocks
 * never absorb a misplaced `break`.
 *
 * Callers wrap a body-closure invocation in try/catch and call this
 * helper first in the catch clause; any error that is not a
 * `BreakSignal` falls through for the caller to re-throw as-is.
 *
 * @param e     The value caught at a reject site.
 * @param site  Site descriptor; `site.fn` names the construct in the
 *              halt message (e.g. `"fan"`, `"filter"`).
 * @throws RuntimeHaltSignal (fatal, non-catchable) when `e instanceof BreakSignal`.
 */
export function rejectBreakAsHalt(e: unknown, site: TypeHaltSite): void {
  if (e instanceof BreakSignal) {
    throwFatalHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `break not supported in ${site.fn}`
    );
  }
}
