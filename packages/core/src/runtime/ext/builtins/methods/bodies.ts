import { isDict } from '../../../core/callable.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue, RillVector } from '../../../core/types/structures.js';
import {
  deepEquals,
  formatValue,
  inferType,
} from '../../../core/types/registrations.js';
import { isIterator, isVector } from '../../../core/types/guards.js';
import { isEmpty } from '../../../core/values.js';
import { ERROR_IDS } from '../../../../error-registry.js';
import {
  type RillMethod,
  makeListIterator,
  makeStringIterator,
  makeDictIterator,
} from '../shared.js';

// ============================================================
// METHOD BODIES
// Defined as named RillMethod constants so they can be shared
// across type groups (e.g. len appears in string, list, dict).
// ============================================================

/** Get length of string, list, or dict */
export const mLen: RillMethod = (receiver) => {
  if (typeof receiver === 'string') return receiver.length;
  if (Array.isArray(receiver)) return receiver.length;
  if (receiver && typeof receiver === 'object') {
    return Object.keys(receiver).length;
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
    return receiver[0]!;
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
    return receiver[receiver.length - 1]!;
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
export const mAt: RillMethod = (receiver, args, _ctx, location) => {
  const idx = typeof args[0] === 'number' ? args[0] : 0;
  if (Array.isArray(receiver)) {
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
    if (idx < 0 || idx >= receiver.length) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        `String index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
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

/** Replace first regex match */
export const mReplace: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  try {
    return str.replace(new RegExp(pattern), replacement);
  } catch {
    return str;
  }
};

/** Replace all regex matches */
export const mReplaceAll: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  const replacement = formatValue(args[1] ?? '');
  try {
    return str.replace(new RegExp(pattern, 'g'), replacement);
  } catch {
    return str;
  }
};

/** Check if string contains substring */
export const mContains: RillMethod = (receiver, args) =>
  formatValue(receiver).includes(formatValue(args[0] ?? ''));

/** First regex match info, or empty dict if no match */
export const mMatch: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  try {
    const m = new RegExp(pattern).exec(str);
    if (!m) return {};
    return { matched: m[0], index: m.index, groups: m.slice(1) };
  } catch {
    return {};
  }
};

/** True if regex matches anywhere in string */
export const mIsMatch: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  try {
    return new RegExp(pattern).test(str);
  } catch {
    return false;
  }
};

/** Position of first substring occurrence (-1 if not found) */
export const mIndexOf: RillMethod = (receiver, args) =>
  formatValue(receiver).indexOf(formatValue(args[0] ?? ''));

/** Repeat string n times */
export const mRepeat: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const n = typeof args[0] === 'number' ? Math.max(0, Math.floor(args[0])) : 0;
  return str.repeat(n);
};

/** Pad start to length with fill string */
export const mPadStart: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  return str.padStart(length, fill);
};

/** Pad end to length with fill string */
export const mPadEnd: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  return str.padEnd(length, fill);
};

/** Equality check (deep structural comparison) */
export const mEq: RillMethod = (receiver, args) =>
  deepEquals(receiver, args[0] ?? null);

/** Inequality check (deep structural comparison) */
export const mNe: RillMethod = (receiver, args) =>
  !deepEquals(receiver, args[0] ?? null);

/** Less-than comparison (number or string) */
export const mLt: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver < arg;
  return formatValue(receiver) < formatValue(arg ?? '');
};

/** Greater-than comparison (number or string) */
export const mGt: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver > arg;
  return formatValue(receiver) > formatValue(arg ?? '');
};

/** Less-than-or-equal comparison (number or string) */
export const mLe: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver <= arg;
  return formatValue(receiver) <= formatValue(arg ?? '');
};

/** Greater-than-or-equal comparison (number or string) */
export const mGe: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver >= arg;
  return formatValue(receiver) >= formatValue(arg ?? '');
};

/** Get all keys of a dict as a list */
export const mKeys: RillMethod = (receiver) =>
  isDict(receiver) ? Object.keys(receiver) : [];

/** Get all values of a dict as a list */
export const mValues: RillMethod = (receiver) =>
  isDict(receiver) ? Object.values(receiver) : [];

/** Get all entries of a dict as a list of [key, value] pairs */
export const mEntries: RillMethod = (receiver) =>
  isDict(receiver) ? Object.entries(receiver).map(([k, v]) => [k, v]) : [];

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
