import type { RillFunction } from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import { structureToTypeValue } from '../../../core/values.js';
import { constructDatetime, constructDuration } from '../temporal/construct.js';

/** Temporal built-in functions: datetime, now, duration. */
export const TEMPORAL_FUNCTIONS: Record<string, RillFunction> = {
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
};
