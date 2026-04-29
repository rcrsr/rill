/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */

import type { RillFunction } from '../core/callable.js';
import {
  callable,
  isCallable,
  isDict,
  isScriptCallable,
} from '../core/callable.js';
import type { RuntimeContext } from '../core/types/runtime.js';
import { type SourceLocation, RuntimeError } from '../../types.js';
import { throwTypeHalt, throwCatchableHostHalt } from '../core/types/halt.js';
import { parseSignatureRegistration } from '../../signature-parser.js';
import type {
  RillDatetime,
  RillDuration,
  RillValue,
  RillVector,
} from '../core/types/structures.js';
import {
  deepEquals,
  formatValue,
  inferType,
  serializeValue,
} from '../core/types/registrations.js';
import { createOrdered } from '../core/types/constructors.js';
import { resolvedCompareValue } from '../core/types/protocols/shared.js';
import {
  isDatetime,
  isDuration,
  isIterator,
  isStream,
  isVector,
} from '../core/types/guards.js';
import { anyTypeValue, isEmpty, structureToTypeValue } from '../core/values.js';
import { invokeCallable } from '../core/eval/index.js';
import { populateBuiltinMethods } from '../core/types/registrations.js';
import { BreakSignal, ControlSignal } from '../core/signals.js';
import { createChildContext } from '../core/context.js';

import { getIterableElements } from '../core/eval/mixins/collections.js';
import { getEvaluator } from '../core/eval/evaluator.js';
import type { EvaluatorInterface } from '../core/eval/interface.js';
import { ERROR_IDS } from '../../error-registry.js';

/**
 * Walk an iterator or stream for up to `cap` steps, collecting values.
 * Returns the collected elements. Stops early when done===true.
 * Used by take() and skip() to avoid materialising the entire sequence.
 */
async function walkIteratorSteps(
  start: Record<string, unknown>,
  cap: number,
  evaluator: EvaluatorInterface,
  location: { line: number; column: number; offset: number },
  sourceId: string | undefined
): Promise<{ elements: RillValue[]; tail: Record<string, unknown> }> {
  const elements: RillValue[] = [];
  let current = start;
  const site = {
    location,
    sourceId: sourceId ?? '<unknown>',
    fn: 'walkIteratorSteps',
  };

  for (let i = 0; i < cap; i++) {
    evaluator.checkAborted();
    if (current['done']) break;
    const val = current['value'];
    if (val !== undefined) {
      elements.push(val as RillValue);
    }
    const nextRaw = current['next'];
    const nextClosure = nextRaw as RillValue;
    if (nextRaw === undefined || !isCallable(nextClosure)) {
      throwCatchableHostHalt(
        site,
        'RILL_R002',
        'Iterator/stream .next must be a closure'
      );
    }
    const nextStep = await evaluator.invokeCallable(
      nextClosure,
      [],
      location,
      'next'
    );
    if (typeof nextStep !== 'object' || nextStep === null) {
      throwCatchableHostHalt(
        site,
        'RILL_R002',
        'Iterator/stream .next must return an object'
      );
    }
    current = nextStep as Record<string, unknown>;
  }

  return { elements, tail: current };
}

/**
 * Slice `elements` into chunks of `size`. The last chunk may be smaller
 * than `size` when `elements.length` is not an exact multiple.
 * Used by `fan`, `filter` (concurrency batches) and `batch` (output chunks).
 */
function chunkSlice(elements: RillValue[], size: number): RillValue[][] {
  const chunks: RillValue[][] = [];
  for (let i = 0; i < elements.length; i += size) {
    chunks.push(elements.slice(i, i + size));
  }
  return chunks;
}

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

const MAX_ITER = 10000;

/**
 * Default key extractor for sort(dict, ...).
 * Receives a { key, value } entry dict and returns the key string.
 * Constructed once at module load; not re-allocated per call.
 */
