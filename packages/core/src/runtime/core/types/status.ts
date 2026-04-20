/**
 * RillStatus sidecar primitives.
 *
 * Every RillValue logically carries a fixed-shape status record. Valid
 * values share one frozen empty-status singleton by reference (zero
 * allocations, B3 valid path). Invalid values carry a copy-on-write
 * populated clone whose `code` is an atom other than `#ok`.
 *
 * This module owns the singleton, the invalidation factory, the
 * trace-frame append helper, and the `isInvalid` / `isVacant` probes.
 * RillValue itself does not yet formally declare a `status` field;
 * task 1.2 widens the union. Until then, callers read status through
 * `getStatus(value)` which treats missing sidecars as valid.
 */

import type { RillValue } from './structures.js';
import {
  atomName,
  okAtom,
  resolveAtom,
  type RillAtom,
} from './atom-registry.js';
import { appendFrame, type TraceFrame } from './trace.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Fixed-shape metadata attached to every RillValue.
 *
 * Valid values share the frozen empty-status singleton; invalid values
 * carry a populated clone. No field is ever `null` or `undefined`.
 */
export interface RillStatus {
  readonly code: RillAtom;
  readonly message: string;
  readonly provider: string;
  readonly raw: Readonly<Record<string, RillValue>>;
  readonly trace: ReadonlyArray<TraceFrame>;
}

/**
 * Caller-supplied metadata for `invalidate`.
 *
 * `code` names a registered atom; unregistered names resolve to `#R001`
 * (never throw). `provider` identifies the origin. `raw` is an optional
 * provider-specific payload.
 */
export interface InvalidateMeta {
  readonly code: string;
  readonly provider: string;
  raw?: Record<string, unknown>;
}

// ============================================================
// SIDECAR KEY
// ============================================================

/**
 * Private Symbol used to key the status sidecar on RillValue objects.
 *
 * Using a Symbol instead of a string property provides two wins over the
 * prior `Object.getOwnPropertyDescriptor(value, 'status')` probe:
 *
 * 1. Fast-path access: `value[STATUS_SYM]` is a single property read,
 *    avoiding the descriptor allocation and `enumerable` check.
 * 2. Structural isolation: Symbol-keyed properties are invisible to
 *    `JSON.stringify`, `Object.keys`, and `for...in` — so user-level
 *    dict fields named `status` cannot collide with the sidecar, and
 *    structural comparisons that iterate own enumerable keys are
 *    unaffected.
 *
 * The Symbol is not exported from the package barrel; it is internal
 * to the status module and the fast-path gate.
 */
export const STATUS_SYM: unique symbol = Symbol('rillStatus');

// ============================================================
// FROZEN DEFAULTS
// ============================================================

const EMPTY_RAW: Readonly<Record<string, RillValue>> = Object.freeze({});
const EMPTY_TRACE: ReadonlyArray<TraceFrame> = Object.freeze([]);

/**
 * The single, deeply-frozen empty-status singleton.
 *
 * Every valid RillValue shares this reference. Must not be mutated;
 * invalidation performs copy-on-write against this base.
 */
const EMPTY_STATUS: RillStatus = Object.freeze({
  code: okAtom(),
  message: '',
  provider: '',
  raw: EMPTY_RAW,
  trace: EMPTY_TRACE,
});

// ============================================================
// STATUS ACCESS
// ============================================================

/**
 * Returns the status sidecar attached to `value`, or the frozen
 * empty-status singleton when no sidecar is present.
 *
 * Task 1.2 widens RillValue to declare the `status` field formally;
 * until then, this helper keeps call sites typesafe by treating
 * primitive values (string/number/boolean) and legacy objects as valid.
 */
