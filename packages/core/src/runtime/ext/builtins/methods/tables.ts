import {
  buildMethodEntry,
  SIG_LEN,
  SIG_EMPTY,
  SIG_HEAD,
  SIG_TAIL,
  SIG_FIRST,
  SIG_AT,
  SIG_EQ,
  SIG_NE,
  SIG_CMP,
} from './entry.js';
import {
  mLen,
  mTrim,
  mHead,
  mTail,
  mFirst,
  mAt,
  mSplit,
  mJoin,
  mLines,
  mEmpty,
  mStartsWith,
  mEndsWith,
  mLower,
  mUpper,
  mReplace,
  mReplaceAll,
  mContains,
  mMatch,
  mIsMatch,
  mIndexOf,
  mRepeat,
  mPadStart,
  mPadEnd,
  mEq,
  mNe,
  mLt,
  mGt,
  mLe,
  mGe,
  mKeys,
  mValues,
  mEntries,
  mHas,
  mHasAny,
  mHasAll,
  mReverse,
  mDimensions,
  mModel,
  mSimilarity,
  mDot,
  mDistance,
  mNorm,
  mNormalize,
} from './bodies.js';
import {
  mDtYear,
  mDtMonth,
  mDtDay,
  mDtHour,
  mDtMinute,
  mDtSecond,
  mDtMs,
  mDtUnix,
  mDtWeekday,
  mDtZero,
  mDtIso,
  mDtDate,
  mDtTime,
  mDtLocalIso,
  mDtLocalDate,
  mDtLocalTime,
  mDtLocalOffset,
  mDtAdd,
  mDtDiff,
  mDtLt,
  mDtGt,
  mDtLe,
  mDtGe,
  mDurMonths,
  mDurDays,
  mDurHours,
  mDurMinutes,
  mDurSeconds,
  mDurMs,
  mDurTotalMs,
  mDurDisplay,
  mDurZero,
  mDurAdd,
  mDurSubtract,
  mDurMultiply,
} from '../temporal/methods.js';

// ============================================================
// PER-TYPE METHOD RECORDS
// Populate BUILTIN_METHODS sub-records using buildMethodEntry.
// Methods shared across types reference the same RillMethod body.
// Cross-type methods (len, empty, eq, ne, head, tail, first, at,
// lt, gt, le, ge) appear in every type group they support.
// Vector methods live in the `vector` group (6th group beyond
// the 5 basic types) because no basic type covers vectors.
// ============================================================

// Equality methods follow the == operator, so every table whose values
// support == carries them. Defined once and spread into each table.
const EQUALITY_METHODS = {
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
};

export const STRING_METHODS = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  trim: buildMethodEntry('trim', 'fn():string', mTrim),
  head: buildMethodEntry('head', SIG_HEAD, mHead, true),
  tail: buildMethodEntry('tail', SIG_TAIL, mTail, true),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  at: buildMethodEntry('at', SIG_AT, mAt, true),
  split: buildMethodEntry(
    'split',
    'fn(separator: string = "\\n"):list',
    mSplit
  ),
  lines: buildMethodEntry('lines', 'fn():list', mLines),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  starts_with: buildMethodEntry(
    'starts_with',
    'fn(prefix: string):bool',
    mStartsWith
  ),
  ends_with: buildMethodEntry(
    'ends_with',
    'fn(suffix: string):bool',
    mEndsWith
  ),
  lower: buildMethodEntry('lower', 'fn():string', mLower),
  upper: buildMethodEntry('upper', 'fn():string', mUpper),
  replace: buildMethodEntry(
    'replace',
    'fn(pattern: string, replacement: string):string',
    mReplace
  ),
  replace_all: buildMethodEntry(
    'replace_all',
    'fn(pattern: string, replacement: string):string',
    mReplaceAll
  ),
  contains: buildMethodEntry('contains', 'fn(search: string):bool', mContains),
  match: buildMethodEntry('match', 'fn(pattern: string):dict', mMatch),
  is_match: buildMethodEntry('is_match', 'fn(pattern: string):bool', mIsMatch),
  index_of: buildMethodEntry('index_of', 'fn(search: string):number', mIndexOf),
  repeat: buildMethodEntry('repeat', 'fn(count: number):string', mRepeat),
  pad_start: buildMethodEntry(
    'pad_start',
    'fn(length: number, fill: string = " "):string',
    mPadStart
  ),
  pad_end: buildMethodEntry(
    'pad_end',
    'fn(length: number, fill: string = " "):string',
    mPadEnd
  ),
  ...EQUALITY_METHODS,
  lt: buildMethodEntry('lt', SIG_CMP, mLt),
  gt: buildMethodEntry('gt', SIG_CMP, mGt),
  le: buildMethodEntry('le', SIG_CMP, mLe),
  ge: buildMethodEntry('ge', SIG_CMP, mGe),
});

