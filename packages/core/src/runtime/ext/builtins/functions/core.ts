import type { RillFunction } from '../../../core/callable.js';
import { callable, isCallable, isDict } from '../../../core/callable.js';
import {
  throwTypeHalt,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import {
  formatValue,
  inferType,
  serializeValue,
} from '../../../core/types/registrations.js';
import { anyTypeValue, structureToTypeValue } from '../../../core/values.js';
import { invokeCallable } from '../../../core/eval/index.js';
import { createChildContext } from '../../../core/context.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../../../error-registry.js';
import { MAX_ITER, makeGenericIterator } from '../shared.js';
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
      {
        name: 'extra',
        type: { kind: 'any' },
        defaultValue: '',
        annotations: {
          description: 'Accepted and ignored; log formats only message',
        },
      },
    ],
    returnType: anyTypeValue,
    fn: (args, ctx) => {
      const value = args['message'] ?? null;
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
    fn: (args) => {
      const input: RillValue = args['items'] ?? null;
      if (Array.isArray(input)) {
        return input.map((value, index) => ({ index, value }));
      }
      if (isDict(input)) {
        // Canonical key order: sorted string keys, then number keys
        // ascending, then boolean keys (false before true).
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
        throwFatalHostHalt(
          {
            location,
            sourceId: ctx.sourceId,
            fn: 'range',
            preserveHostShape: true,
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R001],
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
      const count =
        typeof args['count'] === 'number' ? Math.floor(args['count']) : 0;

      if (count < 0) {
        throwFatalHostHalt(
          {
            location,
            sourceId: ctx.sourceId,
            fn: 'repeat',
            preserveHostShape: true,
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R001],
          'repeat count cannot be negative'
        );
      }

      return makeGenericIterator(count, (remaining) => {
        if (remaining <= 0) return { done: true };
        return { done: false, value, next: remaining - 1 };
      });
    },
  },

  /**
   * Pipe a value through one or more closures, left-to-right.
   * chain(value, closure)        -> closure(value)
   * chain(value, [f, g, h])     -> h(g(f(value)))
   * chain(value, [])             -> value unchanged
   * Non-closure/non-list second arg throws RILL-R040.
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
      const argTypeName = inferType(arg);

      if (Array.isArray(arg)) {
        // List of closures: fold left-to-right
        let result = value;
        for (const item of arg) {
          if (!isCallable(item)) {
            throwFatalHostHalt(
              {
                location,
                sourceId: ctx.sourceId,
                fn: 'chain',
                preserveHostShape: true,
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R040],
              `chain: list element must be a closure, got ${inferType(item)}`
            );
          }
          result = await invokeCallable(item, [result], ctx, location);
        }
        return result;
      }

      if (isCallable(arg)) {
        // Single closure: invoke with value
        return invokeCallable(arg, [value], ctx, location);
      }

      return throwFatalHostHalt(
        {
          location,
          sourceId: ctx.sourceId,
          fn: 'chain',
          preserveHostShape: true,
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R040],
        `chain: second argument must be a closure or list of closures, got ${argTypeName}`
      );
    },
  },

  /**
   * Infinite iterator source: emit seed, then repeatedly apply closure to
   * produce the next value (which becomes the next seed).
   *
   * Call form:  iterate(seed, closure)
   * Pipe form:  $seed -> iterate(closure)   (pipe value supplies the seed)
   *
   * The stream is unbounded; bound it externally with take(n), stop_when,
   * or let RILL_R010 enforce the MAX_ITER ceiling.
   *
   * Error contracts:
   *   Closure throws catchable halt   → propagates (catchable)
   *   Closure throws non-catchable    → propagates (non-catchable)
   *   Iteration exceeds MAX_ITER      → RILL_R010 (non-catchable)
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
        name: 'closure',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args, ctx, location) => {
      const seed: RillValue = args['seed'] ?? null;
      const closureArg: RillValue = args['closure'] ?? null;

      const site = {
        location,
        sourceId: ctx.sourceId,
        fn: 'iterate',
      };

      if (!isCallable(closureArg)) {
        throwCatchableHostHalt(
          site,
          ERROR_ATOMS[ERROR_IDS.RILL_R006],
          `iterate: closure must be a callable, got ${inferType(closureArg)}`
        );
      }

      const closure = closureArg;
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
                ERROR_ATOMS[ERROR_IDS.RILL_R010],
                `iterate: iteration exceeded ${MAX_ITER} limit`
              );
            }
            const childCtx = createChildContext(ctx);
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
};
