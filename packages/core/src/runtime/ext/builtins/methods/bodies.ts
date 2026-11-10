import { isCallable } from '../../../core/callable.js';
import type { RillValue, RillVector } from '../../../core/types/structures.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import type { SourceLocation } from '../../../../source-location.js';
import {
  deepEquals,
  formatValue,
  inferType,
} from '../../../core/types/registrations.js';
import {
  isIterator,
  isOrdered,
  isPlainDict,
  isStream,
  isTuple,
  isVector,
  orderedValueEntries,
} from '../../../core/types/guards.js';
import {
  orderedDictEntries,
  typedKeyCount,
} from '../../../core/types/dict-keys.js';
import { isEmpty } from '../../../core/values.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../../core/types/halt.js';
import {
  findIndexPosition,
  throwIndexOutOfBounds,
} from '../../../core/types/index-access.js';
import { resolvedCompareValue } from '../../../core/types/protocols/shared.js';
import { invokeCallable as invokeCallableState } from '../../../core/eval/index.js';
import {
  type RillMethod,
  makeListIterator,
  makeStringIterator,
  makeDictIterator,
  isBmpOnly,
  requireNonNegativeInteger,
} from '../shared.js';

// ============================================================
// METHOD BODIES
// Defined as named RillMethod constants so they can be shared
// across type groups (e.g. len appears in string, list, dict).
// ============================================================

/** Get length of string, list, or dict */
export const mLen: RillMethod = (receiver) => {
  // Strings measure length in Unicode code points, not UTF-16 code units, so
  // an astral character such as "😀" counts as one, matching how seq/fan and
  // the .first() iterator traverse strings. ASCII/BMP-only strings (the
  // common case) use .length directly instead of materializing the full
  // code-point array.
  if (typeof receiver === 'string') {
    return isBmpOnly(receiver) ? receiver.length : Array.from(receiver).length;
  }
  if (Array.isArray(receiver)) return receiver.length;
  if (isOrdered(receiver)) return receiver.entries.length;
  if (receiver !== null && typeof receiver === 'object') {
    return Object.keys(receiver).length + typedKeyCount(receiver);
  }
  return 0;
};

/** Trim whitespace from string */
export const mTrim: RillMethod = (receiver) => formatValue(receiver).trim();

/** Get first element of list or first char of string */
export const mHead: RillMethod = (receiver, _args, ctx, location) => {
  if (Array.isArray(receiver)) {
    const first = receiver[0];
    if (first === undefined) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'head' },
        'RILL_R002',
        'Cannot get head of empty list'
      );
    }
    return first;
  }
  if (typeof receiver === 'string') {
    // First code point, never a lone surrogate half of an astral character.
    const firstCp = receiver.codePointAt(0);
    if (firstCp === undefined) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'head' },
        'RILL_R002',
        'Cannot get head of empty string'
      );
    }
    return String.fromCodePoint(firstCp);
  }
  return throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn: 'head', preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `head requires list or string, got ${inferType(receiver)}`
  );
};

/** Get last element of list or last char of string */
export const mTail: RillMethod = (receiver, _args, ctx, location) => {
  if (Array.isArray(receiver)) {
    const last = receiver.at(-1);
    if (last === undefined) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'tail' },
        'RILL_R002',
        'Cannot get tail of empty list'
      );
    }
    return last;
  }
  if (typeof receiver === 'string') {
    // Last code point, never a lone surrogate half of an astral character.
    const cp = (isBmpOnly(receiver) ? receiver : Array.from(receiver)).at(-1);
    if (cp === undefined) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'tail' },
        'RILL_R002',
        'Cannot get tail of empty string'
      );
    }
    return cp;
  }
  return throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn: 'tail', preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `tail requires list or string, got ${inferType(receiver)}`
  );
};

/** Get iterator at first position for any collection */
export const mFirst: RillMethod = async (receiver, _args, ctx, location) => {
  // Streams must be checked before isIterator/isDict: a fresh host stream's
  // pending head step has no `value` field (so isIterator returns false),
  // but it is still a plain object and would otherwise fall through to the
  // isDict branch below, silently treating the stream itself as a dict of
  // internal fields (__rill_stream, next, ...) instead of stepping it.
  if (isStream(receiver)) {
    const loc = location ?? { line: 0, column: 0, offset: 0 };
    const nextRaw = receiver.next;
    if (!isCallable(nextRaw)) {
      throwCatchableHostHalt(
        { location: loc, sourceId: ctx.sourceId, fn: 'first' },
        'RILL_R002',
        'Stream .next must be a closure'
      );
    }
    return await invokeCallableState(nextRaw, [], ctx, loc);
  }
  if (isIterator(receiver)) return receiver;
  if (Array.isArray(receiver)) return makeListIterator(receiver, 0);
  if (typeof receiver === 'string') return makeStringIterator(receiver, 0);
  if (isPlainDict(receiver)) return makeDictIterator(receiver, 0);
  return throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn: 'first', preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `first requires list, string, dict, or iterator, got ${inferType(receiver)}`
  );
};

