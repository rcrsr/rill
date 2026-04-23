/**
 * CollectionsMixin: iterable helpers
 *
 * Provides exported iterable helper functions:
 * - getIterableElements: expand any iterable to a flat list
 * - expandIterator: drive an iterator protocol to completion
 * - expandStream: drain an async stream to a list
 *
 * The CollectionsMixin class wraps these helpers for evaluator access.
 * The evaluate* operator methods (each/map/fold/filter) are removed (IC-3/IC-4).
 *
 * @internal
 */

import type { SourceLocation } from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import {
  isDatetime,
  isDuration,
  isIterator,
  isStream,
  isVector,
} from '../../types/guards.js';
import type { RillStream } from '../../types/structures.js';
import type { RuntimeContext } from '../../types/runtime.js';
import { BreakSignal } from '../../signals.js';
import { isCallable, isDict } from '../../callable.js';
import { throwTypeHalt } from '../../types/halt.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import { getEvaluator } from '../evaluator.js';

/**
 * Default maximum iteration count for iterators.
 * Can be overridden with ^(limit: N) annotation.
 */
const DEFAULT_MAX_ITERATIONS = 10000;

// ============================================================
// EXPORTED ITERABLE HELPERS (IC-3)
// ============================================================

/**
 * Get elements from an iterable value (list, string, dict, iterator, or stream).
 *
 * Raises RILL-R003 for vector input (EC-6).
 * Raises RILL-R002 for non-iterable input (EC-5).
 *
 * @param input - The value to iterate over
 * @param ctx - Runtime context (used by iterator/stream expansion)
 * @param node - AST node providing span for error locations
 * @param limit - Maximum iteration count (default: DEFAULT_MAX_ITERATIONS)
 */
export async function getIterableElements(
  input: RillValue,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } },
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<RillValue[]> {
  // Vector guard [EC-6, RILL-R003]
  if (isVector(input)) {
    throw new RuntimeError(
      'RILL-R003',
      'Collection operators require list, string, dict, iterator, or stream, got vector',
      node.span.start
    );
  }
  // Datetime/Duration guard: these are plain objects but not iterable
  if (isDatetime(input) || isDuration(input)) {
    throw new RuntimeError(
      'RILL-R002',
      `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`,
      node.span.start
    );
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === 'string') {
    return [...input];
  }
  // Check for stream BEFORE iterator (streams satisfy iterator shape)
  if (isStream(input)) {
    return expandStream(input, ctx, node, limit);
  }
  // Check for iterator protocol BEFORE generic dict handling
  if (isIterator(input)) {
    return expandIterator(input, ctx, node, limit);
  }
  if (isDict(input)) {
    // Dict iteration: sorted keys, each element is { key, value }
    const keys = Object.keys(input).sort();
    return keys.map((key) => ({
      key,
      value: (input as Record<string, RillValue>)[key]!,
    }));
  }
  // Non-iterable [EC-5, RILL-R002]
  throw new RuntimeError(
    'RILL-R002',
    `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`,
    node.span.start
  );
}

/**
 * Expand an iterator to a list of values.
 * Respects iteration limits to prevent infinite loops.
 *
 * @param iterator - The iterator value ({ done, value, next })
 * @param ctx - Runtime context used for abort checks and callable invocation
 * @param node - AST node providing span for error locations
 * @param limit - Maximum iteration count (default: DEFAULT_MAX_ITERATIONS)
 */
