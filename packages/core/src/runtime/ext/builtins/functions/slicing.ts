import type { RillFunction } from '../../../core/callable.js';
import { callable, isCallable } from '../../../core/callable.js';
import {
  rejectBreakAsHalt,
  throwCatchableHostHalt,
  type TypeHaltSite,
} from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import { invokeStreamDispose } from '../../../core/types/constructors.js';
import { inferType } from '../../../core/types/registrations.js';
import {
  isDict,
  isDuration,
  isIterator,
  isStream,
} from '../../../core/types/guards.js';
import { anyTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { createChildContext } from '../../../core/context.js';
import { getIterableElements } from '../../../core/eval/handlers/collections.js';
import { getEvalState } from '../../../core/eval/state.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../../../error-registry.js';
import {
  MAX_ITER,
  chunkSlice,
  makeListIterator,
  requireNonNegativeInteger,
  walkIteratorSteps,
} from '../shared.js';

/**
 * Release a host stream's resources via its idempotent dispose hook, if
 * present. No-op for plain iterators (isStream returns false for those).
 * Called from both the success and failure paths of take/skip's lazy walk so
 * a walkIteratorSteps failure (invariant violation, chunk type mismatch)
 * still disposes the stream before the halt propagates.
 */
function disposeStreamInput(input: RillValue, site: TypeHaltSite): void {
  if (!isStream(input)) return;
  invokeStreamDispose(input, site);
}

/** Slicing built-in functions: take, skip, cycle, batch, window, start_when, stop_when. */
export const SLICING_FUNCTIONS: Record<string, RillFunction> = {
  /**
   * Slice at most n elements from the front of a list, iterator, or stream.
   * Negative or non-integer n halts with #INVALID_INPUT.
   * Iterator/stream inputs are walked lazily with cap n; a walk past the step
   * limit halts with a catchable #RILL_R010. List and materialized inputs halt
   * with a catchable #RILL_R010 when min(n, length) exceeds MAX_ITER.
   * n === 0 validates the input type like any other n, disposes a stream
   * input without pulling from it, and returns [].
   */
  take: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'n',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const nRaw = args['n'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'take',
      };

      if (typeof nRaw !== 'number') {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `take: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = requireNonNegativeInteger(nRaw, 'take', 'n', site);

      const assertWithinLimit = (length: number): void => {
        if (Math.min(n, length) > MAX_ITER) {
          throwCatchableHostHalt(
            site,
            ERROR_ATOMS[ERROR_IDS.RILL_R010],
            `take: element count exceeded ${MAX_ITER} limit`
          );
        }
      };

      // List input: pure array slice, return list
      if (Array.isArray(input)) {
        assertWithinLimit(input.length);
        return input.slice(0, n);
      }

      // Iterator/stream input: walk lazily up to `n` steps.
      // This handles infinite iterators (e.g. cycle) correctly.
      if (isStream(input) || isIterator(input)) {
        const loc = location ?? { line: 0, column: 0, offset: 0 };
        const evaluator = getEvalState(ctx);

        if (n === 0) {
          disposeStreamInput(input, site);
          return [];
        }

        // Host streams (not plain iterators) may hold resources released via
        // an idempotent dispose hook. take() only ever consumes a prefix, so
        // dispose here whether that prefix stopped the stream early or fully
        // drained it, or the walk itself halted; the idempotency guard on
        // the hook itself (see createRillStream) keeps a later ctx.dispose()
        // from double-firing.
        try {
          const { elements } = await walkIteratorSteps(
            input,
            n,
            evaluator,
            loc,
            ctx.sourceId,
            true
          );
          return elements;
        } finally {
          disposeStreamInput(input, site);
        }
      }

      // All other iterables (dict, string): materialize then slice.
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);
      assertWithinLimit(elements.length);
      return elements.slice(0, n);
    },
  },

  /**
   * Skip the first n elements of a list, iterator, or stream, then yield the rest.
   * Negative n halts with #INVALID_INPUT.
   * n exceeding input length returns empty result (no error).
   * Iterator/stream inputs are walked lazily for the skip phase to avoid
   * RILL_R010 on large or infinite sequences.
   */
  skip: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'n',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const nRaw = args['n'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'skip',
      };

      if (typeof nRaw !== 'number') {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `skip: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = requireNonNegativeInteger(nRaw, 'skip', 'n', site);

      // List input: pure array slice, return list
      if (Array.isArray(input)) {
        return input.slice(n);
      }

      // Iterator/stream input: walk n steps lazily, then materialize the tail.
      if (isStream(input) || isIterator(input)) {
        const loc = location ?? { line: 0, column: 0, offset: 0 };
        const node = { span: { start: loc } };
        const evaluator = getEvalState(ctx);

        if (n === 0) {
          // No skipping: materialize the whole sequence normally.
          return getIterableElements(input, ctx, node);
        }

        // Walk n steps to skip them, then materialize the remainder. A
        // successful walk leaves the stream open for the getIterableElements
        // calls below to consume; only a failed walk (invariant violation,
        // chunk type mismatch) needs to dispose here, since no further
        // consumption of `input` will happen on that path.
        let tail: RillValue;
        try {
          ({ tail } = await walkIteratorSteps(
            input,
            n,
            evaluator,
            loc,
            ctx.sourceId
          ));
        } catch (e) {
          disposeStreamInput(input, site);
          throw e;
        }

        // If the iterator/stream is already done after skipping, return empty.
        if (isDict(tail) && tail['done'] === true) {
          return [];
        }

        // Materialize the remainder using the tail iterator/stream state.
        return getIterableElements(tail, ctx, node);
      }

      // All other iterables (dict, string): materialize then slice
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);
      return elements.slice(n);
    },
  },

  /**
   * Cycle through input elements repeatedly, producing a lazy iterator of T.
   * Empty input yields an empty iterator (no error, no infinite loop).
   * Yield count past MAX_ITER is enforced at the consumer boundary via
   * expandIterator / expandStream raising #RILL_R010.
   */
  cycle: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);

      // Empty input → empty iterator (empty guard)
      if (elements.length === 0) {
        return makeListIterator([], 0);
      }

      // Build a cycling iterator: infinite linked list that wraps at elements.length
      const makeCycleIterator = (index: number): RillValue => {
        const value = elements[index % elements.length] ?? null;
        return {
          value,
          done: false,
          next: callable(() => makeCycleIterator(index + 1)),
        };
      };

      return makeCycleIterator(0);
    },
  },

  /**
   * Split input into fixed-size chunks of n elements. Returns a list of lists.
   * Validates n > 0; halts with #INVALID_INPUT on n <= 0.
   * options dict may specify:
   *   { drop_partial: bool }    — discard trailing chunk shorter than n
   *                               (default false — keep partial tail).
   *   { idle_flush: duration }  — flush accumulated buffer early when
   *                               no chunk arrives within the given duration.
   *                               Must be a duration value; non-duration
   *                               raises a catchable TYPE_MISMATCH halt.
   *                               Note: idle_flush is validated here but acts as
   *                               a scheduling hint. With synchronous iteration
   *                               via getIterableElements all elements are
   *                               collected before any setTimeout can fire, so
   *                               idle-triggered early-flush applies only to
   *                               future async streaming paths (Path A — static
   *                               clock limitation).
   * Chunk count is capped at MAX_ITER → #RILL_R010.
   * BreakSignal and ControlSignal are re-thrown.
   */
  batch: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'n',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'options',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const nRaw = args['n'] ?? null;
      const options = args['options'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'batch',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `batch: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw;
      if (n <= 0) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `batch: n must be > 0, got ${n}`
        );
      }

      // Read options: drop_partial (default false) and idle_flush (duration, optional).
      let dropPartial = false;
      if (options !== null && options !== undefined) {
        if (!isDict(options)) {
          throwCatchableHostHalt(
            site,
            'TYPE_MISMATCH',
            `batch: options must be a dict, got ${inferType(options)}`
          );
        }
        const optDict = options as Record<string, RillValue>;

        const dp = optDict['drop_partial'];
        if (dp !== undefined && dp !== null) {
          if (typeof dp !== 'boolean') {
            throwCatchableHostHalt(
              site,
              'TYPE_MISMATCH',
              `batch: drop_partial must be a boolean, got ${inferType(dp)}`
            );
          }
          dropPartial = dp;
        }

        // idle_flush must be a duration when provided.
        const idleFlushRaw = optDict['idle_flush'];
        if (idleFlushRaw !== undefined && idleFlushRaw !== null) {
          if (!isDuration(idleFlushRaw)) {
            throwCatchableHostHalt(
              site,
              'TYPE_MISMATCH',
              `batch: idle_flush must be a duration, got ${inferType(idleFlushRaw)}`
            );
          }
          // idle_flush is validated. With synchronous getIterableElements
          // iteration the idle timer cannot fire mid-collection, so the
          // option has no effect on the current synchronous path.
          // Future async streaming support will wire this to createIdleTicker.
        }

        for (const key of Object.keys(optDict)) {
          if (key !== 'drop_partial' && key !== 'idle_flush') {
            throwCatchableHostHalt(
              site,
              'INVALID_INPUT',
              `batch: unknown option '${key}'; recognized options are 'drop_partial' and 'idle_flush'`
            );
          }
        }
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);

      const chunks = chunkSlice(elements, n);

      // Drop the trailing partial chunk when requested
      const lastChunk = chunks.at(-1);
      const effectiveChunks =
        dropPartial && lastChunk !== undefined && lastChunk.length < n
          ? chunks.slice(0, -1)
          : chunks;

      // Cap chunk count at MAX_ITER
      const result: RillValue[] = [];
      for (const chunk of effectiveChunks) {
        if (result.length >= MAX_ITER) {
          throwCatchableHostHalt(
            site,
            'RILL_R010',
            `batch: chunk count exceeded ${MAX_ITER} limit`
          );
        }
        result.push(chunk);
      }

      return result;
    },
  },

  /**
   * Emit sliding windows of n elements advancing by step elements each time.
   * Default step = n (non-overlapping). Validates n > 0 and step > 0;
   * halts with #INVALID_INPUT otherwise.
   * The last window may be shorter than n (partial tail emitted).
   * Window count is capped at MAX_ITER → #RILL_R010.
   */
  window: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'n',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'step',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const nRaw = args['n'] ?? null;
      const stepRaw = args['step'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'window',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `window: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw;
      if (n <= 0) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `window: n must be > 0, got ${n}`
        );
      }

      // Resolve step: default to n when not provided
      let step: number;
      if (stepRaw === null || stepRaw === undefined) {
        step = n;
      } else {
        if (typeof stepRaw !== 'number' || !Number.isInteger(stepRaw)) {
          throwCatchableHostHalt(
            site,
            'INVALID_INPUT',
            `window: step must be an integer, got ${inferType(stepRaw)}`
          );
        }
        step = stepRaw;
        if (step <= 0) {
          throwCatchableHostHalt(
            site,
            'INVALID_INPUT',
            `window: step must be > 0, got ${step}`
          );
        }
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);

      const windows: RillValue[] = [];
      let start = 0;

      while (start < elements.length) {
        if (windows.length >= MAX_ITER) {
          throwCatchableHostHalt(
            site,
            'RILL_R010',
            `window: window count exceeded ${MAX_ITER} limit`
          );
        }
        windows.push(elements.slice(start, start + n));
        start += step;
      }

      return windows;
    },
  },

  /**
   * Pass through all elements starting from the first one where predicate
   * returns true (inclusive). Elements before the first match are discarded.
   * Once triggered, predicate is never re-evaluated.
   * Validates predicate is callable → #RILL_R040.
   * Predicate result must be bool → #TYPE_MISMATCH.
   * Yield count is capped at MAX_ITER → #RILL_R010.
   * BreakSignal and ControlSignal are re-thrown.
   */
  start_when: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'predicate',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const predicate = args['predicate'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'start_when',
      };

      if (!isCallable(predicate)) {
        throwCatchableHostHalt(
          site,
          'RILL_R040',
          `start_when: predicate must be a closure, got ${inferType(predicate)}`
        );
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);

      const result: RillValue[] = [];
      let triggered = false;
      let yieldCount = 0;

      try {
        for (const element of elements) {
          if (!triggered) {
            const childCtx = createChildContext(ctx);
            childCtx.pipeValue = element;
            const testResult = await invokeCallable(
              predicate,
              [element],
              childCtx,
              location
            );
            if (typeof testResult !== 'boolean') {
              throwCatchableHostHalt(
                site,
                'TYPE_MISMATCH',
                `start_when: predicate must return bool, got ${inferType(testResult)}`
              );
            }
            if (!testResult) continue;
            triggered = true;
          }
          yieldCount++;
          if (yieldCount > MAX_ITER) {
            throwCatchableHostHalt(
              site,
              'RILL_R010',
              `start_when: yield count exceeded ${MAX_ITER} limit`
            );
          }
          result.push(element);
        }
      } catch (e) {
        rejectBreakAsHalt(e, site);
        throw e;
      }

      return result;
    },
  },

  /**
   * Pass through elements up to and including the first one where predicate
   * returns true. Elements after the first match are discarded.
   * Validates predicate is callable → #RILL_R040.
   * Predicate result must be bool → #TYPE_MISMATCH.
   * Yield count is capped at MAX_ITER → #RILL_R010.
   * BreakSignal and ControlSignal are re-thrown.
   */
  stop_when: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'predicate',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const predicate = args['predicate'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'stop_when',
      };

      if (!isCallable(predicate)) {
        throwCatchableHostHalt(
          site,
          'RILL_R040',
          `stop_when: predicate must be a closure, got ${inferType(predicate)}`
        );
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(input, ctx, node);

      const result: RillValue[] = [];

      try {
        for (const element of elements) {
          if (result.length >= MAX_ITER) {
            throwCatchableHostHalt(
              site,
              'RILL_R010',
              `stop_when: yield count exceeded ${MAX_ITER} limit`
            );
          }
          const childCtx = createChildContext(ctx);
          childCtx.pipeValue = element;
          const testResult = await invokeCallable(
            predicate,
            [element],
            childCtx,
            location
          );
          if (typeof testResult !== 'boolean') {
            throwCatchableHostHalt(
              site,
              'TYPE_MISMATCH',
              `stop_when: predicate must return bool, got ${inferType(testResult)}`
            );
          }
          result.push(element);
          if (testResult) break;
        }
      } catch (e) {
        rejectBreakAsHalt(e, site);
        throw e;
      }

      return result;
    },
  },
};