/** Get element at index; a negative index counts from the end */
export const mAt: RillMethod = (receiver, args, ctx, location) => {
  const idx = typeof args[0] === 'number' ? args[0] : 0;
  const site = { location, sourceId: ctx.sourceId, fn: 'at' };
  if (Array.isArray(receiver)) {
    const pos = findIndexPosition(idx, receiver.length, 'List', site);
    const item = pos === undefined ? undefined : receiver[pos];
    if (item === undefined) {
      return throwIndexOutOfBounds(idx, receiver.length, 'List', site);
    }
    return item;
  }
  if (typeof receiver === 'string') {
    // Index by code point so an astral character occupies a single position
    // and is never returned as a lone surrogate.
    const cps = isBmpOnly(receiver) ? receiver : Array.from(receiver);
    const pos = findIndexPosition(idx, cps.length, 'String', site);
    const cp = pos === undefined ? undefined : cps[pos];
    if (cp === undefined) {
      return throwIndexOutOfBounds(idx, cps.length, 'String', site);
    }
    return cp;
  }
  if (isTuple(receiver)) {
    const pos = findIndexPosition(idx, receiver.entries.length, 'Tuple', site);
    const entry = pos === undefined ? undefined : receiver.entries[pos];
    if (entry === undefined) {
      return throwIndexOutOfBounds(idx, receiver.entries.length, 'Tuple', site);
    }
    return entry;
  }
  return throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn: 'at', preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `Cannot call .at() on ${typeof receiver}`
  );
};

/** Split string by separator */
export const mSplit: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const sep = typeof args[0] === 'string' ? args[0] : '\n';
  // Empty separator splits into code points, not UTF-16 code units, so astral
  // characters stay whole instead of becoming lone surrogate pairs.
  if (sep === '') return Array.from(str);
  return str.split(sep);
};

/** Join list elements with separator */
export const mJoin: RillMethod = (receiver, args) => {
  const sep = typeof args[0] === 'string' ? args[0] : ',';
  if (!Array.isArray(receiver)) return formatValue(receiver);
  return receiver.map(formatValue).join(sep);
};

/** Split string into lines */
export const mLines: RillMethod = (receiver) =>
  formatValue(receiver).split('\n');

/** Check if value is empty */
export const mEmpty: RillMethod = (receiver) => isEmpty(receiver);

/** Check if string starts with prefix */
export const mStartsWith: RillMethod = (receiver, args) =>
  formatValue(receiver).startsWith(formatValue(args[0] ?? ''));

/** Check if string ends with suffix */
export const mEndsWith: RillMethod = (receiver, args) =>
  formatValue(receiver).endsWith(formatValue(args[0] ?? ''));

/** Convert string to lowercase */
export const mLower: RillMethod = (receiver) =>
  formatValue(receiver).toLowerCase();

/** Convert string to uppercase */
export const mUpper: RillMethod = (receiver) =>
  formatValue(receiver).toUpperCase();

/**
 * Escape `$` as `$$` in a replacement string so JS `String.prototype.replace`
 * treats it as a literal dollar sign instead of interpreting replacement
 * patterns like $&, $1, $<name>, or $`.
 */
function escapeReplacementDollars(replacement: string): string {
  return replacement.replace(/\$/g, '$$$$');
}

/** Replace first regex match. Invalid pattern halts with INVALID_INPUT. */
export const mReplace: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'u');
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'replace' },
      'INVALID_INPUT',
      `replace: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return str.replace(re, escapeReplacementDollars(replacement));
};

/** Replace all regex matches. Invalid pattern halts with INVALID_INPUT. */
export const mReplaceAll: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gu');
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: '.replace_all' },
      'INVALID_INPUT',
      `.replace_all: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return str.replace(re, escapeReplacementDollars(replacement));
};

/** Check if string contains substring */
export const mContains: RillMethod = (receiver, args) =>
  formatValue(receiver).includes(formatValue(args[0] ?? ''));

/**
 * First regex match info, or empty dict if no match.
 * Invalid pattern halts with INVALID_INPUT.
 */
