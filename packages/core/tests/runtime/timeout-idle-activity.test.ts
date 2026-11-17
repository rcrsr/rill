/**
 * Rill Runtime Tests: timeout<idle:> activity
 *
 * An idle limit restarts on activity: a stream chunk arriving in the body or
 * a host function call returning. Activity restarts the idle timer of every
 * enclosing timeout. A body with neither counts as idle. The scheduler is a
 * virtual clock injected into the runtime, so host "work" and the timeout
 * timers share one deterministic timeline and no real time passes.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  toCallable,
  type RillFunction,
  type RillValue,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

interface VirtualClock {
  readonly scheduler: TimeoutScheduler;
  sleep(ms: number): Promise<void>;
  /** Fire timers in time order until `pending` settles. */
  drive<T>(pending: Promise<T>): Promise<T>;
}

function makeVirtualClock(): VirtualClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  const scheduler: TimeoutScheduler = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as unknown as number);
    },
  };

  async function settleMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  }

  return {
    scheduler,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        scheduler.setTimeout(resolve, ms);
      }),
    drive: async (pending) => {
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      for (let guard = 0; guard < 1000; guard++) {
        await settleMicrotasks();
        if (settled) break;
        let earliest: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) {
          if (earliest === undefined || entry[1].at < earliest[1].at) {
            earliest = entry;
          }
        }
        if (earliest === undefined) break;
        timers.delete(earliest[0]);
        now = earliest[1].at;
        earliest[1].fn();
      }
      return pending;
    },
  };
}

/** Host function that returns after `ms` of virtual time. */
function sleepFn(clock: VirtualClock): RillFunction {
  return {
    params: [
      {
        name: 'ms',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: async (args) => {
      await clock.sleep(Number(args['ms']));
      return 'ok';
    },
  };
}

/** Host function returning a stream that yields `count` chunks `gapMs` apart. */
function streamFn(clock: VirtualClock): RillFunction {
  return {
    params: [
      {
        name: 'count',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'gap_ms',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: anyTypeValue,
    fn: (args) => {
      const count = Number(args['count']);
      const gapMs = Number(args['gap_ms']);
      async function* chunks(): AsyncGenerator<RillValue> {
        for (let i = 0; i < count; i++) {
          await clock.sleep(gapMs);
          yield i;
        }
      }
      return createRillStream({
        chunks: chunks(),
        resolve: () => Promise.resolve('done'),
      });
    },
  };
}

function runScript(script: string): Promise<RillValue> {
  const clock = makeVirtualClock();
  const pending = run(script, {
    functions: { work: sleepFn(clock), ticks: streamFn(clock) },
    scheduler: clock.scheduler,
  });
  return clock.drive(pending);
}

describe('timeout<idle:> activity', () => {
  it('completes when each host call returns inside the idle window', async () => {
    const result = await runScript(`
      timeout<idle: duration("50ms")> {
        work(30)
        work(30)
        work(30)
        "finished"
      }
    `);
    expect(result).toBe('finished');
  });

  it('halts #RILL_R083 when a single host call outlasts the idle window', async () => {
    const result = await runScript(`
      guard { timeout<idle: duration("50ms")> { work(80) } } => $r
      ($r.!code == #RILL_R083)
    `);
    expect(result).toBe(true);
  });

  it('completes when stream chunks arrive inside the idle window', async () => {
    const result = await runScript(`
      timeout<idle: duration("50ms")> {
        ticks(5, 30) -> seq({ $ }) -> .len
      }
    `);
    expect(result).toBe(5);
  });

  it('halts #RILL_R083 when a stream gap outlasts the idle window', async () => {
    const result = await runScript(`
      guard { timeout<idle: duration("50ms")> { ticks(3, 80) -> seq({ $ }) } } => $r
      ($r.!code == #RILL_R083)
    `);
    expect(result).toBe(true);
  });

  it('restarts an enclosing idle limit from activity in a nested timeout', async () => {
    const result = await runScript(`
      timeout<idle: duration("50ms")> {
        timeout<total: duration("1s")> {
          work(30)
          work(30)
          work(30)
          "nested"
        }
      }
    `);
    expect(result).toBe('nested');
  });

  it('halts #RILL_R082 on total regardless of activity', async () => {
    const result = await runScript(`
      guard {
        timeout<total: duration("100ms"), idle: duration("50ms")> {
          work(30)
          work(30)
          work(30)
          work(30)
          "unreachable"
        }
      } => $r
      ($r.!code == #RILL_R082)
    `);
    expect(result).toBe(true);
  });

  it('does not restart a timer from a host return in a sibling fan branch', async () => {
    const result = await runScript(`
      list[1, 2] -> fan({
        ($ == 1) ? guard { timeout<idle: duration("50ms")> { work(80) } } ! work(30)
      }) => $r
      ($r[0].!code == #RILL_R083)
    `);
    expect(result).toBe(true);
  });

  it('counts a call on an extension value as activity', async () => {
    const clock = makeVirtualClock();
    const hostFn = sleepFn(clock);
    const pending = run(
      `
      use<ext:g> => $g
      timeout<idle: duration("50ms")> {
        $g.f(30)
        $g.f(30)
        $g.f(30)
        "finished"
      }
    `,
      {
        resolvers: {
          ext: () => ({ kind: 'value', value: { f: toCallable(hostFn) } }),
        },
        scheduler: clock.scheduler,
      }
    );
    expect(await clock.drive(pending)).toBe('finished');
  });

  it('does not count a host call that throws as activity', async () => {
    const clock = makeVirtualClock();
    const failing: RillFunction = {
      params: [],
      returnType: anyTypeValue,
      fn: async () => {
        await clock.sleep(30);
        throw new Error('boom');
      },
    };
    const pending = run(
      `
      guard { timeout<idle: duration("50ms")> { guard { failing() } => $a
        work(30)
      } } => $r
      ($r.!code == #RILL_R083)
    `,
      {
        functions: { failing, work: sleepFn(clock) },
        scheduler: clock.scheduler,
      }
    );
    expect(await clock.drive(pending)).toBe(true);
  });
});