const DICT_DEFAULT_KEY_FN = callable((args) => {
  const entry = (args as unknown as RillValue[])[0] ?? null;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    'key' in (entry as Record<string, unknown>)
  ) {
    return (entry as Record<string, RillValue>)['key'] ?? null;
  }
  return null;
});

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

  /** Convert any value to JSON string (halts with invalid #INVALID_INPUT on closures, tuples, vectors) */
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
    fn: (args, ctx, location) => {
      const value = args['value'] ?? null;
      try {
        const jsonValue = serializeValue(value);
        return JSON.stringify(jsonValue);
      } catch (err) {
        // Wrap serialization errors (RILL-R067 from protocol) as #INVALID_INPUT halts
        if (err instanceof Error) {
          throwTypeHalt(
            {
              location,
              sourceId: (ctx as RuntimeContext).sourceId,
              fn: 'json',
            },
            'INVALID_INPUT',
            err.message,
            'runtime'
          );
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
          ERROR_IDS.RILL_R001,
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
          ERROR_IDS.RILL_R001,
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
              ERROR_IDS.RILL_R040,
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
        ERROR_IDS.RILL_R040,
        `chain: second argument must be a closure or list of closures, got ${inferType(arg)}`,
        location
      );
    },
  },

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
   * Construct a datetime value from ISO 8601 string, named components, or unix ms.
   * Validates all inputs; halts on invalid.
   */
  datetime: {
    params: [
      {
        name: 'input',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
      {
        name: 'year',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
      {
        name: 'month',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
      {
        name: 'day',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
      {
        name: 'hour',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'minute',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'second',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'ms',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'unix',
        type: { kind: 'any' },
        defaultValue: null,
        annotations: {},
      },
    ],
    returnType: structureToTypeValue({ kind: 'datetime' }),
    fn: (args, _ctx, location) => {
      return constructDatetime(args, location);
    },
  },

  /**
   * Return current UTC instant.
   * Reads ctx.nowMs when set; otherwise uses Date.now().
   */
  now: {
    params: [],
    returnType: structureToTypeValue({ kind: 'datetime' }),
    fn: (_args, ctx, location) => {
      const nowMs = (ctx as RuntimeContext).nowMs;
      if (nowMs !== undefined) {
        if (!Number.isFinite(nowMs) || !Number.isInteger(nowMs)) {
          throwTypeHalt(
            {
              location,
              sourceId: (ctx as RuntimeContext).sourceId,
              fn: 'now',
            },
            'INVALID_INPUT',
            `now() requires ctx.nowMs to be a finite integer: ${nowMs}`,
            'runtime',
            undefined,
            'host'
          );
        }
        return { __rill_datetime: true, unix: nowMs } as unknown as RillValue;
      }
      return {
        __rill_datetime: true,
        unix: Date.now(),
      } as unknown as RillValue;
    },
  },

  /**
   * Construct a duration value from named unit parameters.
   * All values must be non-negative integers; negative values halt.
   * Fixed units collapse to single ms field; calendar units collapse to months.
   */
  duration: {
    params: [
      {
        name: 'years',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'months',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'days',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'hours',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'minutes',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'seconds',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
      {
        name: 'ms',
        type: { kind: 'any' },
        defaultValue: 0,
        annotations: {},
      },
    ],
    returnType: structureToTypeValue({ kind: 'duration' }),
    fn: (args, _ctx, location) => {
      return constructDuration(args, location);
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
        const evaluator = getEvaluator(
          ctx as RuntimeContext
        ) as unknown as EvaluatorInterface;
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
        const evaluator = getEvaluator(
          ctx as RuntimeContext
        ) as unknown as EvaluatorInterface;

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
   * options dict may specify { drop_partial: bool } to discard a trailing
   * chunk shorter than n (default false — keep partial tail).
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

      // Read drop_partial option (default false)
      let dropPartial = false;
      if (options !== null && options !== undefined) {
        const dp = (options as Record<string, RillValue>)['drop_partial'];
        if (dp !== undefined && dp !== null) {
          dropPartial = dp === true;
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

// ============================================================
// DATETIME CONSTRUCTION HELPERS
// ============================================================

/** ISO 8601 regex: YYYY-MM-DDTHH:MM:SS[.mmm][Z|+HH:MM|-HH:MM] */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** Valid datetime named component keys */
const DATETIME_COMPONENT_KEYS = new Set([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'ms',
]);

/** Days in each month (non-leap year). Index 0 unused. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function maxDayInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month]!;
}

function validateComponent(
  name: string,
  value: number,
  min: number,
  max: number,
  location?: SourceLocation
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component ${name}: ${value}`,
      'runtime',
      { component: name }
    );
  }
}

/**
 * Construct a RillDatetime from parsed args.
 * Handles ISO string, named components, and unix ms forms.
 */
function constructDatetime(
  args: Record<string, RillValue>,
  location?: SourceLocation
): RillValue {
  const input = args['input'] ?? null;
  const hasUnix = args['unix'] !== undefined && args['unix'] !== null;
  const hasYear = args['year'] !== undefined && args['year'] !== null;
  const hasInput = input !== null;

  // Count active forms
  const formCount =
    (hasInput && typeof input === 'string' ? 1 : 0) +
    (hasYear ? 1 : 0) +
    (hasUnix ? 1 : 0);

  // No arguments provided
  if (!hasInput && !hasYear && !hasUnix) {
    // Check if any optional time components were passed without year/month/day
    const hasTimeOnly =
      (args['hour'] !== undefined &&
        args['hour'] !== null &&
        args['hour'] !== 0) ||
      (args['minute'] !== undefined &&
        args['minute'] !== null &&
        args['minute'] !== 0) ||
      (args['second'] !== undefined &&
        args['second'] !== null &&
        args['second'] !== 0) ||
      (args['ms'] !== undefined && args['ms'] !== null && args['ms'] !== 0);
    if (hasTimeOnly) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        'datetime() accepts string, named components, or unix',
        'runtime'
      );
    }
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() requires arguments',
      'runtime'
    );
  }

  // Mixed forms
  if (formCount > 1) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() accepts string, named components, or unix',
      'runtime'
    );
  }

  // Check for unknown parameters
  for (const key of Object.keys(args)) {
    if (
      key !== 'input' &&
      key !== 'unix' &&
      !DATETIME_COMPONENT_KEYS.has(key)
    ) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Unknown datetime parameter: ${key}`,
        'runtime',
        { parameter: key }
      );
    }
  }

  // Form 1: ISO 8601 string
  if (hasInput && typeof input === 'string') {
    // Reject non-ISO formats
    if (!ISO_8601_RE.test(input)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid ISO 8601 string: ${input}`,
        'runtime'
      );
    }
    const ms = Date.parse(input);
    if (Number.isNaN(ms)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid ISO 8601 string: ${input}`,
        'runtime'
      );
    }
    return { __rill_datetime: true, unix: ms } as unknown as RillValue;
  }

  // Form 1 non-string: halt
  if (hasInput) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid ISO 8601 string: ${formatValue(input)}`,
      'runtime'
    );
  }

  // Form 3: Unix milliseconds
  if (hasUnix) {
    const unix = args['unix'];
    if (typeof unix !== 'number' || !Number.isFinite(unix)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid datetime component unix: ${formatValue(unix ?? null)}`,
        'runtime',
        { component: 'unix' }
      );
    }
    return { __rill_datetime: true, unix } as unknown as RillValue;
  }

  // Form 2: Named components
  const year = args['year'] as number;
  const month = args['month'];
  const day = args['day'];

  if (typeof year !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component year: ${formatValue(year)}`,
      'runtime',
      { component: 'year' }
    );
  }
  if (month === undefined || month === null || typeof month !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component month: ${formatValue(month ?? null)}`,
      'runtime',
      { component: 'month' }
    );
  }
  if (day === undefined || day === null || typeof day !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component day: ${formatValue(day ?? null)}`,
      'runtime',
      { component: 'day' }
    );
  }

  validateComponent('year', year, -271821, 275760, location);
  validateComponent('month', month, 1, 12, location);
  validateComponent('day', day, 1, maxDayInMonth(year, month), location);

  const hour = typeof args['hour'] === 'number' ? args['hour'] : 0;
  const minute = typeof args['minute'] === 'number' ? args['minute'] : 0;
  const second = typeof args['second'] === 'number' ? args['second'] : 0;
  const ms = typeof args['ms'] === 'number' ? args['ms'] : 0;

  validateComponent('hour', hour, 0, 23, location);
  validateComponent('minute', minute, 0, 59, location);
  validateComponent('second', second, 0, 59, location);
  validateComponent('ms', ms, 0, 999, location);

  const unix = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return { __rill_datetime: true, unix } as unknown as RillValue;
}

// ============================================================
// DURATION CONSTRUCTION HELPERS
// ============================================================

/** Valid duration named parameter keys */
const DURATION_PARAM_KEYS = new Set([
  'years',
  'months',
  'days',
  'hours',
  'minutes',
  'seconds',
  'ms',
]);

/**
 * Validate a duration parameter: must be a non-negative integer.
 * Halts with invalid #INVALID_INPUT on non-number or negative value.
 */
function validateDurationParam(
  name: string,
  value: RillValue,
  location?: SourceLocation
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwTypeHalt(
      { location, fn: 'duration' },
      'INVALID_INPUT',
      `duration ${name} must be a finite number: ${formatValue(value)}`,
      'runtime',
      { parameter: name }
    );
  }
  if (value < 0) {
    throwTypeHalt(
      { location, fn: 'duration' },
      'INVALID_INPUT',
      `duration ${name} must be non-negative: ${value}`,
      'runtime',
      { parameter: name }
    );
  }
  return value;
}

