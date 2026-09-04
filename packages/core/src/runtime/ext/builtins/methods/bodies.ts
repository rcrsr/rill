import { isDict } from '../../../core/callable.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue, RillVector } from '../../../core/types/structures.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import type { SourceLocation } from '../../../../source-location.js';
import {
  deepEquals,
  formatValue,
  inferType,
} from '../../../core/types/registrations.js';
import { isIterator, isVector } from '../../../core/types/guards.js';
import {
  typedKeyEntries,
  typedKeyCount,
} from '../../../core/types/dict-keys.js';
import { isEmpty } from '../../../core/values.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { throwCatchableHostHalt } from '../../../core/types/halt.js';
import { resolvedCompareValue } from '../../../core/types/protocols/shared.js';
import {
  type RillMethod,
  makeListIterator,
  makeStringIterator,
  makeDictIterator,
  isBmpOnly,
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
    return isBmpOnly(receiver) ? receiver.length : [...receiver].length;
  }
  if (Array.isArray(receiver)) return receiver.length;
  if (receiver && typeof receiver === 'object') {
    return Object.keys(receiver).length + typedKeyCount(receiver);
  }
  return 0;
};

/** Trim whitespace from string */
export const mTrim: RillMethod = (receiver) => formatValue(receiver).trim();

/** Get first element of list or first char of string */
export const mHead: RillMethod = (receiver, _args, _ctx, location) => {
  if (Array.isArray(receiver)) {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get head of empty list',
        location
      );
    }
    return receiver[0]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get head of empty string',
        location
      );
    }
    // First code point, never a lone surrogate half of an astral character.
    return isBmpOnly(receiver) ? receiver.charAt(0) : [...receiver][0]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
    `head requires list or string, got ${inferType(receiver)}`,
    location
  );
};

/** Get last element of list or last char of string */
export const mTail: RillMethod = (receiver, _args, _ctx, location) => {
  if (Array.isArray(receiver)) {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get tail of empty list',
        location
      );
    }
    return receiver[receiver.length - 1]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get tail of empty string',
        location
      );
    }
    // Last code point, never a lone surrogate half of an astral character.
    if (isBmpOnly(receiver)) return receiver.charAt(receiver.length - 1);
    const cps = [...receiver];
    return cps[cps.length - 1]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
    `tail requires list or string, got ${inferType(receiver)}`,
    location
  );
};

/** Get iterator at first position for any collection */
export const mFirst: RillMethod = (receiver, _args, _ctx, location) => {
  if (isIterator(receiver)) return receiver;
  if (Array.isArray(receiver)) return makeListIterator(receiver, 0);
  if (typeof receiver === 'string') return makeStringIterator(receiver, 0);
  if (isDict(receiver))
    return makeDictIterator(receiver as Record<string, RillValue>, 0);
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
    `first requires list, string, dict, or iterator, got ${inferType(receiver)}`,
    location
  );
};

/** Get element at index */
export const mAt: RillMethod = (receiver, args, ctx, location) => {
  const idx = typeof args[0] === 'number' ? args[0] : 0;
  if (Array.isArray(receiver)) {
    // A fractional index generates a fractional array access (`receiver[1.5]`)
    // which is `undefined`, violating the no-null invariant. Halt with a
    // catchable #INVALID_INPUT instead, mirroring applySlice's bound check.
    if (!Number.isInteger(idx)) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'at' },
        'INVALID_INPUT',
        `List index must be an integer, got ${idx}`
      );
    }
    if (idx < 0 || idx >= receiver.length) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        `List index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
  }
  if (typeof receiver === 'string') {
    // Index by code point so an astral character occupies a single position
    // and is never returned as a lone surrogate.
    if (!Number.isInteger(idx)) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'at' },
        'INVALID_INPUT',
        `String index must be an integer, got ${idx}`
      );
    }
    if (isBmpOnly(receiver)) {
      if (idx < 0 || idx >= receiver.length) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R002,
          `String index out of bounds: ${idx}`,
          location
        );
      }
      return receiver.charAt(idx);
    }
    const cps = [...receiver];
    if (idx < 0 || idx >= cps.length) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        `String index out of bounds: ${idx}`,
        location
      );
    }
    return cps[idx]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
    `Cannot call .at() on ${typeof receiver}`,
    location
  );
};

/** Split string by separator */
export const mSplit: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const sep = typeof args[0] === 'string' ? args[0] : '\n';
  // Empty separator splits into code points, not UTF-16 code units, so astral
  // characters stay whole instead of becoming lone surrogate pairs.
  if (sep === '') return [...str];
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

/** Replace first regex match. Invalid pattern halts with INVALID_INPUT. */
export const mReplace: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'replace' },
      'INVALID_INPUT',
      `replace: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return str.replace(re, replacement);
};

