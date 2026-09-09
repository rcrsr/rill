/**
 * Iterable helpers
 *
 * Provides exported iterable helper functions:
 * - getIterableElements: expand any iterable to a flat list
 * - expandIterator: drive an iterator protocol to completion
 * - expandStream: drain an async stream to a list
 *
 * Module functions shared across the evaluator.
 * The evaluate* operator methods (each/map/fold/filter) are removed.
 *
 * @internal
 */

import type { SourceLocation } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import {
  isAtom,
  isDatetime,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isTypeValue,
  isVector,
} from '../../types/guards.js';
import type { RillStream } from '../../types/structures.js';
import type { RuntimeContext } from '../../types/runtime.js';
import { BreakSignal, ControlSignal } from '../../signals.js';
import { isCallable, isDict } from '../../callable.js';
import { orderedDictEntries } from '../../types/dict-keys.js';
import {
  RuntimeHaltSignal,
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
} from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import { getEvalState } from '../state.js';
import type { EvalState } from '../state.js';
import { checkAborted } from '../shared.js';
import { invokeCallable } from './closures.js';
import { accessHaltGate } from './access.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

/**
 * Default maximum iteration count for iterators.
 * Can be overridden with ^(limit: N) annotation.
 */
const DEFAULT_MAX_ITERATIONS = 10000;

// ============================================================
// EXPORTED ITERABLE HELPERS
// ============================================================

/**
 * Get elements from an iterable value (list, string, dict, iterator, or stream).
 *
 * Raises RILL-R003 for vector input.
 * Raises RILL-R002 for non-iterable input.
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
  // Vector guard [RILL-R003] — catchable: user supplied wrong type
  if (isVector(input)) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: ctx.sourceId,
        fn: 'getIterableElements',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'Collection operators require list, string, dict, iterator, or stream, got vector'
    );
  }
  // Datetime/Duration guard: these are plain objects but not iterable
  // catchable: user supplied wrong type
  if (isDatetime(input) || isDuration(input)) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: ctx.sourceId,
        fn: 'getIterableElements',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`
    );
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === 'string') {
    return [...input];
  }
  const evaluator: EvalState = getEvalState(ctx);
  // Check for stream BEFORE iterator (streams satisfy iterator shape)
  if (isStream(input)) {
    return expandStream(input, evaluator, node, limit);
  }
  // Check for iterator protocol BEFORE generic dict handling
  if (isIterator(input)) {
    return expandIterator(input, evaluator, node, limit);
  }
  // Ordered guard: ordered values are plain objects but not dict-iterable
  // catchable: user supplied wrong type
  if (isOrdered(input)) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: ctx.sourceId,
        fn: 'getIterableElements',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`
    );
  }
  // Atom/type-value guard: these are plain objects but not dict-iterable
  // catchable: user supplied wrong type
  if (isAtom(input) || isTypeValue(input)) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: ctx.sourceId,
        fn: 'getIterableElements',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`
    );
  }
  if (isDict(input)) {
    // Dict iteration: canonical key order (sorted string keys, then number
    // keys ascending, then boolean keys), each element is { key, value }.
    return orderedDictEntries(input).map((e) => ({
      key: e.key,
      value: e.value,
    }));
  }
  // Non-iterable [RILL-R002] — catchable: user supplied wrong type
  throwCatchableHostHalt(
    {
      location: node.span.start,
      sourceId: ctx.sourceId,
      fn: 'getIterableElements',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`
  );
}

/**
 * Expand an iterator to a list of values.
 * Respects iteration limits to prevent infinite loops.
 *
 * @param iterator - The iterator value ({ done, value, next })
 * @param evaluator - EvalState used for abort checks and callable invocation
 * @param node - AST node providing span for error locations
 * @param limit - Maximum iteration count (default: DEFAULT_MAX_ITERATIONS)
 */
