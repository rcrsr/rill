import type { RillFunction } from '../../../core/callable.js';
import type { TypeHaltSite } from '../../../core/types/halt.js';
import { internalCallable, isDict } from '../../../core/callable.js';
import {
  throwTypeHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import {
  formatValue,
  serializeValue,
} from '../../../core/types/registrations.js';
import { rejectHeldEntries } from '../../../core/types/held-block.js';
import { anyTypeValue, structureToTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { createChildContext } from '../../../core/context.js';
import { setPipe } from '../../../core/types/declared.js';
import { DEFAULT_MAX_ITERATIONS } from '../../../core/eval/shared.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../../../error-registry.js';
import {
  makeGenericIterator,
  requireFunctionArg,
  requireNonNegativeInteger,
} from '../shared.js';
import { orderedDictEntries } from '../../../core/types/dict-keys.js';

/** Core built-in functions: identity, log, json, enumerate, range, repeat, chain, iterate. */
export const CORE_FUNCTIONS: Record<string, RillFunction> = {
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
    fn: (args, ctx, location) => {
      const value = args['message'] ?? null;
      rejectHeldEntries(
        value,
        'log',
        { location, sourceId: ctx.sourceId, fn: 'log' },
        'deep'
      );
      ctx.callbacks.onLog(formatValue(value));
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
              sourceId: ctx.sourceId,
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
          members: [{ kind: 'list' }, { kind: 'dict' }],
        },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: structureToTypeValue({ kind: 'list' }),
    fn: (args, ctx, location) => {
      const input: RillValue = args['items'] ?? null;
      rejectHeldEntries(
        input,
        'enumerate',
        { location, sourceId: ctx.sourceId, fn: 'enumerate' },
        'direct'
      );
      if (Array.isArray(input)) {
        return input.map((value, index) => ({ index, value }));
      }
      if (isDict(input)) {
        // Canonical key order: string keys sorted by UTF-16 code unit.
        return orderedDictEntries(input).map((e, index) => ({
          index,
          key: e.key,
          value: e.value,
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
    fn: (args, ctx, location) => {
      const start = typeof args['start'] === 'number' ? args['start'] : 0;
      const end = typeof args['stop'] === 'number' ? args['stop'] : 0;
      const step = typeof args['step'] === 'number' ? args['step'] : 1;

      if (step === 0) {
        throwCatchableHostHalt(
          {
            location,
            sourceId: ctx.sourceId,
            fn: 'range',
          },
          'INVALID_INPUT',
          'range step cannot be zero'
        );
      }

      // Carry an integer step index rather than the accumulated float value:
      // start + i * step avoids compounding floating-point drift across steps.
      return makeGenericIterator(0, (i) => {
        const c = start + i * step;
        const done = step > 0 ? c >= end : c <= end;
        if (done) return { done: true };
        return {
          done: false,
          value: c,
          next: i + 1,
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
    fn: (args, ctx, location) => {
      const value = args['value'] ?? '';
      const count = requireNonNegativeInteger(
        typeof args['count'] === 'number' ? args['count'] : 0,
        'repeat',
        'count',
        { location, sourceId: ctx.sourceId, fn: 'repeat' }
      );

      return makeGenericIterator(count, (remaining) => {
        if (remaining <= 0) return { done: true };
        return { done: false, value, next: remaining - 1 };
      });
    },
  },

  /**
   * Pipe a value through one or more functions, left-to-right.
   * chain(value, fn)             -> fn(value)
   * chain(value, [f, g, h])     -> h(g(f(value)))
   * chain(value, [])             -> value unchanged
   * Non-function/non-list second arg throws RILL-R040.
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
      const value: RillValue = args['value'] ?? null;
      const arg: RillValue = args['transform'] ?? null;

      const site: TypeHaltSite = {
        location,
        sourceId: ctx.sourceId,
        fn: 'chain',
        preserveHostShape: true,
      };

      if (Array.isArray(arg)) {
        rejectHeldEntries(arg, 'chain', site, 'direct');
        // List of functions: fold left-to-right
        let result = value;
        for (const item of arg) {
          requireFunctionArg(
            item,
            'chain',
            'list element',
            ERROR_ATOMS[ERROR_IDS.RILL_R040],
            site
          );
          result = await invokeCallable(item, [result], ctx, location);
        }
        return result;
      }

      // Single function: invoke with value
      requireFunctionArg(
        arg,
        'chain',
        'second argument',
        ERROR_ATOMS[ERROR_IDS.RILL_R040],
        site
      );
      return invokeCallable(arg, [value], ctx, location);
    },
  },

  /**
   * Infinite iterator source: emit seed, then repeatedly apply body to
   * produce the next value (which becomes the next seed).
   *
   * Call form:  iterate(seed, body)
   * Pipe form:  $seed -> iterate(body)   (pipe value supplies the seed)
   *
   * The stream is unbounded; bound it externally with take(n), stop_when,
   * or let RILL_R010 enforce the DEFAULT_MAX_ITERATIONS ceiling.
   *
   * Error contracts:
   *   Closure throws catchable halt   → propagates (catchable)
   *   Closure throws non-catchable    → propagates (non-catchable)
   *   Iteration exceeds DEFAULT_MAX_ITERATIONS      → RILL_R010 (non-catchable)
   *   Closure not invocable           → RILL_R006 (catchable)
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
        name: 'body',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args, ctx, location) => {
      const seed: RillValue = args['seed'] ?? null;
      const bodyArg: RillValue = args['body'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'iterate',
      };

      requireFunctionArg(
        bodyArg,
        'iterate',
        'body',
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        site
      );

      const body = bodyArg;
      let stepCount = 0;

      // Build a chunk lazily: emit `current` now, defer body invocation
      // until the consumer pulls .next(). This avoids running the step
      // body (and its side effects) one element ahead of consumption.
      const buildChunk = (current: RillValue): RillValue => {
        return {
          value: current,
          done: false,
          next: internalCallable(async () => {
            stepCount++;
            if (stepCount > DEFAULT_MAX_ITERATIONS) {
              throwFatalHostHalt(
                site,
                ERROR_ATOMS[ERROR_IDS.RILL_R010],
                `iterate: iteration exceeded ${DEFAULT_MAX_ITERATIONS} limit`
              );
            }
            const childCtx = createChildContext(ctx);
            setPipe(childCtx, current, undefined);
            const nextSeed = await invokeCallable(
              body,
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
};
