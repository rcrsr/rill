/**
 * Rill Runtime Tests: Timeout Precision
 *
 * timeout<total: duration(...)> hands the scheduler exactly the requested
 * millisecond count, leaves the body running until the timer fires, and then
 * guard sees RILL-R082. The scheduler is injected, so no real timer runs and
 * the test cannot flake under load.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  type RillFunction,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import { run, toRuntimeContext } from '../helpers/runtime.js';

interface ManualScheduler {
  readonly scheduler: TimeoutScheduler;
  readonly requested: number[];
  fire(): void;
}

/** Scheduler that records requested delays and fires only when told to. */
function makeManualScheduler(): ManualScheduler {
  const requested: number[] = [];
  const callbacks: Array<() => void> = [];
  return {
    requested,
    scheduler: {
      setTimeout: (fn, ms) => {
        requested.push(ms);
        callbacks.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => undefined,
    },
    fire: () => {
      for (const fn of callbacks) fn();
    },
  };
}

/** Host function that stays pending until ctx.signal aborts, then rejects. */
function makeAbortAwareBody(onStart: () => void): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: async (_args, ctx) => {
      onStart();
      await new Promise<void>((_resolve, reject) => {
        const signal = toRuntimeContext(ctx).signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
      return 'done';
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('timeout<total:> scheduling', () => {
  it.each([100, 1, 2500])(
    'schedules exactly %i ms, keeps the body pending, then guard sees RILL-R082',
    async (ms) => {
      const manual = makeManualScheduler();
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let settled = false;

      const pending = run(
        `guard { timeout<total: duration(0, 0, 0, 0, 0, 0, ${ms})> { precision_body() } } => $r\n($r.!code == #RILL_R082)`,
        {
          functions: {
            precision_body: makeAbortAwareBody(() => markStarted()),
          },
          scheduler: manual.scheduler,
        }
      );
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );

      await started;
      await flushMicrotasks();
      expect(manual.requested).toEqual([ms]);
      expect(settled).toBe(false);

      manual.fire();
      const result = await pending;

      expect(result).toBe(true);
    }
  );
});