async function expandIterator(
  iterator: RillValue,
  evaluator: EvalState,
  node: { span: { start: SourceLocation } },
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<RillValue[]> {
  const elements: RillValue[] = [];
  let current = iterator as Record<string, RillValue>;
  let count = 0;

  while (!current['done'] && count < limit) {
    checkAborted(evaluator);
    const val = current['value'];
    if (val !== undefined) {
      elements.push(val);
    }
    count++;

    // Invoke next() to get the next iterator
    const nextClosure = current['next'];
    if (nextClosure === undefined || !isCallable(nextClosure)) {
      // fatal: iterator invariant violation, not user-recoverable
      throwFatalHostHalt(
        {
          location: node.span.start,
          sourceId: evaluator.ctx.sourceId,
          fn: 'expandIterator',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Iterator .next must be a closure'
      );
    }
    const nextIterator = await invokeCallable(
      evaluator,
      nextClosure,
      [],
      node.span.start,
      'next'
    );
    if (typeof nextIterator !== 'object' || nextIterator === null) {
      // fatal: iterator invariant violation, not user-recoverable
      throwFatalHostHalt(
        {
          location: node.span.start,
          sourceId: evaluator.ctx.sourceId,
          fn: 'expandIterator',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Iterator .next must return iterator'
      );
    }
    current = nextIterator as Record<string, RillValue>;
  }

  // The loop halts either because the iterator is exhausted (done) or because
  // count reached the limit. Only the latter — more elements remaining past the
  // ceiling — is an overrun. Exactly `limit` elements that fully consume the
  // iterator is within bounds; the (limit+1)th element triggers the halt.
  if (count >= limit && !current['done']) {
    // fatal: resource limit exceeded
    throwFatalHostHalt(
      {
        location: node.span.start,
        sourceId: evaluator.ctx.sourceId,
        fn: 'expandIterator',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R010],
      `Iterator expansion exceeded ${limit} iterations`,
      { limit, iterations: count }
    );
  }

  return elements;
}

/**
 * Validate a single stream chunk value before it is accepted into the
 * expanded element list.
 *
 * Halts as a catchable `INVALID_INPUT` for:
 * - non-finite numbers (NaN, Infinity, -Infinity)
 * - `null`
 * - callable/function values
 * - `undefined` (previously dropped silently, which under-counted the
 *   expanded stream by one element per occurrence)
 *
 * @param value - The chunk value to validate
 * @param index - 0-based chunk index, used in the halt message
 * @param site - Halt site describing the calling stream operator
 */
export function validateStreamChunk(
  value: RillValue | undefined,
  index: number,
  site: TypeHaltSite
): void {
  let reason: string | undefined;

  if (value === undefined) {
    reason = 'chunk value is undefined';
  } else if (value === null) {
    reason = 'chunk value is null';
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    reason = `chunk value is a non-finite number (${value})`;
  } else if (isCallable(value)) {
    reason = 'chunk value is a callable/function';
  }

  if (reason !== undefined) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `Invalid stream chunk at index ${index}: ${reason}`
    );
  }
}

/**
 * Result of a lazy stream/iterator walk: the per-element results produced
 * by `onElement`, and whether the walk stopped because the body raised
 * `break` (`broke: true`) versus draining the source to completion.
 */
export interface LazyWalkResult {
  results: RillValue[];
  broke: boolean;
}

/**
 * Drive a stream or iterator one raw step at a time, invoking `onElement`
 * for each produced value instead of materializing the whole sequence up
 * front via `getIterableElements`. Used by `seq`/`acc` so a `break` in the
 * body bounds how many steps are pulled from an infinite stream/iterator.
 *
 * Preserves, per input kind, the same guarantees the eager
 * expandStream/expandIterator paths gave:
 * - stream input: per-chunk `validateStreamChunk` and cross-chunk type
 *   consistency (`#TYPE_MISMATCH`), matching expandStream.
 * - iterator input: no chunk validation or type-consistency check,
 *   matching expandIterator (which does neither).
 * - both: `checkAborted` per step and a raw-step `limit` ceiling that halts
 *   fatally with `#RILL_R010` when exceeded (ADR-0054), matching
 *   expandStream/expandIterator's fatal classification.
 *
 * On `BreakSignal` from `onElement`, disposes the stream (a no-op for
 * iterators, which carry no dispose hook) and returns the partial results
 * collected so far (`broke: true`). On any other throw — a body halt or a
 * stream/iterator protocol error — disposes and re-throws.
 *
 * @param input - The stream or iterator value being walked
 * @param ctx - Runtime context (used for abort checks and callable invocation)
 * @param node - AST node providing span for error locations
 * @param fnName - Calling builtin's name, used in halt-site diagnostics
 * @param onElement - Invoked with each produced value and its 0-based index
 * @param limit - Maximum raw-step count (default: DEFAULT_MAX_ITERATIONS)
 */
export async function walkStreamOrIteratorElements(
  input: RillValue,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } },
  fnName: string,
  onElement: (element: RillValue, index: number) => Promise<RillValue>,
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<LazyWalkResult> {
  const evaluator: EvalState = getEvalState(ctx);
  const streamInput = isStream(input);
  const results: RillValue[] = [];
  let current: Record<string, RillValue> = input as Record<string, RillValue>;
  let count = 0;
  let expectedType: string | undefined;

  const site = {
    location: node.span.start,
    sourceId: evaluator.ctx.sourceId,
    fn: fnName,
  };

  const dispose = (): void => {
    if (!streamInput) return;
    const disposeFn = (
      input as unknown as Record<string, (() => void) | undefined>
    )['__rill_stream_dispose'];
    if (typeof disposeFn !== 'function') return;
    try {
      disposeFn();
    } catch (disposeErr) {
      // fatal: dispose failures are not user-recoverable
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        disposeErr instanceof Error ? disposeErr.message : String(disposeErr)
      );
    }
  };

  try {
    while (!current['done'] && count < limit) {
      checkAborted(evaluator);
      // The pending head has no `value` key; every non-done step
      // (including the initial produced chunk) carries one.
      if ('value' in current) {
        const val = current['value'];
        const index = results.length;
        if (streamInput) {
          validateStreamChunk(val, index, site);
          const actualType = inferType(val as RillValue);
          if (expectedType === undefined) {
            expectedType = actualType;
          } else if (actualType !== expectedType) {
            throwTypeHalt(
              site,
              'TYPE_MISMATCH',
              `Stream chunk type mismatch: expected ${expectedType}, got ${actualType} at index ${index}`,
              'runtime',
              { expectedType, actualType }
            );
          }
        }
        const result = await onElement(val as RillValue, index);
        results.push(result);
      }
      count++;

      // Invoke next() to advance the stream/iterator
      const nextClosure = current['next'];
      if (nextClosure === undefined || !isCallable(nextClosure)) {
        // fatal: stream/iterator invariant violation, not user-recoverable
        throwFatalHostHalt(
          site,
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `${streamInput ? 'Stream' : 'Iterator'} .next must be a closure`
        );
      }
      const nextStep = await invokeCallable(
        evaluator,
        nextClosure,
        [],
        node.span.start,
        'next'
      );
      // A mid-stream host throw inside `.next` (e.g. the underlying
      // AsyncIterable's `next()` rejecting) reshapes to an invalid
      // `RillValue` at the extension dispatch boundary rather than
      // throwing directly (see `reshapeHostThrow` in closures.ts). Route
      // it through the same access-halt gate every other invalid-value
      // access uses so it surfaces as a catchable halt carrying the
      // original message/trace instead of being cast into a malformed
      // stream step and misreported as a `.next` protocol violation.
      accessHaltGate(nextStep as RillValue, site);
      if (typeof nextStep !== 'object' || nextStep === null) {
        // fatal: stream/iterator invariant violation, not user-recoverable
        throwFatalHostHalt(
          site,
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `${streamInput ? 'Stream' : 'Iterator'} .next must return ${
            streamInput ? 'a stream step' : 'an iterator'
          }`
        );
      }
      current = nextStep as Record<string, RillValue>;
    }
  } catch (e) {
    dispose();
    if (e instanceof BreakSignal) {
      return { results, broke: true };
    }
    throw e;
  }

  // Exactly `limit` raw steps that fully drain the source (done) is within
  // bounds; only a source still producing past the ceiling is an overrun.
  if (count >= limit && !current['done']) {
    // fatal: resource limit exceeded
    throwFatalHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R010],
      `${streamInput ? 'Stream' : 'Iterator'} expansion exceeded ${limit} iterations`,
      { limit, iterations: count }
    );
  }

  return { results, broke: false };
}

