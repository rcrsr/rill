import type { RillFunction } from '../../../core/callable.js';
import {
  isCallable,
  isDict,
  isScriptCallable,
} from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import { RuntimeError } from '../../../../types.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import { inferType } from '../../../core/types/registrations.js';
import { createOrdered } from '../../../core/types/constructors.js';
import { resolvedCompareValue } from '../../../core/types/protocols/shared.js';
import { anyTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { BreakSignal } from '../../../core/signals.js';
import { createChildContext } from '../../../core/context.js';
import { getIterableElements } from '../../../core/eval/handlers/collections.js';
import { ERROR_IDS } from '../../../../error-registry.js';
import { MAX_ITER, chunkSlice, DICT_DEFAULT_KEY_FN } from '../shared.js';

/** Collection built-in functions: seq, fan, acc, fold, filter, sort. */
export const COLLECTION_FUNCTIONS: Record<string, RillFunction> = {
  /**
   * Sequential iteration: invoke body closure for each element, return all results.
   * Catches BreakSignal and returns partial results.
   * $ is bound to the current element per iteration.
   * @ is NOT bound (RILL-R040 EC-3: undefined variable error if body references $@).
   */
  seq: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'body',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const body = args['body'] ?? null;

      if (!isCallable(body)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R040,
          `seq: body must be a closure, got ${inferType(body)}`,
          location
        );
      }

      // Fake node for getIterableElements location reporting
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      const results: RillValue[] = [];
      let iterCount = 0;

      try {
        for (const element of elements) {
          iterCount++;
          if (iterCount > MAX_ITER) {
            throw new RuntimeError(
              ERROR_IDS.RILL_R010,
              `seq: iteration exceeded ${MAX_ITER} iterations`,
              location,
              { limit: MAX_ITER, iterations: iterCount }
            );
          }

          const childCtx = createChildContext(ctx as RuntimeContext);
          childCtx.pipeValue = element;
          const closureToInvoke = isScriptCallable(body)
            ? { ...body, definingScope: childCtx }
            : body;
          const result = await invokeCallable(
            closureToInvoke,
            [element],
            childCtx,
            location
          );
          results.push(result);
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          return results;
        }
        throw e;
      }

      return results;
    },
  },

  /**
   * Parallel iteration: invoke body closure for each element concurrently, return all results.
   * Does NOT catch BreakSignal.
   * $ is bound to the current element per iteration via per-element child context.
   * options dict may specify { concurrency: number } for batched execution.
   */
  fan: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'body',
        type: { kind: 'any' },
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
      const body = args['body'] ?? null;
      const options = args['options'] ?? null;

      if (!isCallable(body)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R040,
          `fan: body must be a closure, got ${inferType(body)}`,
          location
        );
      }

      // Validate options if provided
      let concurrency: number | undefined;
      if (options !== null && options !== undefined) {
        if (!isDict(options)) {
          throw new RuntimeError(
            ERROR_IDS.RILL_R001,
            `fan: options must be a dict, got ${inferType(options)}`,
            location
          );
        }
        const concurrencyOpt = (options as Record<string, RillValue>)[
          'concurrency'
        ];
        if (concurrencyOpt !== undefined && concurrencyOpt !== null) {
          if (typeof concurrencyOpt !== 'number') {
            throw new RuntimeError(
              ERROR_IDS.RILL_R001,
              `fan: options.concurrency must be a number, got ${inferType(concurrencyOpt)}`,
              location
            );
          }
          if (!Number.isFinite(concurrencyOpt) || concurrencyOpt <= 0) {
            throw new RuntimeError(
              ERROR_IDS.RILL_R001,
              `fan: options.concurrency must be a positive number, got ${concurrencyOpt}`,
              location
            );
          }
          concurrency = Math.floor(concurrencyOpt);
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

      if (elements.length === 0) {
        return [];
      }

      if (concurrency === undefined) {
        // Unbounded parallel: Promise.all over all elements
        const promises = elements.map((element) => {
          const childCtx = createChildContext(ctx as RuntimeContext);
          childCtx.pipeValue = element;
          return invokeCallable(body, [element], childCtx, location);
        });
        return Promise.all(promises);
      }

      // Batched parallel execution
      const results: RillValue[] = [];
      for (const batch of chunkSlice(elements, concurrency)) {
        const batchPromises = batch.map((element) => {
          const childCtx = createChildContext(ctx as RuntimeContext);
          childCtx.pipeValue = element;
          return invokeCallable(body, [element], childCtx, location);
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      return results;
    },
  },

  /**
   * Sequential scan with accumulator: invoke body closure per element, accumulate results.
   * Appends each body result to output AND sets it as the accumulator for the next iteration.
   * Catches BreakSignal and returns partial scan results.
   * $ is bound to the current element and @ is bound to the accumulator per iteration.
   */
  acc: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'init',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'body',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const seed = args['init'] ?? null;
      const body = args['body'] ?? null;

      if (!isCallable(body)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R040,
          `acc: body must be a closure, got ${inferType(body)}`,
          location
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

      const results: RillValue[] = [];
      let accumulator: RillValue = seed;
      let iterCount = 0;

      try {
        for (const element of elements) {
          iterCount++;
          if (iterCount > MAX_ITER) {
            throw new RuntimeError(
              ERROR_IDS.RILL_R010,
              `acc: iteration exceeded ${MAX_ITER} iterations`,
              location,
              { limit: MAX_ITER, iterations: iterCount }
            );
          }

          const childCtx = createChildContext(ctx as RuntimeContext);
          childCtx.variables.set('@', accumulator);
          childCtx.pipeValue = element;
          const closureToInvoke = isScriptCallable(body)
            ? { ...body, definingScope: childCtx }
            : body;
          // Two-type closures |elem_type, acc_type|{ body } declare '@' as second param.
          // Pass accumulator as second arg so marshalArgs can bind and type-check it.
          const isTwoTypeBody =
            isScriptCallable(body) &&
            body.params.length === 2 &&
            body.params[1]?.name === '@';
          const invokeArgs: RillValue[] = isTwoTypeBody
            ? [element, accumulator]
            : [element];
          const result = await invokeCallable(
            closureToInvoke,
            invokeArgs,
            childCtx,
            location
          );
          results.push(result);
          accumulator = result;
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          return results;
        }
        throw e;
      }

      return results;
    },
  },

  /**
   * Sequential fold with accumulator: invoke body closure per element, return final accumulator only.
   * Does NOT catch BreakSignal; break propagates out.
   * $ is bound to the current element and @ is bound to the accumulator per iteration.
   */
  fold: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'init',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'body',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const seed = args['init'] ?? null;
      const body = args['body'] ?? null;

      if (!isCallable(body)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R040,
          `fold: body must be a closure, got ${inferType(body)}`,
          location
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

      let accumulator: RillValue = seed;
      let iterCount = 0;

      for (const element of elements) {
        iterCount++;
        if (iterCount > MAX_ITER) {
          throw new RuntimeError(
            ERROR_IDS.RILL_R010,
            `fold: iteration exceeded ${MAX_ITER} iterations`,
            location,
            { limit: MAX_ITER, iterations: iterCount }
          );
        }

        const childCtx = createChildContext(ctx as RuntimeContext);
        childCtx.variables.set('@', accumulator);
        childCtx.pipeValue = element;
        const closureToInvoke = isScriptCallable(body)
          ? { ...body, definingScope: childCtx }
          : body;
        // Two-type closures |elem_type, acc_type|{ body } declare '@' as second param.
        // Pass accumulator as second arg so marshalArgs can bind and type-check it.
        const isTwoTypeBody =
          isScriptCallable(body) &&
          body.params.length === 2 &&
          body.params[1]?.name === '@';
        const invokeArgs: RillValue[] = isTwoTypeBody
          ? [element, accumulator]
          : [element];
        const result = await invokeCallable(
          closureToInvoke,
          invokeArgs,
          childCtx,
          location
        );
        accumulator = result;
      }

      return accumulator;
    },
  },

  /**
   * Parallel predicate filter: invoke body closure for each element concurrently,
   * return elements where predicate returned true.
   * Does NOT catch BreakSignal.
   * Predicate result must be a bool; non-bool raises RILL-R001.
   * Preserves source order in the filtered output.
   * options dict may specify { concurrency: number } for batched execution.
   */
  filter: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'body',
        type: { kind: 'any' },
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
      const body = args['body'] ?? null;
      const options = args['options'] ?? null;

      if (!isCallable(body)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R040,
          `filter: body must be a closure, got ${inferType(body)}`,
          location
        );
      }

      // Validate options if provided
      let concurrency: number | undefined;
      if (options !== null && options !== undefined) {
        if (!isDict(options)) {
          throw new RuntimeError(
            ERROR_IDS.RILL_R001,
            `filter: options must be a dict, got ${inferType(options)}`,
            location
          );
        }
        const concurrencyOpt = (options as Record<string, RillValue>)[
          'concurrency'
        ];
        if (concurrencyOpt !== undefined && concurrencyOpt !== null) {
          if (typeof concurrencyOpt !== 'number') {
            throw new RuntimeError(
              ERROR_IDS.RILL_R001,
              `filter: options.concurrency must be a number, got ${inferType(concurrencyOpt)}`,
              location
            );
          }
          if (!Number.isFinite(concurrencyOpt) || concurrencyOpt <= 0) {
            throw new RuntimeError(
              ERROR_IDS.RILL_R001,
              `filter: options.concurrency must be a positive number, got ${concurrencyOpt}`,
              location
            );
          }
          concurrency = Math.floor(concurrencyOpt);
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

      if (elements.length === 0) {
        return [];
      }

      /** Run the predicate for a single element and return keep/discard result. */
      const runPredicate = async (element: RillValue) => {
        const childCtx = createChildContext(ctx as RuntimeContext);
        childCtx.pipeValue = element;
        const result = await invokeCallable(
          body,
          [element],
          childCtx,
          location
        );
        if (typeof result !== 'boolean') {
          throw new RuntimeError(
            ERROR_IDS.RILL_R001,
            `filter: predicate must return bool, got ${inferType(result)}`,
            location
          );
        }
        return { element, keep: result };
      };

      if (concurrency === undefined) {
        // Unbounded parallel: Promise.all over all elements
        const results = await Promise.all(elements.map(runPredicate));
        return results.filter((r) => r.keep).map((r) => r.element);
      }

      // Batched parallel execution preserving source order
      const kept: RillValue[] = [];
      for (const batch of chunkSlice(elements, concurrency)) {
        const batchResults = await Promise.all(batch.map(runPredicate));
        for (const r of batchResults) {
          if (r.keep) kept.push(r.element);
        }
      }

      return kept;
    },
  },

  /**
   * Sort a list or dict by an optional key extractor closure.
   *
   * List form: sort(list) -> list[T] sorted ascending by element value.
   *            sort(list, key_fn) -> list[T] sorted by key_fn(element).
   * Dict form:  sort(dict) -> ordered[[key, value]] sorted by key.
   *             sort(dict, key_fn) -> ordered[[key, value]] sorted by key_fn({key, value}).
   *
   * Error conditions:
   *   EC-1 TYPE_MISMATCH  — mixed-type keys produced by extractor
   *   EC-2 INVALID_INPUT  — extractor returns null (vacant)
   *   EC-3 propagated     — extractor itself halts (no wrapping)
   *   EC-5 TYPE_MISMATCH  — key_fn argument is not a callable
   *   EC-6 RILL_R010      — iteration cap (propagated from getIterableElements)
   */
  sort: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'key_fn',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const keyFnArg = args['key_fn'];

      const site = {
        location,
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'sort',
      };

      // EC-5: validate key_fn if supplied
      if (
        keyFnArg !== undefined &&
        keyFnArg !== null &&
        !isCallable(keyFnArg)
      ) {
        throwTypeHalt(
          site,
          'TYPE_MISMATCH',
          `sort: key_fn must be a closure, got ${inferType(keyFnArg)}`,
          'runtime'
        );
      }

      // ── Dict path ─────────────────────────────────────────────────────────
      if (isDict(input)) {
        const dictInput = input as Record<string, RillValue>;
        const entries = Object.entries(dictInput) as [string, RillValue][];
        const keyFn = keyFnArg ?? DICT_DEFAULT_KEY_FN;

        // Pre-extract sort keys asynchronously (EC-2, EC-3 propagate naturally).
        const keyed = await Promise.all(
          entries.map(async ([k, v]) => {
            const entry: RillValue = { key: k, value: v };
            const childCtx = createChildContext(ctx as RuntimeContext);
            childCtx.pipeValue = entry;
            const key = await invokeCallable(
              keyFn as Parameters<typeof invokeCallable>[0],
              [entry],
              childCtx,
              location
            );
            if (key === null) {
              throwTypeHalt(
                site,
                'INVALID_INPUT',
                'sort: key extractor returned vacant value',
                'runtime'
              );
            }
            return { pair: [k, v] as [string, RillValue], key };
          })
        );

        // Synchronous stable sort on pre-extracted keys (EC-1).
        keyed.sort((a, b) => {
          const cmp = resolvedCompareValue(a.key, b.key);
          if (cmp === undefined) {
            throwTypeHalt(
              site,
              'TYPE_MISMATCH',
              `sort: cannot compare ${inferType(a.key)} with ${inferType(b.key)}`,
              'runtime'
            );
          }
          return cmp;
        });

        return createOrdered(keyed.map(({ pair }) => pair));
      }

      // ── List path ─────────────────────────────────────────────────────────
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (!keyFnArg) {
        // Default identity: compare elements directly (EC-1 via resolvedCompareValue).
        const keyed = elements.map((el) => ({ el, key: el }));
        keyed.sort((a, b) => {
          const cmp = resolvedCompareValue(a.key, b.key);
          if (cmp === undefined) {
            throwTypeHalt(
              site,
              'TYPE_MISMATCH',
              `sort: cannot compare ${inferType(a.key)} with ${inferType(b.key)}`,
              'runtime'
            );
          }
          return cmp;
        });
        return keyed.map(({ el }) => el);
      }

      // With key_fn: pre-extract sort keys asynchronously (EC-2, EC-3 propagate naturally).
      const keyed = await Promise.all(
        elements.map(async (el) => {
          const childCtx = createChildContext(ctx as RuntimeContext);
          childCtx.pipeValue = el;
          const key = await invokeCallable(
            keyFnArg as Parameters<typeof invokeCallable>[0],
            [el],
            childCtx,
            location
          );
          if (key === null) {
            throwTypeHalt(
              site,
              'INVALID_INPUT',
              'sort: key extractor returned vacant value',
              'runtime'
            );
          }
          return { el, key };
        })
      );

      // Synchronous stable sort on pre-extracted keys (EC-1).
      keyed.sort((a, b) => {
        const cmp = resolvedCompareValue(a.key, b.key);
        if (cmp === undefined) {
          throwTypeHalt(
            site,
            'TYPE_MISMATCH',
            `sort: cannot compare ${inferType(a.key)} with ${inferType(b.key)}`,
            'runtime'
          );
        }
        return cmp;
      });

      return keyed.map(({ el }) => el);
    },
  },
};