export const LIST_METHODS = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  head: buildMethodEntry('head', SIG_HEAD, mHead, true),
  tail: buildMethodEntry('tail', SIG_TAIL, mTail, true),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  at: buildMethodEntry('at', SIG_AT, mAt, true),
  join: buildMethodEntry('join', 'fn(separator: string = ","):string', mJoin),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  ...EQUALITY_METHODS,
  has: buildMethodEntry('has', 'fn(value: any):bool', mHas, true),
  has_any: buildMethodEntry(
    'has_any',
    'fn(candidates: list):bool',
    mHasAny,
    true
  ),
  has_all: buildMethodEntry(
    'has_all',
    'fn(candidates: list):bool',
    mHasAll,
    true
  ),
  reverse: buildMethodEntry('reverse', 'fn():list', mReverse),
});

export const DICT_METHODS = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  ...EQUALITY_METHODS,
  keys: buildMethodEntry('keys', 'fn():list', mKeys, true),
  values: buildMethodEntry('values', 'fn():list', mValues, true),
  entries: buildMethodEntry('entries', 'fn():list', mEntries, true),
});

export const NUMBER_METHODS = Object.freeze({
  ...EQUALITY_METHODS,
  lt: buildMethodEntry('lt', SIG_CMP, mLt),
  gt: buildMethodEntry('gt', SIG_CMP, mGt),
  le: buildMethodEntry('le', SIG_CMP, mLe),
  ge: buildMethodEntry('ge', SIG_CMP, mGe),
});

export const BOOL_METHODS = Object.freeze({
  ...EQUALITY_METHODS,
});

// [ASSUMPTION] vector is a 6th group beyond the 5 specified basic types.
// The 7 vector methods do not belong to string/list/dict/number/bool.
// Adding this group ensures all 42 methods are accessible.
export const VECTOR_METHODS = Object.freeze({
  dimensions: buildMethodEntry('dimensions', 'fn():number', mDimensions, true),
  model: buildMethodEntry('model', 'fn():string', mModel, true),
  similarity: buildMethodEntry(
    'similarity',
    'fn(other: any):number',
    mSimilarity,
    true
  ),
  dot: buildMethodEntry('dot', 'fn(other: any):number', mDot, true),
  distance: buildMethodEntry(
    'distance',
    'fn(other: any):number',
    mDistance,
    true
  ),
  norm: buildMethodEntry('norm', 'fn():number', mNorm, true),
  normalize: buildMethodEntry('normalize', 'fn():any', mNormalize, true),
  ...EQUALITY_METHODS,
});

