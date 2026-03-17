/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */

import type { RillFunction } from '../core/callable.js';
import { callable, isCallable, isDict } from '../core/callable.js';
import type { RuntimeContext } from '../core/types/runtime.js';
import { type SourceLocation, RuntimeError } from '../../types.js';
import { parseSignatureRegistration } from '../../signature-parser.js';
import type { RillValue, RillVector } from '../core/types/structures.js';
import {
  deepEquals,
  formatValue,
  inferType,
  serializeValue,
} from '../core/types/registrations.js';
import { isIterator, isVector } from '../core/types/guards.js';
import { anyTypeValue, isEmpty, structureToTypeValue } from '../core/values.js';
import { invokeCallable } from '../core/eval/index.js';
import { populateBuiltinMethods } from '../core/types/registrations.js';

/** Internal type alias for built-in method implementations. */
type RillMethod = (
  receiver: RillValue,
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;

// ============================================================
// ITERATOR HELPERS
// ============================================================

/**
 * Create an iterator for a list at the given index.
 * Returns { value, done, next } dict.
 */
function makeListIterator(list: RillValue[], index: number): RillValue {
  if (index >= list.length) {
    return { done: true, next: callable(() => makeListIterator(list, index)) };
  }
  return {
    value: list[index]!,
    done: false,
    next: callable(() => makeListIterator(list, index + 1)),
  };
}

/**
 * Create an iterator for a string at the given index.
 * Returns { value, done, next } dict.
 */
function makeStringIterator(str: string, index: number): RillValue {
  if (index >= str.length) {
    return { done: true, next: callable(() => makeStringIterator(str, index)) };
  }
  return {
    value: str[index]!,
    done: false,
    next: callable(() => makeStringIterator(str, index + 1)),
  };
}

/**
 * Create an iterator for a dict at the given index.
 * Dict iteration yields { key, value } entries sorted by key.
 */
function makeDictIterator(
  dict: Record<string, RillValue>,
  index: number
): RillValue {
  const keys = Object.keys(dict).sort();
  if (index >= keys.length) {
    return {
      done: true,
      next: callable(() => makeDictIterator(dict, index)),
    };
  }
  const key = keys[index]!;
  return {
    value: { key, value: dict[key]! },
    done: false,
    next: callable(() => makeDictIterator(dict, index + 1)),
  };
}

/**
 * Check if a value is a rill iterator (dict with value, done, next fields).
 */

export const BUILTIN_FUNCTIONS: Record<string, RillFunction> = {
  /** Identity function - returns its argument */
  identity: {
    params: [
      {
        name: 'value',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args) => args['value'] ?? null,
  },

  /** Log a value and return it unchanged (passthrough) */
  log: {
    params: [
      {
        name: 'message',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args, ctx) => {
      // log is in UNTYPED_BUILTINS (allows excess args), receives positional array cast as Record.
      // Use index 0 for the message value.
      const value = (args as unknown as RillValue[])[0] ?? null;
      const message = formatValue(value);
      (ctx as RuntimeContext).callbacks.onLog(message);
      return value;
    },
  },

  /** Convert any value to JSON string (throws RuntimeError RILL-R004 on closures, tuples, vectors) */
  json: {
    params: [
      {
        name: 'value',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: structureToTypeValue({ kind: 'string' }),
    fn: (args, _ctx, location) => {
      const value = args['value'] ?? null;
      try {
        const jsonValue = serializeValue(value);
        return JSON.stringify(jsonValue);
      } catch (err) {
        // Wrap serialization errors (RILL-R067 from protocol) as RILL-R004
        if (err instanceof Error) {
          throw new RuntimeError('RILL-R004', err.message, location);
        }
        throw err;
      }
    },
  },

  /**
   * Enumerate a list or dict, returning list of indexed dicts.
   * List: enumerate([10, 20]) -> [[index: 0, value: 10], [index: 1, value: 20]]
   * Dict: enumerate([a: 1]) -> [[index: 0, key: "a", value: 1]]
   */
  enumerate: {
    params: [
      {
        name: 'items',
        type: {
          kind: 'union',
          members: [{ kind: 'list' }, { kind: 'dict' }, { kind: 'string' }],
        },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: structureToTypeValue({ kind: 'list' }),
    fn: (args) => {
      const input: RillValue = args['items'] ?? null;
      if (Array.isArray(input)) {
        return input.map((value, index) => ({ index, value }));
      }
      if (isDict(input)) {
        const keys = Object.keys(input).sort();
        return keys.map((key, index) => ({
          index,
          key,
          value: input[key]!,
        }));
      }
      return [];
    },
  },

  /**
   * Create an iterator that generates a sequence of numbers.
   * range(start, end, step=1) - generates [start, start+step, ...] up to (but not including) end
   */
  range: {
    params: [
      {
        name: 'start',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'stop',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'step',
        type: { kind: 'number' },
        defaultValue: 1,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args, _ctx, location) => {
      const start = typeof args['start'] === 'number' ? args['start'] : 0;
      const end = typeof args['stop'] === 'number' ? args['stop'] : 0;
      const step = typeof args['step'] === 'number' ? args['step'] : 1;

      if (step === 0) {
        throw new RuntimeError(
          'RILL-R001',
          'range step cannot be zero',
          location
        );
      }

      const makeRangeIterator = (current: number): RillValue => {
        const done =
          step > 0 ? current >= end : step < 0 ? current <= end : true;
        if (done) {
          return {
            done: true,
            next: callable(() => makeRangeIterator(current)),
          };
        }
        return {
          value: current,
          done: false,
          next: callable(() => makeRangeIterator(current + step)),
        };
      };

      return makeRangeIterator(start);
    },
  },

  /**
   * Create an iterator that repeats a value n times.
   * repeat(value, count) - generates value repeated count times
   */
  repeat: {
    params: [
      {
        name: 'value',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'count',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args, _ctx, location) => {
      const value = args['value'] ?? '';
      const count =
        typeof args['count'] === 'number' ? Math.floor(args['count']) : 0;

      if (count < 0) {
        throw new RuntimeError(
          'RILL-R001',
          'repeat count cannot be negative',
          location
        );
      }

      const makeRepeatIterator = (remaining: number): RillValue => {
        if (remaining <= 0) {
          return {
            done: true,
            next: callable(() => makeRepeatIterator(0)),
          };
        }
        return {
          value,
          done: false,
          next: callable(() => makeRepeatIterator(remaining - 1)),
        };
      };

      return makeRepeatIterator(count);
    },
  },

  /**
   * Pipe a value through one or more closures, left-to-right.
   * chain(value, closure)        -> closure(value)
   * chain(value, [f, g, h])     -> h(g(f(value)))
   * chain(value, [])             -> value unchanged
   * Non-closure/non-list second arg throws RILL-R040 (EC-14).
   */
  chain: {
    params: [
      {
        name: 'value',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'transform',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      // chain is in UNTYPED_BUILTINS, receives positional array cast as Record.
      // Pipe position: 5 -> chain($closure) sends args=[$closure] with pipeValue=5.
      // Detect this by checking if there is exactly one arg and a pipe value is set.
      const positional = args as unknown as RillValue[];
      let value: RillValue;
      let arg: RillValue;
      if (positional.length === 1 && ctx.pipeValue !== null) {
        value = ctx.pipeValue;
        arg = positional[0] ?? null;
      } else {
        value = positional[0] ?? null;
        arg = positional[1] ?? null;
      }

      if (Array.isArray(arg)) {
        // List of closures: fold left-to-right
        let result = value;
        for (const item of arg) {
          if (!isCallable(item)) {
            throw new RuntimeError(
              'RILL-R040',
              `chain: list element must be a closure, got ${inferType(item)}`,
              location
            );
          }
          result = await invokeCallable(
            item,
            [result],
            ctx as RuntimeContext,
            location
          );
        }
        return result;
      }

      if (isCallable(arg)) {
        // Single closure: invoke with value
        return invokeCallable(arg, [value], ctx as RuntimeContext, location);
      }

      throw new RuntimeError(
        'RILL-R040',
        `chain: second argument must be a closure or list of closures, got ${inferType(arg)}`,
        location
      );
    },
  },
};

// ============================================================
// BUILT-IN METHODS
// ============================================================

/** Receiver param prepended to every method's param list */
const RECEIVER_PARAM = {
  name: 'receiver',
  type: { kind: 'any' } as const,
  defaultValue: undefined,
  annotations: {},
} as const;

/**
 * Build a RillFunction entry from a method body and its signature string.
 * Wraps `method(receiver, args, ctx, location)` as `fn(args, ctx, location)`
 * where receiver is the first param by declaration order (named 'receiver').
 * Parses the signature to extract params and returnType so that task 1.4
 * can use them directly without re-parsing.
 *
 * EC-4: Receiver missing from record raises RILL-R044.
 */
function buildMethodEntry(
  name: string,
  signature: string,
  method: RillMethod,
  skipReceiverValidation?: boolean
): RillFunction {
  const parsed = parseSignatureRegistration(signature, name);
  const methodParams = parsed.params;
  return {
    params: [RECEIVER_PARAM, ...methodParams],
    fn: (args, ctx, location) => {
      if (!('receiver' in args)) {
        throw new RuntimeError(
          'RILL-R044',
          "Missing required parameter 'receiver'",
          location
        );
      }
      const receiver = args['receiver'] ?? null;
      // Reconstruct positional args array for RillMethod from named params in order.
      // UNVALIDATED_METHOD_PARAMS methods pass __positionalArgs to preserve actual
      // arg count so method body arity checks (args.length !== 1) fire correctly.
      const positionalArgs: RillValue[] =
        '__positionalArgs' in args
          ? (args['__positionalArgs'] as unknown as RillValue[])
          : methodParams.map((p) => args[p.name] ?? null);
      return method(receiver, positionalArgs, ctx as RuntimeContext, location);
    },
    annotations:
      parsed.description !== undefined
        ? { description: parsed.description }
        : {},
    returnType:
      parsed.returnType !== undefined
        ? structureToTypeValue(parsed.returnType)
        : anyTypeValue,
    ...(skipReceiverValidation ? { skipReceiverValidation: true } : {}),
  };
}

export const BUILTIN_METHODS: {
  string: Record<string, RillFunction>;
  list: Record<string, RillFunction>;
  dict: Record<string, RillFunction>;
  number: Record<string, RillFunction>;
  bool: Record<string, RillFunction>;
  vector: Record<string, RillFunction>;
} = {
  string: null as unknown as Record<string, RillFunction>,
  list: null as unknown as Record<string, RillFunction>,
  dict: null as unknown as Record<string, RillFunction>,
  number: null as unknown as Record<string, RillFunction>,
  bool: null as unknown as Record<string, RillFunction>,
  vector: null as unknown as Record<string, RillFunction>,
};
// ============================================================
// METHOD BODIES
// Defined as named RillMethod constants so they can be shared
// across type groups (e.g. len appears in string, list, dict).
// ============================================================

/** Get length of string, list, or dict */
const mLen: RillMethod = (receiver) => {
  if (typeof receiver === 'string') return receiver.length;
  if (Array.isArray(receiver)) return receiver.length;
  if (receiver && typeof receiver === 'object') {
    return Object.keys(receiver).length;
  }
  return 0;
};

/** Trim whitespace from string */
const mTrim: RillMethod = (receiver) => formatValue(receiver).trim();

/** Get first element of list or first char of string */
const mHead: RillMethod = (receiver, _args, _ctx, location) => {
  if (Array.isArray(receiver)) {
    if (receiver.length === 0) {
      throw new RuntimeError(
        'RILL-R002',
        'Cannot get head of empty list',
        location
      );
    }
    return receiver[0]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        'RILL-R002',
        'Cannot get head of empty string',
        location
      );
    }
    return receiver[0]!;
  }
  throw new RuntimeError(
    'RILL-R003',
    `head requires list or string, got ${inferType(receiver)}`,
    location
  );
};

/** Get last element of list or last char of string */
const mTail: RillMethod = (receiver, _args, _ctx, location) => {
  if (Array.isArray(receiver)) {
    if (receiver.length === 0) {
      throw new RuntimeError(
        'RILL-R002',
        'Cannot get tail of empty list',
        location
      );
    }
    return receiver[receiver.length - 1]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        'RILL-R002',
        'Cannot get tail of empty string',
        location
      );
    }
    return receiver[receiver.length - 1]!;
  }
  throw new RuntimeError(
    'RILL-R003',
    `tail requires list or string, got ${inferType(receiver)}`,
    location
  );
};

/** Get iterator at first position for any collection */
const mFirst: RillMethod = (receiver, _args, _ctx, location) => {
  if (isIterator(receiver)) return receiver;
  if (Array.isArray(receiver)) return makeListIterator(receiver, 0);
  if (typeof receiver === 'string') return makeStringIterator(receiver, 0);
  if (isDict(receiver))
    return makeDictIterator(receiver as Record<string, RillValue>, 0);
  throw new RuntimeError(
    'RILL-R003',
    `first requires list, string, dict, or iterator, got ${inferType(receiver)}`,
    location
  );
};

/** Get element at index */
const mAt: RillMethod = (receiver, args, _ctx, location) => {
  const idx = typeof args[0] === 'number' ? args[0] : 0;
  if (Array.isArray(receiver)) {
    if (idx < 0 || idx >= receiver.length) {
      throw new RuntimeError(
        'RILL-R002',
        `List index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
  }
  if (typeof receiver === 'string') {
    if (idx < 0 || idx >= receiver.length) {
      throw new RuntimeError(
        'RILL-R002',
        `String index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
  }
  throw new RuntimeError(
    'RILL-R003',
    `Cannot call .at() on ${typeof receiver}`,
    location
  );
};

/** Split string by separator */
const mSplit: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const sep = typeof args[0] === 'string' ? args[0] : '\n';
  return str.split(sep);
};

/** Join list elements with separator */
const mJoin: RillMethod = (receiver, args) => {
  const sep = typeof args[0] === 'string' ? args[0] : ',';
  if (!Array.isArray(receiver)) return formatValue(receiver);
  return receiver.map(formatValue).join(sep);
};

/** Split string into lines */
const mLines: RillMethod = (receiver) => formatValue(receiver).split('\n');

/** Check if value is empty */
const mEmpty: RillMethod = (receiver) => isEmpty(receiver);

/** Check if string starts with prefix */
const mStartsWith: RillMethod = (receiver, args) =>
  formatValue(receiver).startsWith(formatValue(args[0] ?? ''));

/** Check if string ends with suffix */
const mEndsWith: RillMethod = (receiver, args) =>
  formatValue(receiver).endsWith(formatValue(args[0] ?? ''));

/** Convert string to lowercase */
const mLower: RillMethod = (receiver) => formatValue(receiver).toLowerCase();

/** Convert string to uppercase */
const mUpper: RillMethod = (receiver) => formatValue(receiver).toUpperCase();

/** Replace first regex match */
const mReplace: RillMethod = (receiver, args) => {
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
const mReplaceAll: RillMethod = (receiver, args) => {
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
const mContains: RillMethod = (receiver, args) =>
  formatValue(receiver).includes(formatValue(args[0] ?? ''));

/** First regex match info, or empty dict if no match */
const mMatch: RillMethod = (receiver, args) => {
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
const mIsMatch: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const pattern = formatValue(args[0] ?? '');
  try {
    return new RegExp(pattern).test(str);
  } catch {
    return false;
  }
};

/** Position of first substring occurrence (-1 if not found) */
const mIndexOf: RillMethod = (receiver, args) =>
  formatValue(receiver).indexOf(formatValue(args[0] ?? ''));

/** Repeat string n times */
const mRepeat: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const n = typeof args[0] === 'number' ? Math.max(0, Math.floor(args[0])) : 0;
  return str.repeat(n);
};

/** Pad start to length with fill string */
const mPadStart: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  return str.padStart(length, fill);
};

/** Pad end to length with fill string */
const mPadEnd: RillMethod = (receiver, args) => {
  const str = formatValue(receiver);
  const length = typeof args[0] === 'number' ? args[0] : str.length;
  const fill = typeof args[1] === 'string' ? args[1] : ' ';
  return str.padEnd(length, fill);
};

/** Equality check (deep structural comparison) */
const mEq: RillMethod = (receiver, args) =>
  deepEquals(receiver, args[0] ?? null);

/** Inequality check (deep structural comparison) */
const mNe: RillMethod = (receiver, args) =>
  !deepEquals(receiver, args[0] ?? null);

/** Less-than comparison (number or string) */
const mLt: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver < arg;
  return formatValue(receiver) < formatValue(arg ?? '');
};

/** Greater-than comparison (number or string) */
const mGt: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver > arg;
  return formatValue(receiver) > formatValue(arg ?? '');
};

/** Less-than-or-equal comparison (number or string) */
const mLe: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver <= arg;
  return formatValue(receiver) <= formatValue(arg ?? '');
};

/** Greater-than-or-equal comparison (number or string) */
const mGe: RillMethod = (receiver, args) => {
  const arg = args[0];
  if (typeof receiver === 'number' && typeof arg === 'number')
    return receiver >= arg;
  return formatValue(receiver) >= formatValue(arg ?? '');
};

/** Get all keys of a dict as a list */
const mKeys: RillMethod = (receiver) =>
  isDict(receiver) ? Object.keys(receiver) : [];

/** Get all values of a dict as a list */
const mValues: RillMethod = (receiver) =>
  isDict(receiver) ? Object.values(receiver) : [];

/** Get all entries of a dict as a list of [key, value] pairs */
const mEntries: RillMethod = (receiver) =>
  isDict(receiver) ? Object.entries(receiver).map(([k, v]) => [k, v]) : [];

/** Check if list contains value (deep equality) */
const mHas: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `has() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      'RILL-R001',
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
const mHasAny: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `has_any() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      'RILL-R001',
      `has_any() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      'RILL-R001',
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
const mHasAll: RillMethod = (receiver, args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `has_all() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      'RILL-R001',
      `has_all() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      'RILL-R001',
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

/** Get number of dimensions in vector */
const mDimensions: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `dimensions requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return receiver.data.length;
};

/** Get model name of vector */
const mModel: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `model requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return receiver.model;
};

/** Calculate cosine similarity between two vectors (range [-1, 1]) */
const mSimilarity: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `similarity requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      'RILL-R003',
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      'RILL-R003',
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
const mDot: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `dot requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      'RILL-R003',
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      'RILL-R003',
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
const mDistance: RillMethod = (receiver, args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
      `distance requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      'RILL-R003',
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      'RILL-R003',
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
const mNorm: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
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
const mNormalize: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      'RILL-R003',
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

// ============================================================
// PER-TYPE METHOD RECORDS
// Populate BUILTIN_METHODS sub-records using buildMethodEntry.
// Methods shared across types reference the same RillMethod body.
// Cross-type methods (len, empty, eq, ne, head, tail, first, at,
// lt, gt, le, ge) appear in every type group they support.
// Vector methods live in the `vector` group (6th group beyond
// the 5 basic types) because no basic type covers vectors.
// ============================================================

// Shared signatures for cross-type methods
const SIG_LEN = '||:number';
const SIG_EMPTY = '||:bool';
const SIG_HEAD = '||:any';
const SIG_TAIL = '||:any';
const SIG_FIRST = '||:iterator';
const SIG_AT = '|index: number|:any';
const SIG_EQ = '|other: any|:bool';
const SIG_NE = '|other: any|:bool';
const SIG_CMP = '|other: any|:bool';

BUILTIN_METHODS.string = Object.freeze({
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

BUILTIN_METHODS.list = Object.freeze({
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
});

BUILTIN_METHODS.dict = Object.freeze({
  len: buildMethodEntry('len', SIG_LEN, mLen),
  first: buildMethodEntry('first', SIG_FIRST, mFirst, true),
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
  keys: buildMethodEntry('keys', '||:list', mKeys, true),
  values: buildMethodEntry('values', '||:list', mValues, true),
  entries: buildMethodEntry('entries', '||:list', mEntries, true),
});

BUILTIN_METHODS.number = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
  lt: buildMethodEntry('lt', SIG_CMP, mLt),
  gt: buildMethodEntry('gt', SIG_CMP, mGt),
  le: buildMethodEntry('le', SIG_CMP, mLe),
  ge: buildMethodEntry('ge', SIG_CMP, mGe),
});

BUILTIN_METHODS.bool = Object.freeze({
  empty: buildMethodEntry('empty', SIG_EMPTY, mEmpty),
  eq: buildMethodEntry('eq', SIG_EQ, mEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mNe, true),
});

// [ASSUMPTION] vector is a 6th group beyond the 5 specified basic types.
// The 7 vector methods do not belong to string/list/dict/number/bool.
// Adding this group ensures all 42 methods are accessible (AC-36).
BUILTIN_METHODS.vector = Object.freeze({
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

// Populate registration methods from BUILTIN_METHODS at module load time.
// No circular dependency: type-registrations.ts does not import builtins.ts.
populateBuiltinMethods(BUILTIN_METHODS);
