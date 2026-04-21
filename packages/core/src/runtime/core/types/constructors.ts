/**
 * Value Constructors
 *
 * Factory functions for creating Rill compound values (tuples, ordered,
 * vectors) and collection utilities (emptyForType, copyValue).
 *
 * Import constraints:
 * - Imports from ./structures.js and ./guards.js
 * - No imports from values.ts or callable.ts
 */

import type {
  RillOrdered,
  RillStream,
  RillTuple,
  RillValue,
  RillVector,
  TypeStructure,
} from './structures.js';
import {
  isCallable,
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isTypeValue,
  isVector,
} from './guards.js';
import { callable } from '../callable.js';
import { RuntimeError } from '../../../types.js';

/**
 * Create ordered from entries array (named, preserves insertion order).
 * Entries may be 2-element [name, value] or 3-element [name, value, default]
 * tuples; the third element carries a default value for `.^input` reflection.
 */
export function createOrdered(
  entries: [string, RillValue, RillValue?][]
): RillOrdered {
  return Object.freeze({ __rill_ordered: true, entries: [...entries] });
}

/** Create tuple from entries array (positional, preserves order) */
export function createTuple(entries: RillValue[]): RillTuple {
  return Object.freeze({ __rill_tuple: true, entries: [...entries] });
}

/**
 * Create vector from Float32Array with model name.
 * @throws {RuntimeError} RILL-R074 if data.length is 0 (zero-dimension vectors not allowed)
 */
export function createVector(data: Float32Array, model: string): RillVector {
  if (data.length === 0) {
    throw new RuntimeError(
      'RILL-R074',
      'Vector data must have at least one dimension'
    );
  }
  return { __rill_vector: true, data, model };
}

/**
 * Create an empty collection value matching the given TypeStructure.
 * Assumes the type is dict, ordered, or tuple.
 */
export function emptyForType(type: TypeStructure): RillValue {
  if (type.kind === 'dict') return {};
  if (type.kind === 'ordered') return createOrdered([]);
  if (type.kind === 'tuple') return createTuple([]);
  return {};
}

/**
 * Create a RillStream from an AsyncIterable of chunks and a resolve function.
 *
 * The stream is a linked-list of steps. Each `.next` call advances to the
 * next chunk. Once exhausted, `done` becomes true and re-iteration throws
 * RILL-R002. The `resolve` function is called after chunk exhaustion (or on
 * direct invocation) and caches its result for idempotent access.
 *
 * @throws {RuntimeError} RILL-R003 if chunks is not an AsyncIterable
 * @throws {RuntimeError} RILL-R003 if resolve is not a function
 */
