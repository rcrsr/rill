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

// ============================================================
// PER-TYPE METHOD RECORDS
// Populate BUILTIN_METHODS sub-records using buildMethodEntry.
// Methods shared across types reference the same RillMethod body.
// Cross-type methods (len, empty, eq, ne, head, tail, first, at,
// lt, gt, le, ge) appear in every type group they support.
// Vector methods live in the `vector` group (6th group beyond
// the 5 basic types) because no basic type covers vectors.
// ============================================================

export const STRING_METHODS = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  trim: buildMethodEntry('trim', '||:string', mTrim),
  head: buildMethodEntry('head', SIG_HEAD, mHead, true),
  tail: buildMethodEntry('tail', SIG_TAIL, mTail, true),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  at: buildMethodEntry('at', SIG_AT, mAt, true),
  split: buildMethodEntry('split', '|separator: string = "\\n"|:list', mSplit),
  lines: buildMethodEntry('lines', '||:list', mLines),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  starts_with: buildMethodEntry(
    'starts_with',
    '|prefix: string|:bool',
    mStartsWith
  ),
  ends_with: buildMethodEntry('ends_with', '|suffix: string|:bool', mEndsWith),
  lower: buildMethodEntry('lower', '||:string', mLower),
  upper: buildMethodEntry('upper', '||:string', mUpper),
  replace: buildMethodEntry(
    'replace',
    '|pattern: string, replacement: string|:string',
    mReplace
  ),
  replace_all: buildMethodEntry(
    'replace_all',
    '|pattern: string, replacement: string|:string',
    mReplaceAll
  ),
  contains: buildMethodEntry('contains', '|search: string|:bool', mContains),
  match: buildMethodEntry('match', '|pattern: string|:dict', mMatch),
  is_match: buildMethodEntry('is_match', '|pattern: string|:bool', mIsMatch),
  index_of: buildMethodEntry('index_of', '|search: string|:number', mIndexOf),
  repeat: buildMethodEntry('repeat', '|count: number|:string', mRepeat),
  pad_start: buildMethodEntry(
    'pad_start',
    '|length: number, fill: string = " "|:string',
    mPadStart
  ),
  pad_end: buildMethodEntry(
    'pad_end',
    '|length: number, fill: string = " "|:string',
    mPadEnd
  ),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
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
  join: buildMethodEntry('join', '|separator: string = ","|:string', mJoin),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
  has: buildMethodEntry('has', '|value: any|:bool', mHas, true),
  has_any: buildMethodEntry(
    'has_any',
    '|candidates: list|:bool',
    mHasAny,
    true
  ),
  has_all: buildMethodEntry(
    'has_all',
    '|candidates: list|:bool',
    mHasAll,
    true
  ),
  reverse: buildMethodEntry('reverse', '||:list', mReverse),
});

export const DICT_METHODS = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
  keys: buildMethodEntry('keys', '||:list', mKeys, true),
  values: buildMethodEntry('values', '||:list', mValues, true),
  entries: buildMethodEntry('entries', '||:list', mEntries, true),
});

export const NUMBER_METHODS = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
  lt: buildMethodEntry('lt', SIG_CMP, mLt),
  gt: buildMethodEntry('gt', SIG_CMP, mGt),
  le: buildMethodEntry('le', SIG_CMP, mLe),
  ge: buildMethodEntry('ge', SIG_CMP, mGe),
});

export const BOOL_METHODS = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
});

// [ASSUMPTION] vector is a 6th group beyond the 5 specified basic types.
// The 7 vector methods do not belong to string/list/dict/number/bool.
// Adding this group ensures all 42 methods are accessible (AC-36).
export const VECTOR_METHODS = Object.freeze({
  dimensions: buildMethodEntry('dimensions', '||:number', mDimensions, true),
  model: buildMethodEntry('model', '||:string', mModel, true),
  similarity: buildMethodEntry(
    'similarity',
    '|other: any|:number',
    mSimilarity,
    true
  ),
  dot: buildMethodEntry('dot', '|other: any|:number', mDot, true),
  distance: buildMethodEntry(
    'distance',
    '|other: any|:number',
    mDistance,
    true
  ),
  norm: buildMethodEntry('norm', '||:number', mNorm, true),
  normalize: buildMethodEntry('normalize', '||:any', mNormalize, true),
});