/** Replace all regex matches. Invalid pattern halts with INVALID_INPUT. */
export const mReplaceAll: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: '.replace_all' },
      'INVALID_INPUT',
      `.replace_all: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return str.replace(re, replacement);
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
    re = new RegExp(pattern);
  } catch (e) {
    throwCatchableHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'match' },
      'INVALID_INPUT',
      `match: invalid regex pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const m = re.exec(str);
  if (!m) return {};
  return {
    matched: m[0],
    index: m.index,
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
    re = new RegExp(pattern);
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
  const n = typeof args[0] === 'number' ? Math.max(0, Math.floor(args[0])) : 0;
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

/** Pad start to length with fill string */
export const mPadStart: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  try {
    return str.padStart(length, fill);
  } catch (e) {
    if (e instanceof RangeError) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'pad_start' },
        'INVALID_INPUT',
        `pad_start: length ${length} produces a string too large to allocate`
      );
    }
    throw e;
  }
};

/** Pad end to length with fill string */
export const mPadEnd: RillMethod = (receiver, args, ctx, location) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  try {
    return str.padEnd(length, fill);
  } catch (e) {
    if (e instanceof RangeError) {
      throwCatchableHostHalt(
        { location, sourceId: ctx.sourceId, fn: 'pad_end' },
        'INVALID_INPUT',
        `pad_end: length ${length} produces a string too large to allocate`
      );
    }
    throw e;
  }
};

/** Equality check (deep structural comparison) */
export const mEq: RillMethod = (receiver, args) =>
  deepEquals(receiver, args[0] ?? null);

/** Inequality check (deep structural comparison) */
export const mNe: RillMethod = (receiver, args) =>
  !deepEquals(receiver, args[0] ?? null);

function orderedCompare(
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

/**
 * Get all keys of a dict as a list. String keys (sorted) come first,
 * then number/boolean keys (each surfaced with its original type).
 */
export const mKeys: RillMethod = (receiver) =>
  isDict(receiver)
    ? [
        ...Object.keys(receiver).sort(),
        ...typedKeyEntries(receiver).map((e) => e.key),
      ]
    : [];

/** Get all values of a dict as a list, sorted string keys first then typed keys. */
export const mValues: RillMethod = (receiver) =>
  isDict(receiver)
    ? [
        ...Object.keys(receiver)
          .sort()
          .map((key) => receiver[key]!),
        ...typedKeyEntries(receiver).map((e) => e.value),
      ]
    : [];

/** Get all entries of a dict as a list of [key, value] pairs. */
export const mEntries: RillMethod = (receiver) =>
  isDict(receiver)
    ? [
        ...Object.keys(receiver)
          .sort()
          .map((key) => [key, receiver[key]!] as RillValue),
        ...typedKeyEntries(receiver).map((e) => [e.key, e.value] as RillValue),
      ]
    : [];

/** Check if list contains value (deep equality) */
export const mHas: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `has() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const searchValue = args[0] ?? null;
  for (const item of receiver) {
    if (deepEquals(item, searchValue)) return true;
  }
  return false;
};

/** Check if list contains any value from candidates (deep equality) */
export const mHasAny: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `has_any() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_any() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_any() expects list argument, got ${inferType(candidates)}`,
      location
    );
  }
  for (const candidate of candidates) {
    for (const item of receiver) {
      if (deepEquals(item, candidate)) return true;
    }
  }
  return false;
};

/** Check if list contains all values from candidates (deep equality) */
export const mHasAll: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `has_all() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_all() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_all() expects list argument, got ${inferType(candidates)}`,
      location
    );
  }
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
export const mReverse: RillMethod = (receiver, _args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `reverse() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return [...receiver].reverse();
};

/** Get number of dimensions in vector */
export const mDimensions: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `dimensions requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return receiver.data.length;
};

/** Get model name of vector */
export const mModel: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `model requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return receiver.model;
};

/** Calculate cosine similarity between two vectors (range [-1, 1]) */
export const mSimilarity: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `similarity requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`,
      location
    );
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const a = receiver.data[i]!;
    const b = other.data[i]!;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  return dotProduct / magnitude;
};

/** Calculate dot product between two vectors */
export const mDot: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `dot requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`,
      location
    );
  }
  let result = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    result += receiver.data[i]! * other.data[i]!;
  }
  return result;
};

/** Calculate Euclidean distance between two vectors (>= 0) */
export const mDistance: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `distance requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `vector dimension mismatch: ${receiver.data.length} vs ${other.data.length}`,
      location
    );
  }
  let sumSquares = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const diff = receiver.data[i]! - other.data[i]!;
    sumSquares += diff * diff;
  }
  return Math.sqrt(sumSquares);
};

/** Calculate L2 norm (magnitude) of vector */
export const mNorm: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `norm requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  let sumSquares = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const val = receiver.data[i]!;
    sumSquares += val * val;
  }
  return Math.sqrt(sumSquares);
};

/** Create unit vector (preserves model) */
export const mNormalize: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `normalize requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  let sumSquares = 0;
  for (let i = 0; i < receiver.data.length; i++) {
    const val = receiver.data[i]!;
    sumSquares += val * val;
  }
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return receiver;
  const normalized = new Float32Array(receiver.data.length);
  for (let i = 0; i < receiver.data.length; i++) {
    normalized[i] = receiver.data[i]! / magnitude;
  }
  return {
    __rill_vector: true,
    data: normalized,
    model: receiver.model,
  } satisfies RillVector;
};
