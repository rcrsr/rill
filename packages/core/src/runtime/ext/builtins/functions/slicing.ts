import type { RillFunction } from '../../../core/callable.js';
import { callable, isCallable } from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import { throwCatchableHostHalt } from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import { inferType } from '../../../core/types/registrations.js';
import {
  isDuration,
  isIterator,
  isStream,
} from '../../../core/types/guards.js';
import { anyTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { ControlSignal } from '../../../core/signals.js';
import { createChildContext } from '../../../core/context.js';
import { getIterableElements } from '../../../core/eval/handlers/collections.js';
import { getEvalState } from '../../../core/eval/state.js';
import {
  MAX_ITER,
  chunkSlice,
  makeListIterator,
  walkIteratorSteps,
} from '../shared.js';

/** Slicing built-in functions: take, skip, cycle, batch, window, start_when, stop_when. */
export const SLICING_FUNCTIONS: Record<string, RillFunction> = {
  /**
   * Slice at most n elements from the front of a list, iterator, or stream.
   * Negative n halts with #INVALID_INPUT (EC-1).
   * n > MAX_ITER is clamped to MAX_ITER without halting (EC-7).
   * Iterator/stream inputs are walked lazily to avoid RILL_R010 on infinite
   * sequences (e.g. cycle). clamped===0 returns [] without touching the input.
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
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'take',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `take: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw as number;
      if (n < 0) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `take: n must be >= 0, got ${n}`
        );
      }
      const clamped = Math.min(n, MAX_ITER);

      // List input: pure array slice, return list
      if (Array.isArray(input)) {
        return input.slice(0, clamped);
      }

      // n===0: return empty immediately without touching the input.
      // This avoids RILL_R010 on streams with clamped===0.
      if (clamped === 0) {
        return [];
      }

      // Iterator/stream input: walk lazily up to `clamped` steps.
      // This handles infinite iterators (e.g. cycle) correctly.
      if (isStream(input) || isIterator(input)) {
        const loc = location ?? { line: 0, column: 0, offset: 0 };
        const evaluator = getEvalState(ctx as RuntimeContext);
        const { elements } = await walkIteratorSteps(
          input as unknown as Record<string, unknown>,
          clamped,
          evaluator,
          loc,
          (ctx as RuntimeContext).sourceId
        );
        return elements;
      }

      // All other iterables (dict, string): materialize then slice.
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );
      return elements.slice(0, clamped);
    },
  },

  /**
   * Skip the first n elements of a list, iterator, or stream, then yield the rest.
   * Negative n halts with #INVALID_INPUT (EC-1).
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
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'skip',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `skip: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw as number;
      if (n < 0) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `skip: n must be >= 0, got ${n}`
        );
      }

      // List input: pure array slice, return list
      if (Array.isArray(input)) {
        return input.slice(n);
      }

      // Iterator/stream input: walk n steps lazily, then materialize the tail.
      if (isStream(input) || isIterator(input)) {
        const loc = location ?? { line: 0, column: 0, offset: 0 };
        const node = { span: { start: loc } };
        const evaluator = getEvalState(ctx as RuntimeContext);

        if (n === 0) {
          // No skipping: materialize the whole sequence normally.
          return getIterableElements(input, ctx as RuntimeContext, node);
        }

        // Walk n steps to skip them, then materialize the remainder.
        const { tail } = await walkIteratorSteps(
          input as unknown as Record<string, unknown>,
          n,
          evaluator,
          loc,
          (ctx as RuntimeContext).sourceId
        );

        // If the iterator/stream is already done after skipping, return empty.
        if (tail['done']) {
          return [];
        }

        // Materialize the remainder using the tail iterator/stream state.
        return getIterableElements(
          tail as unknown as RillValue,
          ctx as RuntimeContext,
          node
        );
      }

      // All other iterables (dict, string): materialize then slice
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );
      return elements.slice(n);
    },
  },

  /**
   * Cycle through input elements repeatedly, producing a lazy iterator of T.
   * Empty input yields an empty iterator (no error, no infinite loop).
   * Yield count past MAX_ITER is enforced at the consumer boundary via
   * expandIterator / expandStream raising #RILL_R010 (EC-6).
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
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      // Empty input → empty iterator (EC-3 / IR-3 empty guard)
      if (elements.length === 0) {
        return makeListIterator([], 0);
      }

      // Build a cycling iterator: infinite linked list that wraps at elements.length
      const makeCycleIterator = (index: number): RillValue => {
        const pos = index % elements.length;
        return {
          value: elements[pos]!,
          done: false,
          next: callable(() => makeCycleIterator(index + 1)),
        };
      };

      return makeCycleIterator(0);
    },
  },

  /**
   * Split input into fixed-size chunks of n elements. Returns a list of lists.
   * Validates n > 0; halts with #INVALID_INPUT (EC-2) on n <= 0.
   * options dict may specify:
   *   { drop_partial: bool }    — discard trailing chunk shorter than n
   *                               (default false — keep partial tail).
   *   { idle_flush: duration }  — (IR-8) flush accumulated buffer early when
   *                               no chunk arrives within the given duration.
   *                               Must be a duration value (EC-18); non-duration
   *                               raises a catchable TYPE_MISMATCH halt.
   *                               Note: idle_flush is validated here but acts as
   *                               a scheduling hint. With synchronous iteration
   *                               via getIterableElements all elements are
   *                               collected before any setTimeout can fire, so
   *                               idle-triggered early-flush applies only to
   *                               future async streaming paths (Path A — static
   *                               clock limitation).
   * Chunk count is capped at MAX_ITER → #RILL_R010 (EC-6).
   * BreakSignal and ControlSignal are re-thrown per §NOD.10.4.
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
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'batch',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `batch: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw as number;
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
        const optDict = options as Record<string, RillValue>;

        const dp = optDict['drop_partial'];
        if (dp !== undefined && dp !== null) {
          dropPartial = dp === true;
        }

        // EC-18: idle_flush must be a duration when provided.
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
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      const chunks = chunkSlice(elements, n);

      // Drop the trailing partial chunk when requested
      const effectiveChunks =
        dropPartial && chunks.length > 0
          ? chunks[chunks.length - 1]!.length < n
            ? chunks.slice(0, -1)
            : chunks
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
   * halts with #INVALID_INPUT (EC-3) otherwise.
   * The last window may be shorter than n (partial tail emitted).
   * Window count is capped at MAX_ITER → #RILL_R010 (EC-6).
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
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'window',
      };

      if (typeof nRaw !== 'number' || !Number.isInteger(nRaw)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `window: n must be an integer, got ${inferType(nRaw)}`
        );
      }
      const n = nRaw as number;
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
        step = stepRaw as number;
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
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

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
   * Validates predicate is callable → #RILL_R040 (EC-4).
   * Predicate result must be bool → #TYPE_MISMATCH (EC-5).
   * Yield count is capped at MAX_ITER → #RILL_R010 (EC-6).
   * BreakSignal and ControlSignal are re-thrown per §NOD.10.4.
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
        sourceId: (ctx as RuntimeContext).sourceId,
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
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      const result: RillValue[] = [];
      let triggered = false;
      let yieldCount = 0;

      try {
        for (const element of elements) {
          if (!triggered) {
            const childCtx = createChildContext(ctx as RuntimeContext);
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
        if (e instanceof ControlSignal) throw e;
        throw e;
      }

      return result;
    },
  },

  /**
   * Pass through elements up to and including the first one where predicate
   * returns true. Elements after the first match are discarded.
   * Validates predicate is callable → #RILL_R040 (EC-4).
   * Predicate result must be bool → #TYPE_MISMATCH (EC-5).
   * Yield count is capped at MAX_ITER → #RILL_R010 (EC-6).
   * BreakSignal and ControlSignal are re-thrown per §NOD.10.4.
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
        sourceId: (ctx as RuntimeContext).sourceId,
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
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

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
          const childCtx = createChildContext(ctx as RuntimeContext);
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
        if (e instanceof ControlSignal) throw e;
        throw e;
      }

      return result;
    },
  },
};