export const mMatch: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'u');
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'match' },
      'INVALID_INPUT',
      `match: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const m = re.exec(str);
  if (!m) return {};
  // m.index is a UTF-16 code-unit offset; convert to a code-point offset so
  // the result is consistent with .len and .at on astral strings, matching
  // the isBmpOnly/Array.from idiom used by indexOf.
  const index = isBmpOnly(str)
    ? m.index
    : Array.from(str.slice(0, m.index)).length;
  return {
    matched: m[0],
    index,
    groups: m.slice(1).map((g) => g ?? ''),
  };
};

/**
 * True if regex matches anywhere in string.
 * Invalid pattern halts with INVALID_INPUT.
 */
export const mIsMatch: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'u');
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'isMatch' },
      'INVALID_INPUT',
      `isMatch: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return re.test(str);
};

/** Position of first substring occurrence, in code points (-1 if not found) */
export const mIndexOf: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const search = formatValue(args[0] ?? '');
  const unit = str.indexOf(search);
  if (unit < 0) return -1;
  // Convert the UTF-16 code-unit offset to a code-point offset so the result
  // is consistent with .len and .at on astral strings. BMP-only strings need
  // no conversion: code-unit and code-point offsets coincide.
  if (isBmpOnly(str)) return unit;
  return Array.from(str.slice(0, unit)).length;
};

/** Repeat string n times */
export const mRepeat: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const n = requireNonNegativeInteger(
    typeof args[0] === 'number' ? args[0] : 0,
    'repeat',
    'count',
    { location, sourceId: ctx.sourceId, fn: 'repeat' }
  );
  try {
    return str.repeat(n);
  } catch (e) {
    if (e instanceof RangeError) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'repeat' },
        'INVALID_INPUT',
        `repeat: count ${n} produces a string too large to allocate`
      );
    }
    throw e;
  }
};

/**
 * Code point count of `str`. ASCII/BMP-only strings (the common case) use
 * `.length` directly instead of materializing the full code-point array.
 */
function codePointLength(str: string): number {
  return isBmpOnly(str) ? str.length : Array.from(str).length;
}

/**
 * UTF-16 offset of the boundary after `count` code points in `str`. Walks
 * code units (not full code points) so it never materializes the string as
 * an array; a surrogate pair is always consumed as a single unit.
 */
function codePointOffset(str: string, count: number): number {
  if (isBmpOnly(str)) return count;
  let offset = 0;
  for (let seen = 0; seen < count && offset < str.length; seen++) {
    const code = str.charCodeAt(offset);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    offset += isHighSurrogate && offset + 1 < str.length ? 2 : 1;
  }
  return offset;
}

/**
 * Build a code-point-aware pad for padStart/padEnd. Measures `strLength` and
 * `fill` in code points (not UTF-16 code units) so astral characters count as
 * one unit and are never split across a surrogate pair boundary.
 */
function buildCodePointPad(
  strLength: number,
  length: number,
  fill: string,
  ctx: RuntimeContext,
  location: SourceLocation | undefined,
  fnName: 'pad_start' | 'pad_end'
): string {
  const shortfall = length - strLength;
  if (shortfall <= 0) return '';
  const fillLength = codePointLength(fill);
  if (fillLength === 0) return '';
  try {
    // Repeat the fill (as a whole string, so no surrogate pair is ever
    // split) enough times to cover the shortfall, then trim to the exact
    // code-point count. Native `repeat` throws RangeError fast for an
    // over-large result instead of looping to build it byte by byte.
    // The trim walks `repeated` in a bounded code-unit scan rather than
    // materializing every code point into a boxed array, so a large
    // shortfall stays a single native `.slice()` instead of an O(n)
    // allocation of individual string objects.
    const repetitions = Math.ceil(shortfall / fillLength);
    const repeated = fill.repeat(repetitions);
    return repeated.slice(0, codePointOffset(repeated, shortfall));
  } catch (e) {
    if (e instanceof RangeError) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: fnName },
        'INVALID_INPUT',
        `${fnName}: length ${length} produces a string too large to allocate`
      );
    }
    throw e;
  }
}

/** Pad start to length with fill string */
export const mPadStart: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const strLength = codePointLength(str);
  const length = requireNonNegativeInteger(
    typeof args[0] === 'number' ? args[0] : strLength,
    'pad_start',
    'length',
    { location, sourceId: ctx.sourceId, fn: 'pad_start' }
  );
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  const pad = buildCodePointPad(
    strLength,
    length,
    fill,
    ctx,
    location,
    'pad_start'
  );
  return pad + str;
};