async function expandIterator(
  iterator: RillValue,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } },
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<RillValue[]> {
  const evaluator = getEvaluator(ctx);
  const elements: RillValue[] = [];
  let current = iterator as Record<string, RillValue>;
  let count = 0;

  while (!current['done'] && count < limit) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (evaluator as any).checkAborted();
    const val = current['value'];
    if (val !== undefined) {
      elements.push(val);
    }
    count++;

    // Invoke next() to get the next iterator
    const nextClosure = current['next'];
    if (nextClosure === undefined || !isCallable(nextClosure)) {
      throw new RuntimeError(
        'RILL-R002',
        'Iterator .next must be a closure',
        node.span.start
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextIterator = await (evaluator as any).invokeCallable(
      nextClosure,
      [],
      node.span.start,
      'next'
    );
    if (typeof nextIterator !== 'object' || nextIterator === null) {
      throw new RuntimeError(
        'RILL-R002',
        'Iterator .next must return iterator',
        node.span.start
      );
    }
    current = nextIterator as Record<string, RillValue>;
  }

  if (count >= limit) {
    throw new RuntimeError(
      'RILL-R010',
      `Iterator expansion exceeded ${limit} iterations`,
      node.span.start,
      { limit, iterations: count }
    );
  }

  return elements;
}

/**
 * Expand a stream to a list of chunk values.
 * Consumes async chunks by repeatedly calling the stream's next callable.
 * Respects iteration limits to prevent unbounded expansion.
 *
 * On BreakSignal, calls the stream's dispose callable (if present)
 * before re-throwing (NFR-STREAM-2).
 *
 * @param stream - The stream value ({ __rill_stream, done, value, next })
 * @param ctx - Runtime context used for abort checks, callable invocation, and sourceId
 * @param node - AST node providing span for error locations
 * @param limit - Maximum iteration count (default: DEFAULT_MAX_ITERATIONS)
 */
async function expandStream(
  stream: RillStream,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } },
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<RillValue[]> {
  const evaluator = getEvaluator(ctx);
  const elements: RillValue[] = [];
  let current: RillStream = stream;
  let count = 0;
  let expectedType: string | undefined;

  try {
    while (!current.done && count < limit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (evaluator as any).checkAborted();
      const val = current['value'];
      if (val !== undefined) {
        const actualType = inferType(val);
        if (expectedType === undefined) {
          expectedType = actualType;
        } else if (actualType !== expectedType) {
          throwTypeHalt(
            {
              location: node.span.start,
              sourceId: ctx.sourceId,
              fn: 'stream-chunk',
            },
            'TYPE_MISMATCH',
            `Stream chunk type mismatch: expected ${expectedType}, got ${actualType}`,
            'runtime',
            { expectedType, actualType }
          );
        }
        elements.push(val);
      }
      count++;

      // Invoke next() to advance the stream
      const nextClosure = current['next'];
      if (nextClosure === undefined || !isCallable(nextClosure)) {
        throw new RuntimeError(
          'RILL-R002',
          'Stream .next must be a closure',
          node.span.start
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nextStep = await (evaluator as any).invokeCallable(
        nextClosure,
        [],
        node.span.start,
        'next'
      );
      if (typeof nextStep !== 'object' || nextStep === null) {
        throw new RuntimeError(
          'RILL-R002',
          'Stream .next must return a stream step',
          node.span.start
        );
      }
      current = nextStep as RillStream;
    }
  } catch (e) {
    if (e instanceof BreakSignal) {
      // Dispose stream resources before re-throwing (IR-14)
      const disposeFn = (
        stream as unknown as Record<string, (() => void) | undefined>
      )['__rill_stream_dispose'];
      if (typeof disposeFn === 'function') {
        try {
          disposeFn();
        } catch (disposeErr) {
          // Propagate dispose errors as RILL-R002 (EC-15)
          if (disposeErr instanceof RuntimeError) throw disposeErr;
          throw new RuntimeError(
            'RILL-R002',
            disposeErr instanceof Error
              ? disposeErr.message
              : String(disposeErr),
            node.span.start
          );
        }
      }
      throw e;
    }
    throw e;
  }

  if (count >= limit) {
    throw new RuntimeError(
      'RILL-R010',
      `Stream expansion exceeded ${limit} iterations`,
      node.span.start,
      { limit, iterations: count }
    );
  }

  return elements;
}

/**
 * CollectionsMixin implementation.
 *
 * Exposes protected wrapper methods for the exported iterable helpers.
 * The evaluate* operator methods are removed (IC-3/IC-4).
 *
 * Methods added:
 * - getIterableElements(input, node) -> Promise<RillValue[]>
 * - expandIterator(iterator, node, limit?) -> Promise<RillValue[]>
 * - expandStream(stream, node, limit?) -> Promise<RillValue[]>
 */
function createCollectionsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class CollectionsEvaluator extends Base {
    /**
     * Get elements from an iterable value (list, string, dict, iterator, or stream).
     * Delegates to the exported `getIterableElements` helper (IC-3).
     */
    protected async getIterableElements(
      input: RillValue,
      node: { span: { start: SourceLocation } }
    ): Promise<RillValue[]> {
      return getIterableElements(input, this.ctx, node);
    }

    /**
     * Expand an iterator to a list of values.
     * Delegates to the exported `expandIterator` helper (IC-3).
     */
    protected async expandIterator(
      iterator: RillValue,
      node: { span: { start: SourceLocation } },
      limit: number = DEFAULT_MAX_ITERATIONS
    ): Promise<RillValue[]> {
      return expandIterator(iterator, this.ctx, node, limit);
    }

    /**
     * Expand a stream to a list of chunk values.
     * Delegates to the exported `expandStream` helper (IC-3).
     */
    protected async expandStream(
      stream: RillStream,
      node: { span: { start: SourceLocation } },
      limit: number = DEFAULT_MAX_ITERATIONS
    ): Promise<RillValue[]> {
      return expandStream(stream, this.ctx, node, limit);
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CollectionsMixin = createCollectionsMixin as any;
