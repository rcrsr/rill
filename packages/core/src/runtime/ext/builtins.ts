/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */

import type { CallableFn } from '../core/callable.js';
import { callable, isCallable, isDict } from '../core/callable.js';
import type { RillMethod, RuntimeContext } from '../core/types.js';
import { RuntimeError } from '../../types.js';
import {
  deepEquals,
  formatValue,
  inferType,
  isEmpty,
  isRillIterator,
  isVector,
  type RillValue,
  type RillVector,
} from '../core/values.js';

// ============================================================
// BUILT-IN FUNCTIONS
// ============================================================

/** Recursively remove closures from a value for JSON serialization */
function stripClosures(value: RillValue): RillValue {
  if (isCallable(value)) {
    return undefined as unknown as RillValue; // Will be filtered out
  }
  if (Array.isArray(value)) {
    return value.filter((v) => !isCallable(v)).map(stripClosures);
  }
  if (isDict(value)) {
    const result: Record<string, RillValue> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!isCallable(v)) {
        result[k] = stripClosures(v);
      }
    }
    return result;
  }
  return value;
}

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

export const BUILTIN_FUNCTIONS: Record<string, CallableFn> = {
  /** Identity function - returns its argument */
  identity: (args) => args[0] ?? null,

  /** Return the type name of a value */
  type: (args) => inferType(args[0] ?? null),

  /** Log a value and return it unchanged (passthrough) */
  log: (args, ctx) => {
    const value = args[0] ?? null;
    // ctx is RuntimeContext but CallableFn uses a minimal interface
    (ctx as RuntimeContext).callbacks.onLog(value);
    return value;
  },

  /** Convert any value to JSON string (errors on direct closure, skips closures in containers) */
  json: (args, _ctx, location) => {
    const value = args[0] ?? null;
    if (isCallable(value)) {
      throw new RuntimeError(
        'RILL-R004',
        'Cannot serialize closure to JSON',
        location
      );
    }
    return JSON.stringify(stripClosures(value));
  },

  /**
   * Enumerate a list or dict, returning list of indexed dicts.
   * List: enumerate([10, 20]) -> [[index: 0, value: 10], [index: 1, value: 20]]
   * Dict: enumerate([a: 1]) -> [[index: 0, key: "a", value: 1]]
   */
  enumerate: (args) => {
    const input: RillValue = args[0] ?? null;
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

  /**
   * Create an iterator that generates a sequence of numbers.
   * range(start, end, step=1) - generates [start, start+step, ...] up to (but not including) end
   */
  range: (args, _ctx, location) => {
    const start = typeof args[0] === 'number' ? args[0] : 0;
    const end = typeof args[1] === 'number' ? args[1] : 0;
    const step = typeof args[2] === 'number' ? args[2] : 1;

    if (step === 0) {
      throw new RuntimeError(
        'RILL-R001',
        'range step cannot be zero',
        location
      );
    }

    const makeRangeIterator = (current: number): RillValue => {
      const done = step > 0 ? current >= end : step < 0 ? current <= end : true;
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

  /**
   * Create an iterator that repeats a value n times.
   * repeat(value, count) - generates value repeated count times
   */
  repeat: (args, _ctx, location) => {
    const value = args[0] ?? '';
    const count = typeof args[1] === 'number' ? Math.floor(args[1]) : 0;

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

  /**
   * Create a tool descriptor from a closure or host function.
   *
   * Call signatures:
   * - tool(name, description, params, closure) - 4 args, arg[3] callable
   * - tool("host_fn::name") - 1 arg, string with :: separator
   * - tool("host_fn::name", overrides) - 2 args, string + dict
   *
   * Returns dict: { name, description, params, fn }
   */
  tool: (args, ctx, location) => {
    // Signature 1: tool(name, description, params, closure) - 4 args
    if (args.length === 4) {
      const name = args[0] ?? '';
      const description = args[1] ?? '';
      const params = args[2] ?? {};
      const fn = args[3] ?? null;

      if (!isCallable(fn)) {
        throw new RuntimeError(
          'RILL-R001',
          'tool() invalid arguments',
          location
        );
      }

      return {
        name,
        description,
        params,
        fn,
      } as Record<string, RillValue>;
    }

    // Signatures 2 & 3: tool("host_fn::name") or tool("host_fn::name", overrides)
    if (args.length === 1 || args.length === 2) {
      const hostRef = args[0];

      if (typeof hostRef !== 'string' || !hostRef.includes('::')) {
        throw new RuntimeError(
          'RILL-R001',
          'tool() invalid arguments',
          location
        );
      }

      const functionName = hostRef;
      const runtimeCtx = ctx as RuntimeContext;
      const hostFunction = runtimeCtx.functions.get(functionName);

      if (!hostFunction) {
        throw new RuntimeError(
          'RILL-R004',
          `function '${functionName}' not found`,
          location
        );
      }

      // Extract metadata from host function
      let description: string = '';
      let params: RillValue = {};

      if (typeof hostFunction === 'object' && 'kind' in hostFunction) {
        // ApplicationCallable with metadata
        description = hostFunction.description ?? '';
        if (hostFunction.params) {
          // Convert CallableParam[] to dict
          const paramsDict: Record<string, RillValue> = {};
          for (const param of hostFunction.params) {
            paramsDict[param.name] = {
              type: param.typeName ?? 'any',
              description: param.description ?? '',
            } as Record<string, RillValue>;
          }
          params = paramsDict;
        }
      }

      // Apply overrides if provided
      if (args.length === 2) {
        const overrides = args[1] ?? null;
        if (!isDict(overrides)) {
          throw new RuntimeError(
            'RILL-R001',
            'tool() invalid arguments',
            location
          );
        }

        // Merge overrides into result
        if (
          'description' in overrides &&
          typeof overrides['description'] === 'string'
        ) {
          description = overrides['description'];
        }
        if ('params' in overrides && isDict(overrides['params'])) {
          params = overrides['params'] as RillValue;
        }
      }

      return {
        name: functionName,
        description,
        params,
        fn: hostFunction as RillValue,
      } as Record<string, RillValue>;
    }

    // Invalid argument count
    throw new RuntimeError('RILL-R001', 'tool() invalid arguments', location);
  },
};

// ============================================================
// BUILT-IN METHODS
// ============================================================

/** Factory for comparison methods (lt, gt, le, ge) */
function createComparisonMethod(
  compare: (a: number | string, b: number | string) => boolean
): RillMethod {
  return (receiver, args) => {
    const arg = args[0];
    if (typeof receiver === 'number' && typeof arg === 'number') {
      return compare(receiver, arg);
    }
    return compare(formatValue(receiver), formatValue(arg ?? ''));
  };
}

export const BUILTIN_METHODS: Record<string, RillMethod> = {
  // === Conversion methods ===

  /** Convert value to string */
  str: (receiver) => formatValue(receiver),

  /** Convert value to number */
  num: (receiver) => {
    if (typeof receiver === 'number') return receiver;
    if (typeof receiver === 'string') {
      const n = parseFloat(receiver);
      if (!isNaN(n)) return n;
    }
    if (typeof receiver === 'boolean') return receiver ? 1 : 0;
    return 0;
  },

  /** Get length of string or array */
  len: (receiver) => {
    if (typeof receiver === 'string') return receiver.length;
    if (Array.isArray(receiver)) return receiver.length;
    if (receiver && typeof receiver === 'object') {
      return Object.keys(receiver).length;
    }
    return 0;
  },

  /** Trim whitespace from string */
  trim: (receiver) => formatValue(receiver).trim(),

  // === Element access methods ===

  /** Get first element of array or first char of string */
  head: (receiver, _args, _ctx, location) => {
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
  },

  /** Get last element of array or last char of string */
  tail: (receiver, _args, _ctx, location) => {
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
  },

  /** Get iterator at first position for any collection */
  first: (receiver, _args, _ctx, location) => {
    // For iterators, return as-is (identity)
    if (isRillIterator(receiver)) {
      return receiver;
    }
    // For lists
    if (Array.isArray(receiver)) {
      return makeListIterator(receiver, 0);
    }
    // For strings
    if (typeof receiver === 'string') {
      return makeStringIterator(receiver, 0);
    }
    // For dicts
    if (isDict(receiver)) {
      return makeDictIterator(receiver as Record<string, RillValue>, 0);
    }
    throw new RuntimeError(
      'RILL-R003',
      `first requires list, string, dict, or iterator, got ${inferType(receiver)}`,
      location
    );
  },

  /** Get element at index */
  at: (receiver, args, _ctx, location) => {
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
  },

  // === String operations ===

  /** Split string by separator (default: newline) */
  split: (receiver, args) => {
    const str = formatValue(receiver);
    const sep = typeof args[0] === 'string' ? args[0] : '\n';
    return str.split(sep);
  },

  /** Join array elements with separator (default: comma) */
  join: (receiver, args) => {
    const sep = typeof args[0] === 'string' ? args[0] : ',';
    if (!Array.isArray(receiver)) return formatValue(receiver);
    return receiver.map(formatValue).join(sep);
  },

  /** Split string into lines (same as .split but newline only) */
  lines: (receiver) => {
    const str = formatValue(receiver);
    return str.split('\n');
  },

  // === Utility methods ===

  /** Check if value is empty */
  empty: (receiver) => isEmpty(receiver),

  // === String methods ===

  /** Check if string starts with prefix */
  starts_with: (receiver, args) => {
    const str = formatValue(receiver);
    const prefix = formatValue(args[0] ?? '');
    return str.startsWith(prefix);
  },

  /** Check if string ends with suffix */
  ends_with: (receiver, args) => {
    const str = formatValue(receiver);
    const suffix = formatValue(args[0] ?? '');
    return str.endsWith(suffix);
  },

  /** Convert string to lowercase */
  lower: (receiver) => formatValue(receiver).toLowerCase(),

  /** Convert string to uppercase */
  upper: (receiver) => formatValue(receiver).toUpperCase(),

  /** Replace first regex match */
  replace: (receiver, args) => {
    const str = formatValue(receiver);
    const pattern = formatValue(args[0] ?? '');
    const replacement = formatValue(args[1] ?? '');
    try {
      return str.replace(new RegExp(pattern), replacement);
    } catch {
      return str;
    }
  },

  /** Replace all regex matches */
  replace_all: (receiver, args) => {
    const str = formatValue(receiver);
    const pattern = formatValue(args[0] ?? '');
    const replacement = formatValue(args[1] ?? '');
    try {
      return str.replace(new RegExp(pattern, 'g'), replacement);
    } catch {
      return str;
    }
  },

  /** Check if string contains substring */
  contains: (receiver, args) => {
    const str = formatValue(receiver);
    const search = formatValue(args[0] ?? '');
    return str.includes(search);
  },

  /**
   * First regex match info, or empty dict if no match.
   * Returns: [matched: string, index: number, groups: []]
   */
  match: (receiver, args) => {
    const str = formatValue(receiver);
    const pattern = formatValue(args[0] ?? '');
    try {
      const m = new RegExp(pattern).exec(str);
      if (!m) return {};
      return {
        matched: m[0],
        index: m.index,
        groups: m.slice(1),
      };
    } catch {
      return {};
    }
  },

  /** True if regex matches anywhere in string */
  is_match: (receiver, args) => {
    const str = formatValue(receiver);
    const pattern = formatValue(args[0] ?? '');
    try {
      return new RegExp(pattern).test(str);
    } catch {
      return false;
    }
  },

  /** Position of first substring occurrence (-1 if not found) */
  index_of: (receiver, args) => {
    const str = formatValue(receiver);
    const search = formatValue(args[0] ?? '');
    return str.indexOf(search);
  },

  /** Repeat string n times */
  repeat: (receiver, args) => {
    const str = formatValue(receiver);
    const n =
      typeof args[0] === 'number' ? Math.max(0, Math.floor(args[0])) : 0;
    return str.repeat(n);
  },

  /** Pad start to length with fill string */
  pad_start: (receiver, args) => {
    const str = formatValue(receiver);
    const length = typeof args[0] === 'number' ? args[0] : str.length;
    const fill = typeof args[1] === 'string' ? args[1] : ' ';
    return str.padStart(length, fill);
  },

  /** Pad end to length with fill string */
  pad_end: (receiver, args) => {
    const str = formatValue(receiver);
    const length = typeof args[0] === 'number' ? args[0] : str.length;
    const fill = typeof args[1] === 'string' ? args[1] : ' ';
    return str.padEnd(length, fill);
  },

  // === Comparison methods ===

  /** Equality check (deep structural comparison) */
  eq: (receiver, args) => deepEquals(receiver, args[0] ?? null),

  /** Inequality check (deep structural comparison) */
  ne: (receiver, args) => !deepEquals(receiver, args[0] ?? null),

  /** Less than */
  lt: createComparisonMethod((a, b) => a < b),

  /** Greater than */
  gt: createComparisonMethod((a, b) => a > b),

  /** Less than or equal */
  le: createComparisonMethod((a, b) => a <= b),

  /** Greater than or equal */
  ge: createComparisonMethod((a, b) => a >= b),

  // === Dict methods (reserved) ===

  /** Get all keys of a dict as a tuple of strings */
  keys: (receiver) => {
    if (isDict(receiver)) {
      return Object.keys(receiver);
    }
    return [];
  },

  /** Get all values of a dict as a tuple */
  values: (receiver) => {
    if (isDict(receiver)) {
      return Object.values(receiver);
    }
    return [];
  },

  /** Get all entries of a dict as a tuple of [key, value] pairs */
  entries: (receiver) => {
    if (isDict(receiver)) {
      return Object.entries(receiver).map(([k, v]) => [k, v]);
    }
    return [];
  },

  // === List membership methods ===

  /** Check if list contains value (deep equality) */
  has: (receiver, args, _ctx, location) => {
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
      if (deepEquals(item, searchValue)) {
        return true;
      }
    }
    return false;
  },

  /** Check if list contains any value from candidates (deep equality) */
  has_any: (receiver, args, _ctx, location) => {
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
    // Short-circuit on first match
    for (const candidate of candidates) {
      for (const item of receiver) {
        if (deepEquals(item, candidate)) {
          return true;
        }
      }
    }
    return false;
  },

  /** Check if list contains all values from candidates (deep equality) */
  has_all: (receiver, args, _ctx, location) => {
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
    // Short-circuit on first mismatch
    for (const candidate of candidates) {
      let found = false;
      for (const item of receiver) {
        if (deepEquals(item, candidate)) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  },

  // === Vector methods ===

  /** Get number of dimensions in vector */
  dimensions: (receiver, _args, _ctx, location) => {
    if (!isVector(receiver)) {
      throw new RuntimeError(
        'RILL-R003',
        `dimensions requires vector receiver, got ${inferType(receiver)}`,
        location
      );
    }
    return receiver.data.length;
  },

  /** Get model name of vector */
  model: (receiver, _args, _ctx, location) => {
    if (!isVector(receiver)) {
      throw new RuntimeError(
        'RILL-R003',
        `model requires vector receiver, got ${inferType(receiver)}`,
        location
      );
    }
    return receiver.model;
  },

  /** Calculate cosine similarity between two vectors (range [-1, 1]) */
  similarity: (receiver, args, _ctx, location) => {
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

    // Cosine similarity: dot(a, b) / (norm(a) * norm(b))
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
  },

  /** Calculate dot product between two vectors */
  dot: (receiver, args, _ctx, location) => {
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
  },

  /** Calculate Euclidean distance between two vectors (>= 0) */
  distance: (receiver, args, _ctx, location) => {
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
  },

  /** Calculate L2 norm (magnitude) of vector */
  norm: (receiver, _args, _ctx, location) => {
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
  },

  /** Create unit vector (preserves model) */
  normalize: (receiver, _args, _ctx, location) => {
    if (!isVector(receiver)) {
      throw new RuntimeError(
        'RILL-R003',
        `normalize requires vector receiver, got ${inferType(receiver)}`,
        location
      );
    }

    // Calculate norm
    let sumSquares = 0;
    for (let i = 0; i < receiver.data.length; i++) {
      const val = receiver.data[i]!;
      sumSquares += val * val;
    }
    const magnitude = Math.sqrt(sumSquares);

    // If zero vector, return as-is
    if (magnitude === 0) {
      return receiver;
    }

    // Create normalized vector
    const normalized = new Float32Array(receiver.data.length);
    for (let i = 0; i < receiver.data.length; i++) {
      normalized[i] = receiver.data[i]! / magnitude;
    }

    return {
      __rill_vector: true,
      data: normalized,
      model: receiver.model,
    } satisfies RillVector;
  },
};
