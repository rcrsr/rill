import type { RillFunction } from '../../../core/callable.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import { DURATION_UNITS } from '../../../core/types/duration-units.js';
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
      const nowMs = ctx.nowMs;
      if (nowMs !== undefined) {
        if (!Number.isFinite(nowMs) || !Number.isInteger(nowMs)) {
          throwTypeHalt(
            {
              location,
              sourceId: ctx.sourceId,
              fn: 'now',
            },
            'INVALID_INPUT',
            `now() requires ctx.nowMs to be a finite integer: ${nowMs}`,
            'runtime',
            undefined,
            'host'
          );
        }
        return { __rill_datetime: true, unix: nowMs };
      }
      return {
        __rill_datetime: true,
        unix: Date.now(),
      };
    },
  },

  /**
   * Construct a duration value from printed-form text or named unit parameters.
   * Text such as "1m30s" parses through the unit table; a non-string positional
   * halts at parameter typing. Named values must be non-negative.
   * Fixed units collapse to single ms field; calendar units collapse to months.
   */
  duration: {
    params: [
      {
        name: 'input',
        type: { kind: 'string' },
        defaultValue: null,
        annotations: {},
      },
      ...DURATION_UNITS.map((unit) => ({
        name: unit.name,
        type: { kind: 'any' as const },
        defaultValue: 0,
        annotations: {},
      })),
    ],
    returnType: structureToTypeValue({ kind: 'duration' }),
    fn: (args, _ctx, location) => {
      return constructDuration(args, location);
    },
  },
};