/** Pad end to length with fill string */
export const mPadEnd: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const strLength = codePointLength(str);
  const length = requireNonNegativeInteger(
    typeof args[0] === 'number' ? args[0] : strLength,
    'pad_end',
    'length',
    { location, sourceId: ctx.sourceId, fn: 'pad_end' }
  );
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  const pad = buildCodePointPad(
    strLength,
    length,
    fill,
    ctx,
    location,
    'pad_end'
  );
  return str + pad;
};

/** Equality check (deep structural comparison) */
export const mEq: RillMethod = (receiver, args) =>
  deepEquals(receiver, args[0] ?? null);

/** Inequality check (deep structural comparison) */
export const mNe: RillMethod = (receiver, args) =>
  !deepEquals(receiver, args[0] ?? null);

/** Order two values via the compare protocol; halts RILL-R002 when incomparable. */
export function orderedCompare(
  receiver: RillValue,
  args: RillValue[],
  ctx: RuntimeContext,
  location: SourceLocation | undefined,
  method: string
): number {
  const arg = args[0] ?? null;
  const cmp = resolvedCompareValue(receiver, arg);
  if (cmp === undefined) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: method },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot compare ${inferType(receiver)} with ${inferType(arg)} using .${method}`
    );
  }
  return cmp;
}

/** Less-than comparison via the compare protocol */
export const mLt: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'lt') < 0;

/** Greater-than comparison via the compare protocol */
export const mGt: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'gt') > 0;

/** Less-than-or-equal comparison via the compare protocol */
export const mLe: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'le') <= 0;

/** Greater-than-or-equal comparison via the compare protocol */
export const mGe: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'ge') >= 0;

/** Halt RILL-R003 unless receiver is a plain dict (not ordered, branded, or stream). */
function requireDictReceiver(
  receiver: RillValue,
  fn: string,
  ctx: RuntimeContext,
  location: SourceLocation | undefined
): asserts receiver is Record<string, RillValue> {
  if (isPlainDict(receiver)) return;
  throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn, preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `${fn}() requires dict receiver, got ${inferType(receiver)}`
  );
}

/**
 * Get all keys of a dict as a list, in canonical order: sorted string keys,
 * then number keys ascending, then boolean keys (false before true).
 */
export const mKeys: RillMethod = (receiver, _args, ctx, location) => {
  // Ordered values dispatch before isDict: the JS wrapper object also
  // satisfies isDict's structural shape check.
  if (isOrdered(receiver)) return orderedValueEntries(receiver).map(([k]) => k);
  requireDictReceiver(receiver, 'keys', ctx, location);
  return orderedDictEntries(receiver).map((e) => e.key);
};

/** Get all values of a dict as a list, in canonical key order. */
export const mValues: RillMethod = (receiver, _args, ctx, location) => {
  if (isOrdered(receiver))
    return orderedValueEntries(receiver).map(([, v]) => v);
  requireDictReceiver(receiver, 'values', ctx, location);
  return orderedDictEntries(receiver).map((e) => e.value);
};

/** Get all entries of a dict as a list of [key, value] pairs, in canonical key order. */
export const mEntries: RillMethod = (receiver, _args, ctx, location) => {
  if (isOrdered(receiver))
    return orderedValueEntries(receiver).map(([k, v]): RillValue => [k, v]);
  requireDictReceiver(receiver, 'entries', ctx, location);
  return orderedDictEntries(receiver).map((e): RillValue => [e.key, e.value]);
};

/** Check if list contains value (deep equality) */
export const mHas: RillMethod = (receiver, args, ctx, location) => {
  if (!Array.isArray(receiver)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'has', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `has() requires list receiver, got ${inferType(receiver)}`
    );
  }
  const searchValue = args[0] ?? null;
  for (const item of receiver) {
    if (deepEquals(item, searchValue)) return true;
  }
  return false;
};

/**
 * Narrow a `list`-typed signature argument. marshalArgs rejects non-lists
 * before the body runs, so a non-list here means a direct call bypassed
 * marshalling; halt instead of treating it as an empty list.
 */
function listArg(
  value: RillValue | undefined,
  paramName: string,
  fn: string,
  ctx: RuntimeContext,
  location: SourceLocation | undefined
): readonly RillValue[] {
  if (Array.isArray(value)) return value;
  return throwFatalHostHalt(
    { location, sourceId: ctx.sourceId, fn, preserveHostShape: true },
    ERROR_ATOMS[ERROR_IDS.RILL_R001],
    `${fn}() ${paramName} expects list, got ${
      value === null || value === undefined ? 'nothing' : inferType(value)
    }`
  );
}

/** Check if list contains any value from candidates (deep equality) */
export const mHasAny: RillMethod = (receiver, args, ctx, location) => {
  if (!Array.isArray(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'has_any',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `has_any() requires list receiver, got ${inferType(receiver)}`
    );
  }
  const candidates = listArg(args[0], 'candidates', 'has_any', ctx, location);
  for (const candidate of candidates) {
    for (const item of receiver) {
      if (deepEquals(item, candidate)) return true;
    }
  }
  return false;
};

/** Check if list contains all values from candidates (deep equality) */
export const mHasAll: RillMethod = (receiver, args, ctx, location) => {
  if (!Array.isArray(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'has_all',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `has_all() requires list receiver, got ${inferType(receiver)}`
    );
  }
  const candidates = listArg(args[0], 'candidates', 'has_all', ctx, location);
  for (const candidate of candidates) {
    let found = false;
    for (const item of receiver) {
      if (deepEquals(item, candidate)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
};

/** Return a new list with elements in reversed order */
export const mReverse: RillMethod = (receiver, _args, ctx, location) => {
  if (!Array.isArray(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'reverse',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `reverse() requires list receiver, got ${inferType(receiver)}`
    );
  }
  return [...receiver].reverse();
};

/** Get number of dimensions in vector */
export const mDimensions: RillMethod = (receiver, _args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'dimensions',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `dimensions requires vector receiver, got ${inferType(receiver)}`
    );
  }
  return receiver.data.length;
};

/** Get model name of vector */
export const mModel: RillMethod = (receiver, _args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'model',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `model requires vector receiver, got ${inferType(receiver)}`
    );
  }
  return receiver.model;
};

/** Calculate cosine similarity between two vectors (range [-1, 1]) */
export const mSimilarity: RillMethod = (receiver, args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'similarity',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `similarity requires vector receiver, got ${inferType(receiver)}`
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'similarity',
        preserveHostShape: true,
      },
      'TYPE_MISMATCH',
      `expected vector, got ${inferType(other)}`
    );
  }
  if (receiver.data.length !== other.data.length) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'similarity',
        preserveHostShape: true,
      },
      'INVALID_INPUT',
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`
    );
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const a = receiver.data[i] ?? 0;
    // Unreachable fallback: lengths are verified equal above.
    const b = other.data[i] ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  return dotProduct / magnitude;
};