export function getStatus(value: RillValue): RillStatus {
  if (value === null) return EMPTY_STATUS;
  if (typeof value !== 'object') return EMPTY_STATUS;
  // Symbol-keyed sidecar: a single property read. Symbol properties are
  // invisible to JSON.stringify / Object.keys / for-in, so there is no
  // collision with user-level dict fields named `status`.
  const maybeStatus = (value as { [STATUS_SYM]?: RillStatus })[STATUS_SYM];
  if (maybeStatus === undefined) return EMPTY_STATUS;
  return maybeStatus;
}

/**
 * Returns the frozen empty-status singleton.
 *
 * Every valid RillValue shares this reference (zero-allocation valid
 * path). The singleton is deeply frozen: mutation attempts throw in
 * strict mode and are silently ignored in sloppy mode.
 */
export function emptyStatus(): RillStatus {
  return EMPTY_STATUS;
}

// ============================================================
// VALIDITY PROBES
// ============================================================

/**
 * Returns true when the value carries an invalid status
 * (`status.code !== #ok`). O(1), zero allocations on the valid path:
 * primitives and objects without a sidecar symbol return `false` after
 * a single property read.
 */
export function isInvalid(value: RillValue): boolean {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  const status = (value as { [STATUS_SYM]?: RillStatus })[STATUS_SYM];
  if (status === undefined) return false;
  return status.code !== EMPTY_STATUS.code;
}

/**
 * Returns true when the value is empty OR invalid (vacant predicate).
 *
 * Empty for primitives is `""`, `0`, `false`, `null`, `[]`, `{}`.
 * Empty for RillValue containers uses structural emptiness; full
 * emptiness rules land in task 1.2 alongside consumer wiring.
 */
export function isVacant(value: RillValue): boolean {
  if (isInvalid(value)) return true;
  return isEmptyValue(value);
}

/**
 * Provisional emptiness probe for primitives and common containers.
 *
 * Task 1.2 extends this with type-registry-driven emptiness for
 * RillOrdered, RillVector, RillTuple, RillStream, and RillDatetime /
 * RillDuration. This skeleton covers the primitive and plain
 * container cases so `isVacant` is callable in isolation.
 */
function isEmptyValue(value: RillValue): boolean {
  if (value === null) return true;
  if (value === '') return true;
  if (value === 0) return true;
  if (value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    // Plain dict check; runtime branded types (callable, tuple, etc.)
    // return false here and gain full handling in task 1.2.
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.keys(value as Record<string, unknown>).length === 0;
    }
  }
  return false;
}

// ============================================================
// INVALIDATION
// ============================================================

/**
 * Returns a new invalid RillValue with copy-on-write status.
 *
 * The returned value carries a populated `status` sidecar whose:
 * - `code` resolves `meta.code` via the atom registry (unregistered
 *   names yield `#R001`);
 * - `message` derives from `meta.raw.message` when present, else `""`;
 * - `provider` is `meta.provider`;
 * - `raw` is `meta.raw ?? {}` (frozen);
 * - `trace` is the prior trace extended by `frame`.
 *
 * Prior status (if any) is preserved in the new trace via `appendFrame`.
 * `wrap`-kind frames carry the prior status dict in their `wrapped`
 * field; this module does not synthesize that field here, because the
 * caller constructing a `wrap` frame owns that payload.
 */
export function invalidate(
  base: RillValue,
  meta: InvalidateMeta,
  frame: TraceFrame
): RillValue {
  const priorStatus = getStatus(base);
  const code = resolveAtom(meta.code);
  // Cast is local to the invalidate() call site: the public InvalidateMeta
  // surface intentionally accepts arbitrary provider payloads (unknown
  // values), while the internal RillStatus.raw remains narrowly typed.
  const raw = (meta.raw ?? EMPTY_RAW) as Readonly<Record<string, RillValue>>;
  const message = readMessage(raw);
  const newStatus: RillStatus = Object.freeze({
    code,
    message,
    provider: meta.provider,
    raw,
    trace: appendFrame(priorStatus.trace, frame),
  });
  return attachStatus(base, newStatus);
}

