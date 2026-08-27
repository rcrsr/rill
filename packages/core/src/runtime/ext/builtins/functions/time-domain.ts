import type { RillFunction } from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import { throwCatchableHostHalt } from '../../../core/types/halt.js';
import type {
  RillDuration,
  RillValue,
} from '../../../core/types/structures.js';
import { inferType } from '../../../core/types/registrations.js';
import { isDuration } from '../../../core/types/guards.js';
import { anyTypeValue } from '../../../core/values.js';
import { getIterableElements } from '../../../core/eval/handlers/collections.js';

/** Time-domain built-in functions: debounce, throttle, sample. */
export const TIME_DOMAIN_FUNCTIONS: Record<string, RillFunction> = {
  /**
   * Suppress rapid stream emissions; emit the latest chunk after `duration`
   * of silence since the last observed chunk.
   *
   * Stream-only: rejects list input with #INVALID_INPUT.
   * `duration` arg must be a duration value.
   * Iteration ceiling enforced via getIterableElements.
   * Upstream halt propagates through getIterableElements.
   *
   * Semantics: of all observed chunks, emit only those not followed by
   * another chunk within `duration.ms`. With all chunks at the same virtual
   * timestamp (deterministic clock), only the last chunk passes.
   *
   * debounce = emit latest after silence.
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

      // reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'debounce: requires a stream or iterator input, got list'
        );
      }

      // duration arg must be a duration value
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

      // Iteration cap enforced by the getIterableElements limit; halts propagate
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
   * Stream-only: rejects list input with #INVALID_INPUT.
   * `duration` arg must be a duration value.
   * Iteration ceiling enforced via getIterableElements.
   * Upstream halt propagates through getIterableElements.
   *
   * throttle = first-of-interval.
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

      // reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'throttle: requires a stream or iterator input, got list'
        );
      }

      // duration arg must be a duration value
      if (!isDuration(durArg)) {
        throwCatchableHostHalt(
          site,
          'TYPE_MISMATCH',
          `throttle: duration argument must be a duration, got ${inferType(durArg)}`
        );
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // Iteration cap enforced by the getIterableElements limit; halts propagate
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (elements.length === 0) {
        return [];
      }

      // Static clock: all chunks share timestamp 0 (batch processing, no
      // Date.now()), so only the first chunk ever falls within the interval
      // gate; every later chunk arrives at the same instant and is
      // suppressed. Emit the first element.
      return [elements[0]!];
    },
  },

  /**
   * Emit the latest seen chunk at fixed `duration` intervals.
   *
   * Stream-only: rejects list input with #INVALID_INPUT.
   * `duration` arg must be a duration value.
   * Iteration ceiling enforced via getIterableElements.
   * Upstream halt propagates through getIterableElements.
   *
   * sample = latest-at-interval. Under batch (synchronous) semantics all
   * chunks arrive at once, so the last chunk is emitted as the single sample.
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

      // reject list input
      if (Array.isArray(input)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          'sample: requires a stream or iterator input, got list'
        );
      }

      // duration arg must be a duration value
      if (!isDuration(durArg)) {
        throwCatchableHostHalt(
          site,
          'TYPE_MISMATCH',
          `sample: duration argument must be a duration, got ${inferType(durArg)}`
        );
      }

      const node = {
        span: { start: location ?? { line: 0, column: 0, offset: 0 } },
      };

      // Iteration cap enforced by the getIterableElements limit; halts propagate
      const elements = await getIterableElements(
        input,
        ctx as RuntimeContext,
        node
      );

      if (elements.length === 0) {
        return [];
      }

      // Static clock: all chunks share timestamp 0 (batch processing, no
      // Date.now()), so every element falls into the same interval window
      // and the latest-seen value at that checkpoint is the last element.
      return [elements[elements.length - 1]!];
    },
  },
};
