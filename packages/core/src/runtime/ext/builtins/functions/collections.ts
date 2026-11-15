import type { RillFunction } from '../../../core/callable.js';
import {
  isCallable,
  isDict,
  isScriptCallable,
} from '../../../core/callable.js';
import {
  isIterator,
  isOrdered,
  isPlainDict,
  isStream,
  positionalElements,
} from '../../../core/types/guards.js';
import type {
  MetadataContext,
  RuntimeContext,
} from '../../../core/types/runtime.js';
import type { SourceLocation } from '../../../../source-location.js';
import {
  rejectBreakAsHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
} from '../../../core/types/halt.js';
import type { TypeHaltSite } from '../../../core/types/halt.js';
import { isInvalid, isVacant } from '../../../core/types/status.js';
import type { RillValue } from '../../../core/types/structures.js';
import { inferType } from '../../../core/types/registrations.js';
import { createOrdered } from '../../../core/types/constructors.js';
import { resolvedCompareValue } from '../../../core/types/protocols/shared.js';
import { anyTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { BreakSignal } from '../../../core/signals.js';
import { createChildContext } from '../../../core/context.js';
import {
  getIterableElements,
  isKeyedSource,
  walkStreamOrIteratorElements,
} from '../../../core/eval/handlers/collections.js';
import { typedKeyCount } from '../../../core/types/dict-keys.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../../../error-registry.js';
import { DEFAULT_MAX_ITERATIONS } from '../../../core/eval/shared.js';
import { bindElement, chunkSlice } from '../shared.js';

/** Halt-site descriptor shared by the collection built-ins' host halts. */
function buildSite(
  fn: string,
  ctx: MetadataContext,
  location: SourceLocation | undefined
): TypeHaltSite {
  return {
    location,
    sourceId: ctx.sourceId,
    fn,
    preserveHostShape: true,
  };
}

/** Halt with RILL-R010 when a source exceeds the iteration ceiling. */
function haltOverCeiling(
  fn: string,
  ctx: MetadataContext,
  location: SourceLocation | undefined,
  iterations: number
): never {
  return throwFatalHostHalt(
    buildSite(fn, ctx, location),
    ERROR_ATOMS[ERROR_IDS.RILL_R010],
    `${fn}: iteration exceeded ${DEFAULT_MAX_ITERATIONS} iterations`,
    { limit: DEFAULT_MAX_ITERATIONS, iterations }
  );
}

/**
 * Element count of an in-memory source (list, tuple, ordered, plain dict)
 * known before any copy is allocated; undefined for strings, streams, and
 * iterators.
 */
function sourceSize(input: RillValue): number | undefined {
  const positional = positionalElements(input);
  if (positional !== undefined) return positional.length;
  if (isOrdered(input)) return input.entries.length;
  if (isPlainDict(input) && !isIterator(input)) {
    return Object.keys(input).length + typedKeyCount(input);
  }
  return undefined;
}

/**
 * Materialize an in-memory collection source and enforce the iteration
 * ceiling before any body or key function runs.
 */
async function materializeSource(
  fn: string,
  input: RillValue,
  ctx: RuntimeContext,
  location: SourceLocation | undefined
): Promise<RillValue[]> {
  const node = {
    span: { start: location ?? { line: 0, column: 0, offset: 0 } },
  };
  const size = sourceSize(input);
  if (size !== undefined && size > DEFAULT_MAX_ITERATIONS) {
    haltOverCeiling(fn, ctx, location, size);
  }
  const elements = await getIterableElements(input, ctx, node);
  if (elements.length > DEFAULT_MAX_ITERATIONS) {
    haltOverCeiling(fn, ctx, location, elements.length);
  }
  return elements;
}

/** Collection built-in functions: seq, fan, acc, fold, filter, sort. */
export const COLLECTION_FUNCTIONS: Record<string, RillFunction> = {
  /**
   * Sequential iteration: invoke body closure for each element, return all results.
   * Catches BreakSignal and returns partial results.
   * $ is bound to the current element per iteration.
   * @ is NOT bound (RILL-R040: undefined variable error if body references $@).
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
        throwCatchableHostHalt(
          buildSite('seq', ctx, location),
          'TYPE_MISMATCH',
          `seq: body must be a closure, got ${inferType(body)}`
        );
      }

      // Fake node for getIterableElements location reporting
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // Stream/iterator inputs are walked lazily one raw step at a time so a
      // `break` in the body bounds how many steps are pulled from an
      // infinite source, instead of materializing it up front.
      if (isStream(input) || isIterator(input)) {
        const { results } = await walkStreamOrIteratorElements(
          input,
          ctx,
          node,
          'seq',
          (element) => {
            const childCtx = createChildContext(ctx);
            const elementArgs = bindElement(childCtx, element, args);
            const closureToInvoke = isScriptCallable(body)
              ? { ...body, definingScope: childCtx }
              : body;
            return invokeCallable(
              closureToInvoke,
              elementArgs,
              childCtx,
              location
            );
          }
        );
        return results;
      }

      const elements = await materializeSource('seq', input, ctx, location);

      const results: RillValue[] = [];

      try {
        for (const element of elements) {
          const childCtx = createChildContext(ctx);
          const elementArgs = bindElement(childCtx, element, args);
          const closureToInvoke = isScriptCallable(body)
            ? { ...body, definingScope: childCtx }
            : body;
          const result = await invokeCallable(
            closureToInvoke,
            elementArgs,
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
        throwCatchableHostHalt(
          buildSite('fan', ctx, location),
          'TYPE_MISMATCH',
          `fan: body must be a closure, got ${inferType(body)}`
        );
      }

      // Validate options if provided
      let concurrency: number | undefined;
      if (options !== null && options !== undefined) {
        if (!isDict(options)) {
          throwCatchableHostHalt(
            buildSite('fan', ctx, location),
            'TYPE_MISMATCH',
            `fan: options must be a dict, got ${inferType(options)}`
          );
        }
        const concurrencyOpt = (options as Record<string, RillValue>)[
          'concurrency'
        ];
        if (concurrencyOpt !== undefined && concurrencyOpt !== null) {
          if (typeof concurrencyOpt !== 'number') {
            throwCatchableHostHalt(
              buildSite('fan', ctx, location),
              'TYPE_MISMATCH',
              `fan: options.concurrency must be a number, got ${inferType(concurrencyOpt)}`
            );
          }
          if (
            !Number.isFinite(concurrencyOpt) ||
            !Number.isInteger(concurrencyOpt) ||
            concurrencyOpt <= 0
          ) {
            throwCatchableHostHalt(
              buildSite('fan', ctx, location),
              'INVALID_INPUT',
              `fan: options.concurrency must be a positive integer, got ${concurrencyOpt}`
            );
          }
          concurrency = concurrencyOpt;
        }

        for (const key of Object.keys(options)) {
          if (key !== 'concurrency') {
            throwCatchableHostHalt(
              buildSite('fan', ctx, location),
              'INVALID_INPUT',
              `fan: unknown option '${key}'; recognized options are 'concurrency'`
            );
          }
        }
      }

      const elements = await materializeSource('fan', input, ctx, location);

      if (elements.length === 0) {
        return [];
      }

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'fan',
      };

      if (concurrency === undefined) {
        // Unbounded parallel: Promise.all over all elements
        const promises = elements.map((element) => {
          const childCtx = createChildContext(ctx, {
            forkCallDepth: true,
          });
          const elementArgs = bindElement(childCtx, element, args);
          return invokeCallable(body, elementArgs, childCtx, location);
        });
        try {
          return await Promise.all(promises);
        } catch (e) {
          rejectBreakAsHalt(e, site);
          throw e;
        }
      }

      // Batched parallel execution
      const results: RillValue[] = [];
      for (const batch of chunkSlice(elements, concurrency)) {
        const batchPromises = batch.map((element) => {
          const childCtx = createChildContext(ctx, {
            forkCallDepth: true,
          });
          const elementArgs = bindElement(childCtx, element, args);
          return invokeCallable(body, elementArgs, childCtx, location);
        });
        try {
          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);
        } catch (e) {
          rejectBreakAsHalt(e, site);
          throw e;
        }
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
        throwCatchableHostHalt(
          buildSite('acc', ctx, location),
          'TYPE_MISMATCH',
          `acc: body must be a closure, got ${inferType(body)}`
        );
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // Stream/iterator inputs are walked lazily one raw step at a time so a
      // `break` in the body bounds how many steps are pulled from an
      // infinite source, instead of materializing it up front.
      if (isStream(input) || isIterator(input)) {
        let lazyAccumulator: RillValue = seed;
        const { results: lazyResults } = await walkStreamOrIteratorElements(
          input,
          ctx,
          node,
          'acc',
          async (element) => {
            const childCtx = createChildContext(ctx);
            childCtx.variables.set('@', lazyAccumulator);
            const closureToInvoke = isScriptCallable(body)
              ? { ...body, definingScope: childCtx }
              : body;
            // Two-type closures |elem_type, acc_type|{ body } declare '@' as
            // second param. Pass accumulator as second arg so marshalArgs
            // can bind and type-check it.
            const isTwoTypeBody =
              isScriptCallable(body) &&
              body.params.length === 2 &&
              body.params[1]?.name === '@';
            const invokeArgs: RillValue[] = isTwoTypeBody
              ? bindElement(childCtx, element, args, [lazyAccumulator])
              : bindElement(childCtx, element, args);
            const result = await invokeCallable(
              closureToInvoke,
              invokeArgs,
              childCtx,
              location
            );
            lazyAccumulator = result;
            return result;
          }
        );
        return lazyResults;
      }

      const elements = await materializeSource('acc', input, ctx, location);

      const results: RillValue[] = [];
      let accumulator: RillValue = seed;

      try {
        for (const element of elements) {
          const childCtx = createChildContext(ctx);
          childCtx.variables.set('@', accumulator);
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
            ? bindElement(childCtx, element, args, [accumulator])
            : bindElement(childCtx, element, args);
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
        throwCatchableHostHalt(
          buildSite('fold', ctx, location),
          'TYPE_MISMATCH',
          `fold: body must be a closure, got ${inferType(body)}`
        );
      }

      const elements = await materializeSource('fold', input, ctx, location);

      let accumulator: RillValue = seed;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'fold',
      };

      for (const element of elements) {
        const childCtx = createChildContext(ctx);
        childCtx.variables.set('@', accumulator);
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
          ? bindElement(childCtx, element, args, [accumulator])
          : bindElement(childCtx, element, args);
        try {
          accumulator = await invokeCallable(
            closureToInvoke,
            invokeArgs,
            childCtx,
            location
          );
        } catch (e) {
          rejectBreakAsHalt(e, site);
          throw e;
        }
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
        throwCatchableHostHalt(
          buildSite('filter', ctx, location),
          'TYPE_MISMATCH',
          `filter: body must be a closure, got ${inferType(body)}`
        );
      }

      // Validate options if provided
      let concurrency: number | undefined;
      if (options !== null && options !== undefined) {
        if (!isDict(options)) {
          throwCatchableHostHalt(
            buildSite('filter', ctx, location),
            'TYPE_MISMATCH',
            `filter: options must be a dict, got ${inferType(options)}`
          );
        }
        const concurrencyOpt = (options as Record<string, RillValue>)[
          'concurrency'
        ];
        if (concurrencyOpt !== undefined && concurrencyOpt !== null) {
          if (typeof concurrencyOpt !== 'number') {
            throwCatchableHostHalt(
              buildSite('filter', ctx, location),
              'TYPE_MISMATCH',
              `filter: options.concurrency must be a number, got ${inferType(concurrencyOpt)}`
            );
          }
          if (
            !Number.isFinite(concurrencyOpt) ||
            !Number.isInteger(concurrencyOpt) ||
            concurrencyOpt <= 0
          ) {
            throwCatchableHostHalt(
              buildSite('filter', ctx, location),
              'INVALID_INPUT',
              `filter: options.concurrency must be a positive integer, got ${concurrencyOpt}`
            );
          }
          concurrency = concurrencyOpt;
        }

        for (const key of Object.keys(options)) {
          if (key !== 'concurrency') {
            throwCatchableHostHalt(
              buildSite('filter', ctx, location),
              'INVALID_INPUT',
              `filter: unknown option '${key}'; recognized options are 'concurrency'`
            );
          }
        }
      }

      const elements = await materializeSource('filter', input, ctx, location);

      if (elements.length === 0) {
        return [];
      }

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'filter',
      };

      /** Run the predicate for a single element and return keep/discard result. */
      const runPredicate = async (element: RillValue) => {
        const childCtx = createChildContext(ctx, {
          forkCallDepth: true,
        });
        const elementArgs = bindElement(childCtx, element, args);
        const result = await invokeCallable(
          body,
          elementArgs,
          childCtx,
          location
        );
        if (isInvalid(result)) {
          throwCatchableHostHalt(
            site,
            ERROR_ATOMS[ERROR_IDS.RILL_R001],
            'filter: predicate returned an invalid value'
          );
        }
        if (typeof result !== 'boolean') {
          throwCatchableHostHalt(
            buildSite('filter', ctx, location),
            'TYPE_MISMATCH',
            `filter: predicate must return bool, got ${inferType(result)}`
          );
        }
        return { element, keep: result };
      };

      if (concurrency === undefined) {
        // Unbounded parallel: Promise.all over all elements
        try {
          const results = await Promise.all(elements.map(runPredicate));
          return results.filter((r) => r.keep).map((r) => r.element);
        } catch (e) {
          rejectBreakAsHalt(e, site);
          throw e;
        }
      }

      // Batched parallel execution preserving source order
      const kept: RillValue[] = [];
      for (const batch of chunkSlice(elements, concurrency)) {
        try {
          const batchResults = await Promise.all(batch.map(runPredicate));
          for (const r of batchResults) {
            if (r.keep) kept.push(r.element);
          }
        } catch (e) {
          rejectBreakAsHalt(e, site);
          throw e;
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
   * Keyed form (ordered or dict): sort(src) -> ordered sorted by key.
   *             sort(src, key_fn) -> ordered sorted by key_fn({key, value}).
   * Tuple, string, stream, and iterator sources sort to a list.
   *
   * Error conditions:
   *   TYPE_MISMATCH  — mixed-type keys produced by extractor
   *   INVALID_INPUT  — extractor returns null (vacant)
   *   propagated     — extractor itself halts (no wrapping)
   *   TYPE_MISMATCH  — key_fn argument is not a callable
   *   RILL_R010      — iteration cap (propagated from getIterableElements)
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
        sourceId: ctx.sourceId,
        fn: 'sort',
      };

      // validate key_fn if supplied
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

      const elements = await materializeSource('sort', input, ctx, location);
      const keyedSource = isKeyedSource(input);

      // Keyed sources yield { key, value } entries; the default key is the
      // entry key. Other sources sort by the element itself.
      const keyed = await Promise.all(
        elements.map(async (el) => {
          let key: RillValue = el;
          if (keyFnArg) {
            const childCtx = createChildContext(ctx, {
              forkCallDepth: true,
            });
            const elArgs = bindElement(childCtx, el, args);
            try {
              key = await invokeCallable(keyFnArg, elArgs, childCtx, location);
            } catch (e) {
              rejectBreakAsHalt(e, site);
              throw e;
            }
            if (isVacant(key)) {
              throwTypeHalt(
                site,
                'INVALID_INPUT',
                'sort: key extractor returned vacant value',
                'runtime'
              );
            }
          } else if (keyedSource && isDict(el)) {
            key = el['key'] ?? null;
          }
          return { el, key };
        })
      );

      // Synchronous stable sort on pre-extracted keys.
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

      if (!keyedSource) {
        return keyed.map(({ el }) => el);
      }
      return createOrdered(
        keyed.map(({ el }): [string, RillValue] => {
          const entry = isDict(el) ? el : {};
          const entryKey = entry['key'];
          const keyText =
            typeof entryKey === 'string' ||
            typeof entryKey === 'number' ||
            typeof entryKey === 'boolean'
              ? String(entryKey)
              : '';
          return [keyText, entry['value'] ?? null];
        })
      );
    },
  },
};