// Datetime methods: properties, string formatters, local properties, arithmetic.
// All property-style methods (year, month, day, etc.) use skipReceiverValidation
// because the receiver is always a RillDatetime discriminated by __rill_datetime.
export const DATETIME_METHODS = Object.freeze({
  // Component properties
  year: buildMethodEntry('year', 'fn():number', mDtYear, true),
  month: buildMethodEntry('month', 'fn():number', mDtMonth, true),
  day: buildMethodEntry('day', 'fn():number', mDtDay, true),
  hour: buildMethodEntry('hour', 'fn():number', mDtHour, true),
  minute: buildMethodEntry('minute', 'fn():number', mDtMinute, true),
  second: buildMethodEntry('second', 'fn():number', mDtSecond, true),
  ms: buildMethodEntry('ms', 'fn():number', mDtMs, true),
  unix: buildMethodEntry('unix', 'fn():number', mDtUnix, true),
  weekday: buildMethodEntry('weekday', 'fn():number', mDtWeekday, true),
  zero: buildMethodEntry('zero', 'fn():datetime', mDtZero, true),

  // String formatting methods
  iso: buildMethodEntry('iso', 'fn(offset: number = 0):string', mDtIso, true),
  date: buildMethodEntry(
    'date',
    'fn(offset: number = 0):string',
    mDtDate,
    true
  ),
  time: buildMethodEntry(
    'time',
    'fn(offset: number = 0):string',
    mDtTime,
    true
  ),

  // Local properties
  local_iso: buildMethodEntry('local_iso', 'fn():string', mDtLocalIso, true),
  local_date: buildMethodEntry('local_date', 'fn():string', mDtLocalDate, true),
  local_time: buildMethodEntry('local_time', 'fn():string', mDtLocalTime, true),
  local_offset: buildMethodEntry(
    'local_offset',
    'fn():number',
    mDtLocalOffset,
    true
  ),

  // Arithmetic methods
  add: buildMethodEntry('add', 'fn(dur: any):datetime', mDtAdd, true),
  diff: buildMethodEntry('diff', 'fn(other: any):duration', mDtDiff, true),

  // Comparison methods
  ...EQUALITY_METHODS,
  lt: buildMethodEntry('lt', SIG_CMP, mDtLt, true),
  gt: buildMethodEntry('gt', SIG_CMP, mDtGt, true),
  le: buildMethodEntry('le', SIG_CMP, mDtLe, true),
  ge: buildMethodEntry('ge', SIG_CMP, mDtGe, true),
});

// Duration methods: properties, display, arithmetic.
// All use skipReceiverValidation because the receiver is a RillDuration
// discriminated by __rill_duration.
export const DURATION_METHODS = Object.freeze({
  // Decomposition properties
  months: buildMethodEntry('months', 'fn():number', mDurMonths, true),
  days: buildMethodEntry('days', 'fn():number', mDurDays, true),
  hours: buildMethodEntry('hours', 'fn():number', mDurHours, true),
  minutes: buildMethodEntry('minutes', 'fn():number', mDurMinutes, true),
  seconds: buildMethodEntry('seconds', 'fn():number', mDurSeconds, true),
  ms: buildMethodEntry('ms', 'fn():number', mDurMs, true),
  total_ms: buildMethodEntry('total_ms', 'fn():number', mDurTotalMs, true),
  display: buildMethodEntry('display', 'fn():string', mDurDisplay, true),
  zero: buildMethodEntry('zero', 'fn():duration', mDurZero, true),

  // Arithmetic methods
  add: buildMethodEntry('add', 'fn(dur: any):duration', mDurAdd, true),
  subtract: buildMethodEntry(
    'subtract',
    'fn(other: any):duration',
    mDurSubtract,
    true
  ),
  multiply: buildMethodEntry(
    'multiply',
    'fn(n: any):duration',
    mDurMultiply,
    true
  ),

  ...EQUALITY_METHODS,
});

export const TUPLE_METHODS = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  len: buildMethodEntry('len', SIG_LEN, mLen),
  at: buildMethodEntry('at', SIG_AT, mAt, true),
  ...EQUALITY_METHODS,
});

export const ORDERED_METHODS = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  len: buildMethodEntry('len', SIG_LEN, mLen),
  keys: buildMethodEntry('keys', 'fn():list', mKeys, true),
  values: buildMethodEntry('values', 'fn():list', mValues, true),
  entries: buildMethodEntry('entries', 'fn():list', mEntries, true),
  ...EQUALITY_METHODS,
});

export const MAP_METHODS = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  len: buildMethodEntry('len', SIG_LEN, mLen),
  keys: buildMethodEntry('keys', 'fn():list', mKeys, true),
  values: buildMethodEntry('values', 'fn():list', mValues, true),
  entries: buildMethodEntry('entries', 'fn():list', mEntries, true),
  ...EQUALITY_METHODS,
});
