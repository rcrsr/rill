/**
 * Rill Runtime Tests: Event-loop yielding for CPU-bound scripts
 * A script that never awaits must still let host abort signals, timers,
 * and script-level timeouts fire.
 */

import {
  atomName,
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  resolveAtom,
  RuntimeError,
  RuntimeHaltSignal,
  type RillValue,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from '../helpers/runtime.js';

const R1 = '0 -> while (true) do<limit: 1000000000000> { $ + 1 }';
const R2 =
  'range(0,10000) -> seq({ range(0,10000) -> seq({ range(0,10000) -> fold(0, { $@ + $ }) }) })';
const REPROS: ReadonlyArray<readonly [string, string]> = [
  ['while loop', R1],
  ['nested seq/fold', R2],
];

/** Bounded CPU-bound script that runs well past one yield slice. */
const BOUNDED =
  'range(0,SIZE) -> seq({ range(0,100) -> fold(0, { $@ + $ }) }) -> fold(0, { $@ + $ })';
const BOUNDED_SIZE = 1000;
const BOUNDED_SCRIPT = BOUNDED.replace('SIZE', String(BOUNDED_SIZE));
const BOUNDED_RESULT = 4950 * BOUNDED_SIZE;

const ABORT_MS = 200;
const BOUND_MS = 2000;

/** Asserts the thrown error is a non-catchable #DISPOSED abort halt. */
async function expectAbortHalt(
  exec: () => Promise<unknown>
): Promise<RuntimeHaltSignal> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  const signal = caught as RuntimeHaltSignal;
  expect(signal.catchable).toBe(false);
  expect(atomName(getStatus(signal.value).code)).toBe('DISPOSED');
  return signal;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Rill Runtime: event-loop yielding', () => {
  describe('host abort of CPU-bound scripts', () => {
    it.each(REPROS)(
      'halts %s with #DISPOSED when an AbortController aborts via setTimeout',
      async (_name, source) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ABORT_MS);
        const start = performance.now();
        try {
          await expectAbortHalt(() =>
            run(source, { signal: controller.signal })
          );
        } finally {
          clearTimeout(timer);
        }
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
      }
    );

    it.each(REPROS)(
      'halts %s with #DISPOSED under AbortSignal.timeout',
      async (_name, source) => {
        const start = performance.now();
        await expectAbortHalt(() =>
          run(source, { signal: AbortSignal.timeout(ABORT_MS) })
        );
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
      }
    );

    it.each(REPROS)(
      'lets a 10 ms heartbeat fire at least 5 times during %s',
      async (_name, source) => {
        let beats = 0;
        const heartbeat = setInterval(() => {
          beats += 1;
        }, 10);
        try {
          await expectAbortHalt(() =>
            run(source, { signal: AbortSignal.timeout(300) })
          );
        } finally {
          clearInterval(heartbeat);
        }
        expect(beats).toBeGreaterThanOrEqual(5);
      }
    );

    it('halts a do-while loop with #DISPOSED at the host abort', async () => {
      const start = performance.now();
      await expectAbortHalt(() =>
        run('0 -> do<limit: 1000000000000> { $ + 1 } while (true)', {
          signal: AbortSignal.timeout(ABORT_MS),
        })
      );
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });

    it('halts concurrent repro runs that each carry their own signal', async () => {
      const start = performance.now();
      await Promise.all([
        expectAbortHalt(() =>
          run(R1, { signal: AbortSignal.timeout(ABORT_MS) })
        ),
        expectAbortHalt(() =>
          run(R2, { signal: AbortSignal.timeout(ABORT_MS) })
        ),
      ]);
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });

    it('exhausts a bounded retry limit with a catchable failure when no signal is set', async () => {
      const result = await run('guard { retry<limit: 3> { (1 / 0) } }');
      expect(isInvalid(result)).toBe(true);
    });

    it('halts retry with an unbounded limit and a catchably-halting body', async () => {
      const start = performance.now();
      await expectAbortHalt(() =>
        run('retry<limit: 1000000000000> { (1 / 0) }', {
          signal: AbortSignal.timeout(100),
        })
      );
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });
  });

  describe('script timeout block', () => {
    it.each(REPROS)(
      'guard recovers timeout<total:> expiry in %s with the total-timeout atom',
      async (_name, source) => {
        const start = performance.now();
        const result = await run(
          `guard { timeout<total: duration(0,0,0,0,0,0,200)> { ${source} } }`
        );
        expect(isInvalid(result)).toBe(true);
        expect(getStatus(result).code).toBe(resolveAtom('RILL_R082'));
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
      }
    );

    it.each(REPROS)(
      'rejects catchably with the total-timeout atom, not #DISPOSED, in %s',
      async (_name, source) => {
        let caught: unknown;
        const start = performance.now();
        try {
          await run(`timeout<total: duration(0,0,0,0,0,0,200)> { ${source} }`);
        } catch (e) {
          caught = e;
        }
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
        expect(caught).toBeInstanceOf(RuntimeError);
        expect((caught as RuntimeError).errorId).toBe('RILL-R082');
        // A catchable rejection is a RuntimeError, not a non-catchable abort halt.
        expect(caught).not.toBeInstanceOf(RuntimeHaltSignal);
      }
    );

    it.each(REPROS)(
      'keeps #DISPOSED, uncaught by guard, when the host aborts inside a long timeout block in %s',
      async (_name, source) => {
        const start = performance.now();
        await expectAbortHalt(() =>
          run(
            `guard { timeout<total: duration(0,0,0,0,0,10)> { ${source} } }`,
            {
              signal: AbortSignal.timeout(100),
            }
          )
        );
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
      }
    );

    it.each(REPROS)(
      'keeps #DISPOSED when the host aborts and the timeout timer expires together in %s',
      async (_name, source) => {
        const controller = new AbortController();
        const scheduler: TimeoutScheduler = {
          setTimeout: (fn) => {
            // Expire the timer only after the host signal is aborted.
            return setTimeout(() => {
              controller.abort();
              fn();
            }, 100);
          },
          clearTimeout: (handle) => clearTimeout(handle),
        };
        const start = performance.now();
        await expectAbortHalt(() =>
          run(
            `guard { timeout<total: duration(0,0,0,0,0,0,1000)> { ${source} } }`,
            { signal: controller.signal, scheduler }
          )
        );
        expect(performance.now() - start).toBeLessThan(BOUND_MS);
      }
    );

    it('recovers the inner timeout when nested timeout blocks expire in order', async () => {
      const start = performance.now();
      const result = await run(
        `guard { timeout<total: duration(0,0,0,0,0,5)> { timeout<total: duration(0,0,0,0,0,0,100)> { ${R1} } } }`
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('RILL_R082'));
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });

    it('halts a retry inside a timeout block with the total-timeout atom', async () => {
      const start = performance.now();
      const result = await run(
        `guard { timeout<total: duration(0,0,0,0,0,0,150)> { retry<limit: 1000000000000> { (1 / 0) } } }`
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('RILL_R082'));
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });
  });

  describe('timeout option', () => {
    it('rejects R2 with RILL-R012 within the bound', async () => {
      const controller = new AbortController();
      const start = performance.now();
      let caught: unknown;
      try {
        await run(R2, { timeout: ABORT_MS, signal: controller.signal });
      } catch (e) {
        caught = e;
      } finally {
        // Stop the abandoned work.
        controller.abort();
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R012');
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });

    it('does not cover script loops: R1 halts #DISPOSED at the host abort', async () => {
      const start = performance.now();
      await expectAbortHalt(() =>
        run(R1, { timeout: ABORT_MS, signal: AbortSignal.timeout(500) })
      );
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });
  });

  describe('results are unchanged', () => {
    it('folds a 10000-element range to its sum', async () => {
      expect(await run('range(0, 10000) -> fold(0, { $@ + $ })')).toBe(
        49995000
      );
    });

    it('returns a known constant from a bounded nested seq running past 10 ms', async () => {
      const result = await run(BOUNDED_SCRIPT);
      expect(result).toBe(BOUNDED_RESULT);
    });

    it('returns ordered results from a 1000-wide fan', async () => {
      const result = (await run(
        'range(0, 1000) -> fan({ $ * 2 })'
      )) as RillValue[];
      expect(result).toEqual(Array.from({ length: 1000 }, (_, i) => i * 2));
    });
  });

  describe('slow path', () => {
    it('lets a setImmediate flag queued before a bounded run fire before execute resolves', async () => {
      await new Promise((r) => setImmediate(r));
      let flag = false;
      setImmediate(() => {
        flag = true;
      });
      await run(BOUNDED_SCRIPT);
      expect(flag).toBe(true);
    });
  });

  describe('fast path', () => {
    const SHORT = 'range(0, 100) -> fold(0, { $@ + $ })';

    // The liveness state is module-global, so each test loads a fresh module.
    async function runFresh(): Promise<void> {
      vi.resetModules();
      const fresh = await import('@rcrsr/rill');
      await fresh.execute(fresh.parse(SHORT), fresh.createRuntimeContext());
    }

    it('leaves a queued setImmediate flag unset when a short execute resolves', async () => {
      await new Promise((r) => setImmediate(r));
      let flag = false;
      setImmediate(() => {
        flag = true;
      });
      await runFresh();
      expect(flag).toBe(false);
      await new Promise((r) => setImmediate(r));
    });

    it('stays on the fast path after the loop has idled for 50 ms', async () => {
      await runFresh();
      await new Promise((r) => setTimeout(r, 50));
      let flag = false;
      setImmediate(() => {
        flag = true;
      });
      await runFresh();
      expect(flag).toBe(false);
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('fake timers', () => {
    it('completes a CPU-bound script without advancing timers', async () => {
      vi.useFakeTimers();
      expect(await run(BOUNDED_SCRIPT)).toBe(BOUNDED_RESULT);
    });

    it('completes with a fixed nowMs and a scheduler that never fires', async () => {
      vi.useFakeTimers();
      const scheduler: TimeoutScheduler = {
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => undefined,
      };
      expect(await run(BOUNDED_SCRIPT, { nowMs: 0, scheduler })).toBe(
        BOUNDED_RESULT
      );
    });
  });

  describe('state after abort', () => {
    it('returns call depth and in-flight counters to zero', async () => {
      const ctx = createRuntimeContext({
        signal: AbortSignal.timeout(ABORT_MS),
      });
      await expectAbortHalt(() => execute(parse(R2), ctx));
      expect(ctx.callsInFlight.value).toBe(0);
      expect(ctx.callDepth.value).toBe(0);
    });
  });

  describe('abort during fan', () => {
    it('returns call depth and in-flight counters to zero', async () => {
      const ctx = createRuntimeContext({
        signal: AbortSignal.timeout(ABORT_MS),
      });
      await expectAbortHalt(() =>
        execute(
          parse(
            'range(0, 8) -> fan({ 0 -> while (true) do<limit: 1000000000000> { $ + 1 } })'
          ),
          ctx
        )
      );
      // Sibling branches unwind on their next abort check, after fan rejects.
      await vi.waitFor(() => expect(ctx.callsInFlight.value).toBe(0));
      expect(ctx.callDepth.value).toBe(0);
    });
  });

  describe('portability', () => {
    it('yields through setTimeout(0) when setImmediate is unavailable', async () => {
      vi.stubGlobal('setImmediate', undefined);
      vi.resetModules();
      const fresh = await import('@rcrsr/rill');
      const ctx = fresh.createRuntimeContext({
        signal: AbortSignal.timeout(ABORT_MS),
      });
      const start = performance.now();
      let caught: unknown;
      try {
        await fresh.execute(fresh.parse(R1), ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(fresh.RuntimeHaltSignal);
      const signal = caught as RuntimeHaltSignal;
      expect(signal.catchable).toBe(false);
      expect(fresh.atomName(fresh.getStatus(signal.value).code)).toBe(
        'DISPOSED'
      );
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
    });

    it('completes a bounded script when no macrotask primitive exists', async () => {
      vi.stubGlobal('setImmediate', undefined);
      vi.stubGlobal('setTimeout', undefined);
      vi.resetModules();
      const fresh = await import('@rcrsr/rill');
      vi.unstubAllGlobals();
      const result = await fresh.execute(
        fresh.parse(BOUNDED_SCRIPT),
        fresh.createRuntimeContext()
      );
      expect(result.result).toBe(BOUNDED_RESULT);
    });
  });
});
