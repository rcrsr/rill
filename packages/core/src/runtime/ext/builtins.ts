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
import { RuntimeError } from '../../types.js';
import {
  throwTypeHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../core/types/halt.js';
import type { RillDuration, RillValue } from '../core/types/structures.js';
import {
  formatValue,
  inferType,
  serializeValue,
} from '../core/types/registrations.js';
import { createOrdered } from '../core/types/constructors.js';
import { resolvedCompareValue } from '../core/types/protocols/shared.js';
import { isDuration, isIterator, isStream } from '../core/types/guards.js';
import { anyTypeValue, structureToTypeValue } from '../core/values.js';
import { invokeCallable } from '../core/eval/index.js';
import { populateBuiltinMethods } from '../core/types/registrations.js';
import { BreakSignal, ControlSignal } from '../core/signals.js';
import { createChildContext } from '../core/context.js';
import { registerBuiltinFunctions } from '../core/builtin-registry.js';

import { getIterableElements } from '../core/eval/handlers/collections.js';
import { getEvalState } from '../core/eval/state.js';
import { ERROR_IDS } from '../../error-registry.js';
import {
  walkIteratorSteps,
  chunkSlice,
  makeListIterator,
  MAX_ITER,
  makeGenericIterator,
  DICT_DEFAULT_KEY_FN,
} from './builtins/shared.js';
import {
  STRING_METHODS,
  LIST_METHODS,
  DICT_METHODS,
  NUMBER_METHODS,
  BOOL_METHODS,
  VECTOR_METHODS,
  DATETIME_METHODS,
  DURATION_METHODS,
} from './builtins/methods/tables.js';
import {
  constructDatetime,
  constructDuration,
} from './builtins/temporal/construct.js';

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

      return makeGenericIterator(start as RillValue, (current) => {
        const c = current as number;
        const done = step > 0 ? c >= end : step < 0 ? c <= end : true;
        if (done) return { done: true };
        return {
          done: false,
          value: c as RillValue,
          next: (c + step) as RillValue,
        };
      });
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

      return makeGenericIterator(count as RillValue, (current) => {
        const remaining = current as number;
        if (remaining <= 0) return { done: true };
        return { done: false, value, next: (remaining - 1) as RillValue };
      });
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

  /**
   * Infinite iterator source: emit seed, then repeatedly apply closure to
   * produce the next value (which becomes the next seed).
   *
   * Call form:  iterate(seed, closure)
   * Pipe form:  $seed -> iterate(closure)   (pipeValue auto-detected)
   *
   * The stream is unbounded; bound it externally with take(n), stop_when,
   * or let RILL_R010 enforce the MAX_ITER ceiling.
   *
   * Error contracts:
   *   EC-14  Closure throws catchable halt   → propagates (catchable)
   *   EC-15  Closure throws non-catchable    → propagates (non-catchable)
   *   EC-16  Iteration exceeds MAX_ITER      → RILL_R010 (non-catchable)
   *   EC-17  Closure missing/not invocable   → RILL_R006 (catchable)
   */
  iterate: {
    params: [
      {
        name: 'seed',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'closure',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      // iterate is in UNTYPED_BUILTINS; receives a positional array cast as Record.
      // Pipe form: $seed -> iterate($closure) sends args=[$closure] with pipeValue=$seed.
      // Detect by checking whether there is exactly one arg and a pipe value is set.
      const positional = args as unknown as RillValue[];
      let seed: RillValue;
      let closureArg: RillValue;
      if (
        positional.length === 1 &&
        (ctx as RuntimeContext).pipeValue !== null
      ) {
        seed = (ctx as RuntimeContext).pipeValue;
        closureArg = positional[0] ?? null;
      } else {
        seed = positional[0] ?? null;
        closureArg = positional[1] ?? null;
      }

      const site = {
        location,
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'iterate',
      };

      if (!isCallable(closureArg)) {
        throwCatchableHostHalt(
          site,
          'RILL_R006',
          `iterate: closure must be a callable, got ${inferType(closureArg)}`
        );
      }

      const closure = closureArg;
      const runtimeCtx = ctx as RuntimeContext;
      let stepCount = 0;

      // Build a chunk lazily: emit `current` now, defer closure invocation
      // until the consumer pulls .next(). This avoids running the step
      // closure (and its side effects) one element ahead of consumption.
      const buildChunk = (current: RillValue): RillValue => {
        return {
          value: current,
          done: false,
          next: callable(async () => {
            stepCount++;
            if (stepCount > MAX_ITER) {
              throwFatalHostHalt(
                site,
                'RILL_R010',
                `iterate: iteration exceeded ${MAX_ITER} limit`
              );
            }
            const childCtx = createChildContext(runtimeCtx);
            childCtx.pipeValue = current;
            const nextSeed = await invokeCallable(
              closure,
              [current],
              childCtx,
              location
            );
            return buildChunk(nextSeed);
          }),
        };
      };

      return buildChunk(seed);
    },
  },

  /**
   * Suppress rapid stream emissions; emit the latest chunk after `duration`
   * of silence since the last observed chunk.
   *
   * Stream-only: rejects list input with #INVALID_INPUT (EC-10).
   * `duration` arg must be a duration value (EC-11).
   * Iteration ceiling enforced via getIterableElements (EC-12).
   * Upstream halt propagates through getIterableElements (EC-13).
   *
   * Semantics: of all observed chunks, emit only those not followed by
   * another chunk within `duration.ms`. With all chunks at the same virtual
   * timestamp (deterministic clock), only the last chunk passes.
   *
   * Per AC-25: debounce = emit latest after silence.
   */
  debounce: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'dur',
        type: { kind: 'duration' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const durArg = args['dur'] ?? null;

      const site = {
        location,
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'debounce',
      };

      // EC-10: reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'debounce: requires a stream or iterator input, got list'
        );
      }

      // EC-11: duration arg must be a duration value
      if (!isDuration(durArg)) {
        throwCatchableHostHalt(
          site,
          'TYPE_MISMATCH',
          `debounce: duration argument must be a duration, got ${inferType(durArg)}`
        );
      }

      const durationMs = (durArg as RillDuration).ms;
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // EC-12 enforced by getIterableElements limit; EC-13 propagates halts
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (elements.length === 0) {
        return [];
      }

      // For each chunk: emit it only if no subsequent chunk arrives within
      // `durationMs` of it. In batch mode (static ctx.nowMs or synchronous
      // processing) all chunks share the same timestamp, so the gap between
      // consecutive chunks is 0. Only the last chunk has an Infinity gap
      // (no follower), so only it passes when durationMs > 0.
      const result: RillValue[] = [];
      for (let i = 0; i < elements.length; i++) {
        // Gap to next chunk: 0 for non-terminal (static clock); Infinity for last.
        const tGap = i + 1 < elements.length ? 0 : Infinity;
        // Emit if silence gap (time to next chunk) meets or exceeds durationMs.
        if (tGap >= durationMs) {
          result.push(elements[i]!);
        }
      }

      return result;
    },
  },

  /**
   * Limit stream emission to at most one chunk per `duration` interval.
   * The first chunk in each interval passes; subsequent chunks in the same
   * interval are suppressed.
   *
   * Stream-only: rejects list input with #INVALID_INPUT (EC-10).
   * `duration` arg must be a duration value (EC-11).
   * Iteration ceiling enforced via getIterableElements (EC-12).
   * Upstream halt propagates through getIterableElements (EC-13).
   *
   * Per AC-25: throttle = first-of-interval.
   */
  throttle: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'dur',
        type: { kind: 'duration' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const durArg = args['dur'] ?? null;

      const site = {
        location,
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'throttle',
      };

      // EC-10: reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'throttle: requires a stream or iterator input, got list'
        );
      }

      // EC-11: duration arg must be a duration value
      if (!isDuration(durArg)) {
        throwCatchableHostHalt(
          site,
          'TYPE_MISMATCH',
          `throttle: duration argument must be a duration, got ${inferType(durArg)}`
        );
      }

      const durationMs = (durArg as RillDuration).ms;
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // EC-12 enforced by getIterableElements limit; EC-13 propagates halts
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (elements.length === 0) {
        return [];
      }

      const result: RillValue[] = [];
      // Gate tracks the earliest time the next chunk is allowed through.
      let nextAllowedMs = -Infinity;

      for (let i = 0; i < elements.length; i++) {
        // Static clock: all chunks share timestamp 0 (batch processing, no Date.now()).
        const tChunk = 0;
        if (tChunk >= nextAllowedMs) {
          result.push(elements[i]!);
          nextAllowedMs = tChunk + durationMs;
        }
      }

      return result;
    },
  },

  /**
   * Periodically emit the latest seen chunk at fixed `duration` intervals.
   * Chunks arriving between sample checkpoints update the "latest seen" value;
   * each checkpoint emits that latest value (if any chunk was seen since the
   * last checkpoint or the beginning).
   *
   * Stream-only: rejects list input with #INVALID_INPUT (EC-10).
   * `duration` arg must be a duration value (EC-11).
   * Iteration ceiling enforced via getIterableElements (EC-12).
   * Upstream halt propagates through getIterableElements (EC-13).
   *
   * Per AC-25: sample = latest-at-interval.
   * With a static virtual clock (ctx.nowMs), all chunks fall in the first
   * interval window and the last chunk is emitted as a single sample.
   */
  sample: {
    params: [
      {
        name: 'list',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'dur',
        type: { kind: 'duration' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args, ctx, location) => {
      const input = args['list'] ?? null;
      const durArg = args['dur'] ?? null;

      const site = {
        location,
        sourceId: (ctx as RuntimeContext).sourceId,
        fn: 'sample',
      };

      // EC-10: reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'sample: requires a stream or iterator input, got list'
        );
      }

      // EC-11: duration arg must be a duration value
      if (!isDuration(durArg)) {
        throwCatchableHostHalt(
          site,
          'TYPE_MISMATCH',
          `sample: duration argument must be a duration, got ${inferType(durArg)}`
        );
      }

      // durationMs validated above (EC-11); static-clock semantics make all
      // elements fall in window 0 regardless of duration value.
      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // EC-12 enforced by getIterableElements limit; EC-13 propagates halts
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (elements.length === 0) {
        return [];
      }

      // Assign each element to a time window.
      // Static clock: all chunks share timestamp 0 (batch processing, no Date.now()).
      // With a static clock all elements fall in window 0 → emit last.
      const result: RillValue[] = [];
      // Track latest seen per window index.
      const windowLatest = new Map<number, RillValue>();

      for (let i = 0; i < elements.length; i++) {
        // Static clock: windowIdx is always 0; last element in window wins.
        const windowIdx = 0;
        windowLatest.set(windowIdx, elements[i]!);
      }

      // Emit windows in order: latest value per window.
      const windowIndices = [...windowLatest.keys()].sort((a, b) => a - b);
      for (const idx of windowIndices) {
        result.push(windowLatest.get(idx)!);
      }

      return result;
    },
  },
};