/**
 * Appends a trace frame to an invalid value's status, returning a new
 * RillValue with the extended trace. Prior frames are not cloned
 * (NFR-ERR-3); the new trace array is frozen.
 *
 * When called on a valid value (empty-status singleton), the result
 * remains logically valid: the frame is appended but `code` stays
 * `#ok`. Callers that add trace frames typically do so alongside
 * invalidation via `invalidate`.
 */
export function appendTraceFrame(
  value: RillValue,
  frame: TraceFrame
): RillValue {
  const prior = getStatus(value);
  const newStatus: RillStatus = Object.freeze({
    code: prior.code,
    message: prior.message,
    provider: prior.provider,
    raw: prior.raw,
    trace: appendFrame(prior.trace, frame),
  });
  return attachStatus(value, newStatus);
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Extracts a message string from the provider `raw` bag when present.
 * Returns `""` when absent or when the message is not a string.
 */
function readMessage(raw: Readonly<Record<string, RillValue>>): string {
  const candidate = (raw as { message?: unknown }).message;
  if (typeof candidate === 'string') return candidate;
  return '';
}

// ============================================================
// HALT FORMATTING
// ============================================================

/**
 * Renders a plain-text representation of an invalid RillValue's status.
 *
 * Deterministic, byte-equal across runtimes (FR-ERR-28 / AC-FDL-E1):
 * no platform APIs, no timestamps, no random IDs. Uses `\n` as the line
 * separator (not platform-dependent `EOL`) and produces no trailing
 * newline.
 *
 * Layout for an invalid value:
 *   #<ATOM>: <message>
 *   at <provider>                 (omitted when provider is "")
 *     <kind> <site>[/<fn>]        (one line per trace frame, origin first)
 *
 * For a valid value (`status.code === #ok`), returns `""`. The fast
 * path performs zero allocations (AC-N3 / AC-B5 / NFR-ERR-2): the
 * `isInvalid` probe reads the frozen empty-status singleton by
 * reference without cloning.
 */
export function formatHalt(value: RillValue): string {
  if (!isInvalid(value)) return '';
  const status = getStatus(value);
  const lines: string[] = [];
  const codeName = atomName(status.code);
  lines.push(
    status.message.length === 0
      ? `#${codeName}:`
      : `#${codeName}: ${status.message}`
  );
  if (status.provider.length > 0) {
    lines.push(`at ${status.provider}`);
  }
  for (const frame of status.trace) {
    const suffix = frame.fn.length > 0 ? `/${frame.fn}` : '';
    lines.push(`  ${frame.kind} ${frame.site}${suffix}`);
  }
  return lines.join('\n');
}

/**
 * Attaches `status` to `base` via a shallow copy-on-write clone.
 *
 * Primitive values (string/number/boolean/null) cannot carry a
 * sidecar property. In task 1.1 these are passed through unchanged;
 * task 1.2 introduces the boxed primitive wrapper needed to carry a
 * status on these types. Consumers calling `invalidate` against a
 * primitive today receive the primitive back and must rely on status
 * propagation at the container / pipe boundary.
 */
function attachStatus(base: RillValue, status: RillStatus): RillValue {
  if (base === null) return base;
  if (typeof base !== 'object') return base;
  if (Array.isArray(base)) {
    const clone = base.slice();
    Object.defineProperty(clone, STATUS_SYM, {
      value: status,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return clone as RillValue;
  }
  // Plain object / branded runtime record: shallow clone, attach status
  // at the Symbol-keyed sidecar slot. Symbol properties are invisible to
  // JSON.stringify / Object.keys / for-in, so structural comparisons
  // that iterate own enumerable keys remain unaffected.
  const clone: Record<string, RillValue> = {
    ...(base as Record<string, RillValue>),
  };
  Object.defineProperty(clone, STATUS_SYM, {
    value: status,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return clone as RillValue;
}