export function createRillStream(options: {
  chunks: AsyncIterable<RillValue>;
  resolve: () => Promise<RillValue>;
  dispose?: (() => void) | undefined;
  chunkType?: TypeStructure | undefined;
  retType?: TypeStructure | undefined;
}): RillStream {
  const { chunks, resolve, dispose, chunkType, retType } = options;

  // Validate chunks is AsyncIterable
  if (
    chunks === null ||
    chunks === undefined ||
    typeof (chunks as AsyncIterable<RillValue>)[Symbol.asyncIterator] !==
      'function'
  ) {
    throw new RuntimeError(
      'RILL-R003',
      'createRillStream requires AsyncIterable chunks'
    );
  }

  // Validate resolve is a function
  if (typeof resolve !== 'function') {
    throw new RuntimeError(
      'RILL-R003',
      'createRillStream requires resolve function'
    );
  }

  const iterator = chunks[Symbol.asyncIterator]();
  let exhausted = false;
  let disposed = false;
  let cachedResolution: { value: RillValue } | undefined;

  /** Idempotent resolve wrapper that caches the resolution value. */
  async function resolveOnce(): Promise<RillValue> {
    if (cachedResolution !== undefined) return cachedResolution.value;
    const value = await resolve();
    cachedResolution = { value };
    return value;
  }

  /** Build a stream step from an iterator result. */
  function makeStep(
    iterResult: IteratorResult<RillValue, undefined>
  ): RillStream {
    if (iterResult.done) {
      exhausted = true;
      if (!disposed && dispose) {
        disposed = true;
        try {
          dispose();
        } catch (err) {
          // EC-15: Propagate dispose errors as RILL-R002. Wrapping
          // ensures the throw is a structured halt (RillError) rather
          // than a plain Error that the extension-boundary reshape
          // would convert to #R999.
          if (err instanceof RuntimeError) throw err;
          throw new RuntimeError(
            'RILL-R002',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
      const doneStep: RillStream = {
        __rill_stream: true,
        done: true,
        next: callable(() => {
          throw new RuntimeError(
            'RILL-R002',
            'Stream already consumed; cannot re-iterate'
          );
        }),
      };
      return doneStep;
    }
    let stale = false;
    const step: RillStream = {
      __rill_stream: true,
      done: false,
      value: iterResult.value,
      next: callable(async () => {
        if (stale) {
          throw new RuntimeError(
            'RILL-R002',
            'Stream already consumed; cannot re-iterate'
          );
        }
        if (exhausted) {
          throw new RuntimeError(
            'RILL-R002',
            'Stream already consumed; cannot re-iterate'
          );
        }
        stale = true;
        const next = await iterator.next();
        return makeStep(next);
      }),
    };
    return step;
  }

  // Build initial step: eagerly fetch the first chunk
  // The stream object itself is a "pending" step that advances on first .next call
  let initialized = false;
  const stream: RillStream = {
    __rill_stream: true,
    done: false,
    next: callable(async () => {
      if (initialized) {
        throw new RuntimeError(
          'RILL-R002',
          'Stream already consumed; cannot re-iterate'
        );
      }
      initialized = true;
      const first = await iterator.next();
      return makeStep(first);
    }),
  };

  // Attach resolve as a hidden property for runtime access
  Object.defineProperty(stream, '__rill_stream_resolve', {
    value: resolveOnce,
    enumerable: false,
  });

  if (dispose) {
    Object.defineProperty(stream, '__rill_stream_dispose', {
      value: () => {
        if (!disposed) {
          disposed = true;
          dispose();
        }
      },
      enumerable: false,
    });
  }

  if (chunkType) {
    Object.defineProperty(stream, '__rill_stream_chunk_type', {
      value: chunkType,
      enumerable: false,
    });
  }

  if (retType) {
    Object.defineProperty(stream, '__rill_stream_ret_type', {
      value: retType,
      enumerable: false,
    });
  }

  return stream;
}

/**
 * Copy a RillValue.
 * Primitives and immutable compound values return the same reference.
 * Mutable values (list, dict) copy recursively.
 * Iterators return the same reference (not meaningfully copyable).
 */
export function copyValue(value: RillValue): RillValue {
  if (value === null || typeof value !== 'object') return value;
  // Immutable compound types
  if (
    isTuple(value) ||
    isOrdered(value) ||
    isVector(value) ||
    isTypeValue(value) ||
    isCallable(value)
  )
    return value;
  // field_descriptor: immutable (no guard exported from guards.ts)
  if (
    '__rill_field_descriptor' in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)['__rill_field_descriptor'] === true
  )
    return value;
  // Mutable list (Array but not tuple/ordered — those were checked above)
  if (Array.isArray(value)) return (value as RillValue[]).map(copyValue);
  // Iterator: mutable but opaque — return same reference
  if (isIterator(value)) return value;
  // Stream: immutable — return same reference
  if (isStream(value)) return value;
  // Mutable dict
  const dict = value as Record<string, RillValue>;
  const copy: Record<string, RillValue> = {};
  for (const [k, v] of Object.entries(dict)) copy[k] = copyValue(v);
  return copy;
}
