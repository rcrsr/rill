import type { RillFunction } from '../../../core/callable.js';
import { callable, isCallable, isDict } from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import { RuntimeError } from '../../../../types.js';
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
import { ERROR_IDS } from '../../../../error-registry.js';
import { MAX_ITER, makeGenericIterator } from '../shared.js';
import { typedKeyEntries } from '../../../core/types/dict-keys.js';

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
        const stringEntries = keys.map((key) => ({
          key: key as RillValue,
          value: input[key]!,
        }));
        // Number/boolean keys follow the sorted string keys, in insertion order.
        const typedEntries = typedKeyEntries(input).map((e) => ({
          key: e.key as RillValue,
          value: e.value,
        }));
        return [...stringEntries, ...typedEntries].map((e, index) => ({
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
   *   Closure throws catchable halt   → propagates (catchable)
   *   Closure throws non-catchable    → propagates (non-catchable)
   *   Iteration exceeds MAX_ITER      → RILL_R010 (non-catchable)
   *   Closure missing/not invocable   → RILL_R006 (catchable)
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
};