/**
 * Construct a RillDuration from parsed args.
 * Collapses calendar units to months field and fixed units to ms field.
 */
function constructDuration(
  args: Record<string, RillValue>,
  location?: SourceLocation
): RillValue {
  // Check for unknown parameters
  for (const key of Object.keys(args)) {
    if (!DURATION_PARAM_KEYS.has(key)) {
      throwTypeHalt(
        { location, fn: 'duration' },
        'INVALID_INPUT',
        `Unknown duration parameter: ${key}`,
        'runtime',
        { parameter: key }
      );
    }
  }

  const years =
    args['years'] !== undefined && args['years'] !== null && args['years'] !== 0
      ? validateDurationParam('years', args['years'], location)
      : 0;
  const months =
    args['months'] !== undefined &&
    args['months'] !== null &&
    args['months'] !== 0
      ? validateDurationParam('months', args['months'], location)
      : 0;
  const days =
    args['days'] !== undefined && args['days'] !== null && args['days'] !== 0
      ? validateDurationParam('days', args['days'], location)
      : 0;
  const hours =
    args['hours'] !== undefined && args['hours'] !== null && args['hours'] !== 0
      ? validateDurationParam('hours', args['hours'], location)
      : 0;
  const minutes =
    args['minutes'] !== undefined &&
    args['minutes'] !== null &&
    args['minutes'] !== 0
      ? validateDurationParam('minutes', args['minutes'], location)
      : 0;
  const seconds =
    args['seconds'] !== undefined &&
    args['seconds'] !== null &&
    args['seconds'] !== 0
      ? validateDurationParam('seconds', args['seconds'], location)
      : 0;
  const ms =
    args['ms'] !== undefined && args['ms'] !== null && args['ms'] !== 0
      ? validateDurationParam('ms', args['ms'], location)
      : 0;

  // Collapse calendar units to months field
  const totalMonths = years * 12 + months;

  // Collapse fixed units to ms field
  const totalMs =
    days * 86_400_000 +
    hours * 3_600_000 +
    minutes * 60_000 +
    seconds * 1_000 +
    ms;

  return {
    __rill_duration: true,
    months: totalMonths,
    ms: totalMs,
  } as unknown as RillValue;
}