/** Calculate dot product between two vectors */
export const mDot: RillMethod = (receiver, args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'dot', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `dot requires vector receiver, got ${inferType(receiver)}`
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'dot', preserveHostShape: true },
      'TYPE_MISMATCH',
      `expected vector, got ${inferType(other)}`
    );
  }
  if (receiver.data.length !== other.data.length) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'dot', preserveHostShape: true },
      'INVALID_INPUT',
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`
    );
  }
  let result = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const a = receiver.data[i] ?? 0;
    // Unreachable fallback: lengths are verified equal above.
    result += a * (other.data[i] ?? 0);
  }
  return result;
};

/** Calculate Euclidean distance between two vectors (>= 0) */
export const mDistance: RillMethod = (receiver, args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'distance',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `distance requires vector receiver, got ${inferType(receiver)}`
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'distance',
        preserveHostShape: true,
      },
      'TYPE_MISMATCH',
      `expected vector, got ${inferType(other)}`
    );
  }
  if (receiver.data.length !== other.data.length) {
    throwCatchableHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'distance',
        preserveHostShape: true,
      },
      'INVALID_INPUT',
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`
    );
  }
  let sumSquares = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const a = receiver.data[i] ?? 0;
    // Unreachable fallback: lengths are verified equal above.
    const diff = a - (other.data[i] ?? 0);
    sumSquares += diff * diff;
  }
  return Math.sqrt(sumSquares);
};

/** Calculate L2 norm (magnitude) of vector */
export const mNorm: RillMethod = (receiver, _args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'norm', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `norm requires vector receiver, got ${inferType(receiver)}`
    );
  }
  let sumSquares = 0;
  for (const val of receiver.data) {
    sumSquares += val * val;
  }
  return Math.sqrt(sumSquares);
};

/** Create unit vector (preserves model) */
export const mNormalize: RillMethod = (receiver, _args, ctx, location) => {
  if (!isVector(receiver)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'normalize',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `normalize requires vector receiver, got ${inferType(receiver)}`
    );
  }
  let sumSquares = 0;
  for (const val of receiver.data) {
    sumSquares += val * val;
  }
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return receiver;
  const normalized = new Float32Array(receiver.data.length);
  for (let i = 0; i < receiver.data.length; i++) {
    const val = receiver.data[i] ?? 0;
    normalized[i] = val / magnitude;
  }
  return {
    __rill_vector: true,
    data: normalized,
    model: receiver.model,
  } satisfies RillVector;
};