/**
 * Expand a stream to a list of chunk values.
 * Consumes async chunks by repeatedly calling the stream's next callable.
 * Respects iteration limits to prevent unbounded expansion.
 *
 * On any halt or control signal raised while draining the stream, calls the
 * stream's dispose callable (if present, and idempotent) before re-throwing.
 *
 * @param stream - The stream value ({ __rill_stream, done, value, next })
 * @param evaluator - EvalState used for abort checks, callable invocation, and sourceId
 * @param node - AST node providing span for error locations
 * @param limit - Maximum iteration count (default: DEFAULT_MAX_ITERATIONS)
 */
async function expandStream(
  stream: RillStream,
  evaluator: EvalState,
  node: { span: { start: SourceLocation } },
  limit: number = DEFAULT_MAX_ITERATIONS
): Promise<RillValue[]> {
  const elements: RillValue[] = [];
  let current: RillStream = stream;
  let count = 0;
  let expectedType: string | undefined;

  try {
    while (!current.done && count < limit) {
      checkAborted(evaluator);
      // The pending head has no `value` key; every non-done chunk step
      // (including the initial produced chunk) carries one.
      if ('value' in current) {
        const val = current['value'];
        // 0-based chunk index: how many chunks have been accepted so far,
        // not the raw step count (which also counts the value-less
        // pending head step).
        const chunkIndex = elements.length;
        validateStreamChunk(val, chunkIndex, {
          location: node.span.start,
          sourceId: evaluator.ctx.sourceId,
          fn: 'expandStream',
        });
        const actualType = inferType(val as RillValue);
        if (expectedType === undefined) {
          expectedType = actualType;
        } else if (actualType !== expectedType) {
          throwTypeHalt(
            {
              location: node.span.start,
              sourceId: evaluator.ctx.sourceId,
              fn: 'stream-chunk',
            },
            'TYPE_MISMATCH',
            `Stream chunk type mismatch: expected ${expectedType}, got ${actualType} at index ${chunkIndex}`,
            'runtime',
            { expectedType, actualType }
          );
        }
        elements.push(val as RillValue);
      }
      count++;

      // Invoke next() to advance the stream
      const nextClosure = current['next'];
      if (nextClosure === undefined || !isCallable(nextClosure)) {
        // fatal: stream invariant violation, not user-recoverable
        throwFatalHostHalt(
          {
            location: node.span.start,
            sourceId: evaluator.ctx.sourceId,
            fn: 'expandStream',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Stream .next must be a closure'
        );
      }
      const nextStep = await invokeCallable(
        evaluator,
        nextClosure,
        [],
        node.span.start,
        'next'
      );
      // A mid-stream host throw inside `.next` (e.g. the underlying
      // AsyncIterable's `next()` rejecting) reshapes to an invalid
      // `RillValue` at the extension dispatch boundary rather than
      // throwing directly (see `reshapeHostThrow` in closures.ts). Route
      // it through the same access-halt gate every other invalid-value
      // access uses so it surfaces as a catchable halt carrying the
      // original message/trace instead of being cast into a malformed
      // stream step and misreported as a `.next` protocol violation.
      accessHaltGate(nextStep as RillValue, {
        location: node.span.start,
        sourceId: evaluator.ctx.sourceId,
        fn: 'expandStream',
      });
      if (typeof nextStep !== 'object' || nextStep === null) {
        // fatal: stream invariant violation, not user-recoverable
        throwFatalHostHalt(
          {
            location: node.span.start,
            sourceId: evaluator.ctx.sourceId,
            fn: 'expandStream',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Stream .next must return a stream step'
        );
      }
      current = nextStep as RillStream;
    }
  } catch (e) {
    if (e instanceof RuntimeHaltSignal || e instanceof ControlSignal) {
      // Dispose stream resources (idempotent) before re-throwing.
      const disposeFn = (
        stream as unknown as Record<string, (() => void) | undefined>
      )['__rill_stream_dispose'];
      if (typeof disposeFn === 'function') {
        try {
          disposeFn();
        } catch (disposeErr) {
          // fatal: dispose failures are not user-recoverable
          throwFatalHostHalt(
            {
              location: node.span.start,
              sourceId: evaluator.ctx.sourceId,
              fn: 'expandStream',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            disposeErr instanceof Error
              ? disposeErr.message
              : String(disposeErr)
          );
        }
      }
      throw e;
    }
    throw e;
  }

  // Exactly `limit` elements that fully drain the stream (done) is within
  // bounds; only a stream still producing past the ceiling is an overrun.
  if (count >= limit && !current.done) {
    // fatal: resource limit exceeded
    throwFatalHostHalt(
      {
        location: node.span.start,
        sourceId: evaluator.ctx.sourceId,
        fn: 'expandStream',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R010],
      `Stream expansion exceeded ${limit} iterations`,
      { limit, iterations: count }
    );
  }

  return elements;
}