// ============================================================
// DATETIME FORMATTING HELPERS
// ============================================================

/** Pad a number to the given width with leading zeros */
function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Apply an offset in hours to a UTC ms timestamp and return a Date-like
 * breakdown. The offset may be fractional (e.g. 5.5 for +05:30).
 */
function applyOffset(
  utcMs: number,
  offsetHours: number
): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
} {
  const shifted = new Date(utcMs + offsetHours * 3_600_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    s: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

/** Format timezone offset string like "+05:30" or "Z" */
function formatOffsetSuffix(offsetHours: number): string {
  if (offsetHours === 0) return 'Z';
  const sign = offsetHours >= 0 ? '+' : '-';
  const totalMinutes = Math.round(Math.abs(offsetHours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${padNum(h, 2)}:${padNum(m, 2)}`;
}

/** Format as full ISO 8601 string with timezone indicator */
function formatIso(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  const suffix = formatOffsetSuffix(offsetHours);
  return (
    `${padNum(p.y, 4)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}` +
    `T${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}` +
    (p.ms > 0 ? `.${padNum(p.ms, 3)}` : '') +
    suffix
  );
}

/** Format as "YYYY-MM-DD" */
function formatDate(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${padNum(p.y, 4)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}`;
}

/** Format as "HH:MM:SS" */
function formatTime(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}`;
}

// ============================================================
// DATETIME METHOD BODIES
// ============================================================

/** .year property - UTC year */
const mDtYear: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCFullYear();
};

/** .month property - UTC month (1-12) */
const mDtMonth: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMonth() + 1;
};

/** .day property - UTC day of month (1-31) */
const mDtDay: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCDate();
};

/** .hour property - UTC hour (0-23) */
const mDtHour: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCHours();
};

/** .minute property - UTC minute (0-59) */
const mDtMinute: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMinutes();
};

/** .second property - UTC second (0-59) */
const mDtSecond: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCSeconds();
};

/** .ms property - UTC millisecond (0-999) */
const mDtMs: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMilliseconds();
};

/** .unix property - raw UTC ms since epoch */
const mDtUnix: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return dt.unix;
};

/** .weekday property - 1 (Monday) through 7 (Sunday) */
const mDtWeekday: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  const jsDay = new Date(dt.unix).getUTCDay(); // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay; // Convert to 1=Mon, 7=Sun
};

/** .empty property - returns datetime(unix: 0) */
const mDtEmpty: RillMethod = () => {
  return { __rill_datetime: true, unix: 0 } as unknown as RillValue;
};

/** .iso(offset?) - full ISO 8601 with timezone indicator */
const mDtIso: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatIso(dt.unix, offset);
};

/** .date(offset?) - "YYYY-MM-DD" portion */
const mDtDate: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatDate(dt.unix, offset);
};

/** .time(offset?) - "HH:MM:SS" portion */
const mDtTime: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatTime(dt.unix, offset);
};

/** Validate and return the timezone offset from ctx, defaulting to 0 */
function getTimezoneOffset(
  ctx: RuntimeContext,
  location?: SourceLocation
): number {
  const tz = ctx.timezone;
  if (tz === undefined) return 0;
  if (!Number.isFinite(tz)) {
    throwTypeHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'timezone',
      },
      'INVALID_INPUT',
      `Invalid timezone offset: ${tz}`,
      'runtime',
      undefined,
      'host'
    );
  }
  return tz;
}

/** .local_iso property - ISO 8601 with host timezone offset */
const mDtLocalIso: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatIso(dt.unix, offset);
};

/** .local_date property - "YYYY-MM-DD" at host timezone */
const mDtLocalDate: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatDate(dt.unix, offset);
};

/** .local_time property - "HH:MM:SS" at host timezone */
const mDtLocalTime: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatTime(dt.unix, offset);
};

/** .local_offset property - host timezone offset in hours */
const mDtLocalOffset: RillMethod = (_receiver, _args, ctx, location) => {
  return getTimezoneOffset(ctx, location);
};

/** .add(dur) - add a duration to a datetime */
const mDtAdd: RillMethod = (receiver, args, _ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const dur = args[0] ?? null;
  if (!isDuration(dur)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'datetime.add() requires a duration argument',
      location
    );
  }
  const d = dur as unknown as RillDuration;
  let resultMs = dt.unix;

  // Apply calendar months first (PostgreSQL order)
  if (d.months !== 0) {
    const date = new Date(resultMs);
    let targetMonth = date.getUTCMonth() + d.months;
    let targetYear = date.getUTCFullYear();

    // Normalize month overflow
    targetYear += Math.floor(targetMonth / 12);
    targetMonth = targetMonth % 12;
    if (targetMonth < 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    // Clamp day to last valid day of target month
    const maxDay = maxDayInMonth(targetYear, targetMonth + 1);
    const clampedDay = Math.min(date.getUTCDate(), maxDay);

    resultMs = Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    );
  }

  // Then apply milliseconds
  resultMs += d.ms;

  return { __rill_datetime: true, unix: resultMs } as unknown as RillValue;
};

/** .diff(other) - absolute difference between two datetimes as duration */
const mDtDiff: RillMethod = (receiver, args, _ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'datetime.diff() requires a datetime argument',
      location
    );
  }
  const otherDt = other as unknown as RillDatetime;
  const diffMs = Math.abs(dt.unix - otherDt.unix);
  // Always non-negative, months = 0
  return {
    __rill_duration: true,
    months: 0,
    ms: diffMs,
  } as unknown as RillValue;
};

/** .eq(other) - datetime equality */
const mDtEq: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix === (other as unknown as RillDatetime).unix;
};

/** .ne(other) - datetime inequality */
const mDtNe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return true;
  return dt.unix !== (other as unknown as RillDatetime).unix;
};

/** .lt(other) - datetime less-than */
const mDtLt: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix < (other as unknown as RillDatetime).unix;
};

/** .gt(other) - datetime greater-than */
const mDtGt: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix > (other as unknown as RillDatetime).unix;
};

/** .le(other) - datetime less-than-or-equal */
const mDtLe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix <= (other as unknown as RillDatetime).unix;
};

/** .ge(other) - datetime greater-than-or-equal */
const mDtGe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix >= (other as unknown as RillDatetime).unix;
};

// ============================================================
// DURATION METHOD BODIES
// ============================================================

/** .months property - calendar month count */
const mDurMonths: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return dur.months;
};

/** .days property - floor(ms / 86400000) */
const mDurDays: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return Math.floor(dur.ms / 86_400_000);
};

/** .hours property - remainder after days */
const mDurHours: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterDays = dur.ms % 86_400_000;
  return Math.floor(afterDays / 3_600_000);
};

/** .minutes property - remainder after hours */
const mDurMinutes: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterHours = dur.ms % 3_600_000;
  return Math.floor(afterHours / 60_000);
};

/** .seconds property - remainder after minutes */
const mDurSeconds: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterMinutes = dur.ms % 60_000;
  return Math.floor(afterMinutes / 1_000);
};

/** .ms property - remainder after seconds */
const mDurMs: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return dur.ms % 1_000;
};

/** .total_ms property - raw ms; halts when months > 0 */
const mDurTotalMs: RillMethod = (receiver, _args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  if (dur.months > 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'total_ms is not defined for calendar durations',
      location
    );
  }
  return dur.ms;
};

/** .display property - compact format omitting zero components */
const mDurDisplay: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const parts: string[] = [];

  // Calendar portion
  const years = Math.floor(dur.months / 12);
  const remainingMonths = dur.months % 12;
  if (years > 0) parts.push(`${years}y`);
  if (remainingMonths > 0) parts.push(`${remainingMonths}mo`);

  // Clock portion (largest-first decomposition)
  let remaining = dur.ms;
  const days = Math.floor(remaining / 86_400_000);
  remaining = remaining % 86_400_000;
  const hours = Math.floor(remaining / 3_600_000);
  remaining = remaining % 3_600_000;
  const minutes = Math.floor(remaining / 60_000);
  remaining = remaining % 60_000;
  const seconds = Math.floor(remaining / 1_000);
  const ms = remaining % 1_000;

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (ms > 0) parts.push(`${ms}ms`);

  // Zero duration displays as "0ms"
  if (parts.length === 0) return '0ms';
  return parts.join('');
};

/** .empty property - returns duration(ms: 0) */
const mDurEmpty: RillMethod = () => {
  return {
    __rill_duration: true,
    months: 0,
    ms: 0,
  } as unknown as RillValue;
};

/** .add(other) - sum months fields, sum ms fields */
const mDurAdd: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.add() requires a duration argument',
      location
    );
  }
  const otherDur = other as unknown as RillDuration;
  return {
    __rill_duration: true,
    months: dur.months + otherDur.months,
    ms: dur.ms + otherDur.ms,
  } as unknown as RillValue;
};

/** .subtract(other) - halt if result would be negative in either field */
const mDurSubtract: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.subtract() requires a duration argument',
      location
    );
  }
  const otherDur = other as unknown as RillDuration;
  const resultMonths = dur.months - otherDur.months;
  const resultMs = dur.ms - otherDur.ms;
  if (resultMonths < 0 || resultMs < 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.subtract() would produce negative result',
      location
    );
  }
  return {
    __rill_duration: true,
    months: resultMonths,
    ms: resultMs,
  } as unknown as RillValue;
};

/** .multiply(n) - months and ms each multiplied independently */
const mDurMultiply: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const n = args[0] ?? null;
  if (typeof n !== 'number') {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.multiply() requires a number argument',
      location
    );
  }
  if (n < 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.multiply() requires non-negative number',
      location
    );
  }
  return {
    __rill_duration: true,
    months: dur.months * n,
    ms: dur.ms * n,
  } as unknown as RillValue;
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
          ERROR_IDS.RILL_R044,
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
  datetime: Record<string, RillFunction>;
  duration: Record<string, RillFunction>;
} = {
  string: null as unknown as Record<string, RillFunction>,
  list: null as unknown as Record<string, RillFunction>,
  dict: null as unknown as Record<string, RillFunction>,
  number: null as unknown as Record<string, RillFunction>,
  bool: null as unknown as Record<string, RillFunction>,
  vector: null as unknown as Record<string, RillFunction>,
  datetime: null as unknown as Record<string, RillFunction>,
  duration: null as unknown as Record<string, RillFunction>,
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
        ERROR_IDS.RILL_R002,
        'Cannot get head of empty list',
        location
      );
    }
    return receiver[0]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get head of empty string',
        location
      );
    }
    return receiver[0]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
    `head requires list or string, got ${inferType(receiver)}`,
    location
  );
};

/** Get last element of list or last char of string */
const mTail: RillMethod = (receiver, _args, _ctx, location) => {
  if (Array.isArray(receiver)) {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get tail of empty list',
        location
      );
    }
    return receiver[receiver.length - 1]!;
  }
  if (typeof receiver === 'string') {
    if (receiver.length === 0) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        'Cannot get tail of empty string',
        location
      );
    }
    return receiver[receiver.length - 1]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
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
    ERROR_IDS.RILL_R003,
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
        ERROR_IDS.RILL_R002,
        `List index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
  }
  if (typeof receiver === 'string') {
    if (idx < 0 || idx >= receiver.length) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R002,
        `String index out of bounds: ${idx}`,
        location
      );
    }
    return receiver[idx]!;
  }
  throw new RuntimeError(
    ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
      `has() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
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
      ERROR_IDS.RILL_R003,
      `has_any() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_any() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
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
      ERROR_IDS.RILL_R003,
      `has_all() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  if (args.length !== 1) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
      `has_all() expects 1 argument, got ${args.length}`,
      location
    );
  }
  const candidates = args[0] ?? null;
  if (!Array.isArray(candidates)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R001,
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

/** Return a new list with elements in reversed order */
const mReverse: RillMethod = (receiver, _args, _ctx, location) => {
  if (!Array.isArray(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `reverse() requires list receiver, got ${inferType(receiver)}`,
      location
    );
  }
  return [...receiver].reverse();
};

/** Get number of dimensions in vector */
const mDimensions: RillMethod = (receiver, _args, _ctx, location) => {
  if (!isVector(receiver)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
      `similarity requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
      `dot requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
      `distance requires vector receiver, got ${inferType(receiver)}`,
      location
    );
  }
  const other = args[0] ?? null;
  if (!isVector(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      `expected vector, got ${inferType(other)}`,
      location
    );
  }
  if (receiver.data.length !== other.data.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
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
      ERROR_IDS.RILL_R003,
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
  reverse: buildMethodEntry('reverse', '||:list', mReverse),
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

// Datetime methods: properties, string formatters, local properties, arithmetic.
// All property-style methods (year, month, day, etc.) use skipReceiverValidation
// because the receiver is always a RillDatetime discriminated by __rill_datetime.
BUILTIN_METHODS.datetime = Object.freeze({
  // Component properties (IR-4)
  year: buildMethodEntry('year', '||:number', mDtYear, true),
  month: buildMethodEntry('month', '||:number', mDtMonth, true),
  day: buildMethodEntry('day', '||:number', mDtDay, true),
  hour: buildMethodEntry('hour', '||:number', mDtHour, true),
  minute: buildMethodEntry('minute', '||:number', mDtMinute, true),
  second: buildMethodEntry('second', '||:number', mDtSecond, true),
  ms: buildMethodEntry('ms', '||:number', mDtMs, true),
  unix: buildMethodEntry('unix', '||:number', mDtUnix, true),
  weekday: buildMethodEntry('weekday', '||:number', mDtWeekday, true),
  empty: buildMethodEntry('empty', '||:datetime', mDtEmpty, true),

  // String formatting methods (IR-5)
  iso: buildMethodEntry('iso', '|offset: number = 0|:string', mDtIso, true),
  date: buildMethodEntry('date', '|offset: number = 0|:string', mDtDate, true),
  time: buildMethodEntry('time', '|offset: number = 0|:string', mDtTime, true),

  // Local properties (IR-6)
  local_iso: buildMethodEntry('local_iso', '||:string', mDtLocalIso, true),
  local_date: buildMethodEntry('local_date', '||:string', mDtLocalDate, true),
  local_time: buildMethodEntry('local_time', '||:string', mDtLocalTime, true),
  local_offset: buildMethodEntry(
    'local_offset',
    '||:number',
    mDtLocalOffset,
    true
  ),

  // Arithmetic methods (IR-7)
  add: buildMethodEntry('add', '|dur: any|:datetime', mDtAdd, true),
  diff: buildMethodEntry('diff', '|other: any|:duration', mDtDiff, true),

  // Comparison methods
  eq: buildMethodEntry('eq', SIG_EQ, mDtEq, true),
  ne: buildMethodEntry('ne', SIG_NE, mDtNe, true),
  lt: buildMethodEntry('lt', SIG_CMP, mDtLt, true),
  gt: buildMethodEntry('gt', SIG_CMP, mDtGt, true),
  le: buildMethodEntry('le', SIG_CMP, mDtLe, true),
  ge: buildMethodEntry('ge', SIG_CMP, mDtGe, true),
});

// Duration methods: properties, display, arithmetic.
// All use skipReceiverValidation because the receiver is a RillDuration
// discriminated by __rill_duration.
BUILTIN_METHODS.duration = Object.freeze({
  // Decomposition properties (IR-8)
  months: buildMethodEntry('months', '||:number', mDurMonths, true),
  days: buildMethodEntry('days', '||:number', mDurDays, true),
  hours: buildMethodEntry('hours', '||:number', mDurHours, true),
  minutes: buildMethodEntry('minutes', '||:number', mDurMinutes, true),
  seconds: buildMethodEntry('seconds', '||:number', mDurSeconds, true),
  ms: buildMethodEntry('ms', '||:number', mDurMs, true),
  total_ms: buildMethodEntry('total_ms', '||:number', mDurTotalMs, true),
  display: buildMethodEntry('display', '||:string', mDurDisplay, true),
  empty: buildMethodEntry('empty', '||:duration', mDurEmpty, true),

  // Arithmetic methods (IR-9)
  add: buildMethodEntry('add', '|other: any|:duration', mDurAdd, true),
  subtract: buildMethodEntry(
    'subtract',
    '|other: any|:duration',
    mDurSubtract,
    true
  ),
  multiply: buildMethodEntry(
    'multiply',
    '|n: any|:duration',
    mDurMultiply,
    true
  ),
});

// Populate registration methods from BUILTIN_METHODS at module load time.
// No circular dependency: type-registrations.ts does not import builtins.ts.
populateBuiltinMethods(BUILTIN_METHODS);