/**
 * Read-only view of the built-in function names.
 * Derived from the keys of the internal {@link BUILTIN_FUNCTIONS} record and
 * frozen at module load so consumers cannot mutate it at runtime.
 */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = Object.freeze(
  Object.keys(BUILTIN_FUNCTIONS)
);

// ============================================================
// BUILT-IN METHODS
// ============================================================

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

BUILTIN_METHODS.string = STRING_METHODS;
BUILTIN_METHODS.list = LIST_METHODS;
BUILTIN_METHODS.dict = DICT_METHODS;
BUILTIN_METHODS.number = NUMBER_METHODS;
BUILTIN_METHODS.bool = BOOL_METHODS;
BUILTIN_METHODS.vector = VECTOR_METHODS;
BUILTIN_METHODS.datetime = DATETIME_METHODS;
BUILTIN_METHODS.duration = DURATION_METHODS;

// Populate registration methods from BUILTIN_METHODS at module load time.
// No circular dependency: type-registrations.ts does not import builtins.ts.
populateBuiltinMethods(BUILTIN_METHODS);

// Built-in functions that are genuinely variadic and must skip arg validation.
// log: tests call log("msg", extraValue) — extra args are silently ignored.
// chain: pipe form sends 1 arg when signature declares 2 (pipeValue is the first).
// iterate: pipe form sends 1 arg when signature declares 2 (pipeValue is the seed).
const UNTYPED_BUILTINS = new Set(['log', 'chain', 'iterate']);

// Register the function table with core at module load time. Core cannot
// import this module (layer rule: core must not depend on ext), so the
// dependency is inverted through the registry.
registerBuiltinFunctions(BUILTIN_FUNCTIONS, UNTYPED_BUILTINS);
