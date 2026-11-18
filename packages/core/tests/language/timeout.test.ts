/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: timeout<> Block (Phase 1, Task 1.5)
 *
 * Covers:
 * - AC-1  / SC-1  : timeout<total:> completes within window; body result returned
 * - AC-12 / EC-1  : timeout<total:> fires #TIMEOUT_TOTAL when body runs too long
 * - both total: and idle: accepted in either order; duplicate key is a parse error
 * - AC-15 / EC-2  : timeout<idle:> fires #TIMEOUT_IDLE when body takes too long
 * - EC-3          : non-duration argument to timeout<total:> halts with INVALID_INPUT
 * - EC-5          : iteration ceiling (RILL-R010) propagates through timeout body
 * - AC-20 / BC-3  : nested timeouts fire outer first
 * - AC-22 / BC-5  : timeout<total:> caught via guard + ?? fallback
 * - AC-23 / BC-6  : timeout<idle:> caught via guard + type inspection
 *
 * All tests use the printed form duration("Xms") to specify X milliseconds.
 *
 * [DEVIATION] The timeout<> evaluator only interrupts host functions that observe
 * ctx.signal. Host functions that do not check signal will complete normally even
 * after the timeout fires. All time-sensitive tests use signal-aware host fns.
 *
 * [DEVIATION] AC-22 / BC-5: `timeout<total: ...> { ... } ?? "fallback"` does not
 * resolve to the fallback — the catchable RuntimeHaltSignal thrown by the timeout
 * propagates through the ?? operator (which only intercepts RILL_R007/R008). The
 * correct pattern is `guard { timeout<total: ...> { ... } } ?? "fallback"`.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  parse,
  type RillValue,
  type CallableFn,
  type RillFunction,
  type RuntimeContext,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

// ---------------------------------------------------------------------------
// Signal-aware host function helpers
// ---------------------------------------------------------------------------

/**
 * Build a signal-aware host function that never settles on its own: it
 * rejects only when `ctx.signal` aborts. A timeout test therefore cannot
 * pass unless the timeout fires, and no host timer races the deadline.
 */
type CallableCtx = Parameters<CallableFn>[1];

function makeSlowFn() {
  return {
    params: [] as never,
    returnType: { __type: 'any' } as never,
    fn: async (_args: Record<string, unknown>, ctx: CallableCtx) => {
      await new Promise<void>((_resolve, reject) => {
        const signal = (ctx as RuntimeContext).signal;
        if (!signal || signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
      return 'done';
    },
  };
}

// ---------------------------------------------------------------------------
// AC-1 / SC-1: body completes before timeout fires
// ---------------------------------------------------------------------------

describe('AC-1 / SC-1: timeout<total:> completes within window', () => {
  it('returns body result when body finishes before deadline', async () => {
    // duration("200ms") = 200ms
    const result = await run('timeout<total: duration("200ms")> { 1 }');
    expect(result).toBe(1);
  });

  it('returns captured variable from body', async () => {
    const result = await run(`
      timeout<total: duration("200ms")> {
        42 => $x
        $x
      }
    `);
    expect(result).toBe(42);
  });

  it('returns string result from body', async () => {
    const result = await run('timeout<total: duration("200ms")> { "hello" }');
    expect(result).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// AC-12 / EC-1: #TIMEOUT_TOTAL fires when body runs too long
// ---------------------------------------------------------------------------

describe('AC-12 / EC-1: timeout<total:> fires #TIMEOUT_TOTAL', () => {
  it('produces #TIMEOUT_TOTAL when body uses signal-aware host delay', async () => {
    // Guard catches the catchable TIMEOUT_TOTAL halt and returns the invalid value.
    const result = await run(
      'guard { timeout<total: duration("50ms")> { slow_op() } }',
      { functions: { slow_op: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R082'));
  });

  it('#TIMEOUT_TOTAL atom code matches expected resolveAtom value', async () => {
    const result = await run(
      'guard { timeout<total: duration("50ms")> { slow_fn() } }',
      { functions: { slow_fn: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    const code = getStatus(result as never).code;
    // resolveAtom('RILL_R082') returns the registered atom for RILL_R082
    expect(code).toEqual(resolveAtom('RILL_R082'));
  });
});

// ---------------------------------------------------------------------------
// Both limits, empty options, and option errors
// ---------------------------------------------------------------------------

describe('timeout<total: d, idle: d> arms both limits', () => {
  const { it: ruleIt } = rule('construct-options.timeout-limits');

  ruleIt('accepts total then idle and returns the body result', async () => {
    const result = await run(
      'timeout<total: duration("200ms"), idle: duration("200ms")> { 1 }'
    );
    expect(result).toBe(1);
  });

  ruleIt('accepts idle then total and returns the body result', async () => {
    const result = await run(
      'timeout<idle: duration("200ms"), total: duration("200ms")> { 2 }'
    );
    expect(result).toBe(2);
  });

  ruleIt('halts #RILL_R083 when idle is the shorter limit', async () => {
    const result = await run(
      'guard { timeout<total: duration("5000ms"), idle: duration("50ms")> { slow_op() } }',
      { functions: { slow_op: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R083'));
  });

  ruleIt('halts #RILL_R082 when total is the shorter limit', async () => {
    const result = await run(
      'guard { timeout<idle: duration("5000ms"), total: duration("50ms")> { slow_op() } }',
      { functions: { slow_op: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R082'));
  });

  ruleIt('returns the body result for timeout<> with no limit', async () => {
    const result = await run('timeout<> { 7 }');
    expect(result).toBe(7);
  });

  it('rejects a duplicate key with RILL-P004', () => {
    expect(() =>
      parse('timeout<total: duration("1ms"), total: duration("2ms")> { 1 }')
    ).toThrow(expect.objectContaining({ errorId: 'RILL-P004' }));
  });

  it('rejects an unknown key with RILL-P004', () => {
    expect(() => parse('timeout<limit: duration("1ms")> { 1 }')).toThrow(
      expect.objectContaining({ errorId: 'RILL-P004' })
    );
  });

  it('halts #INVALID_INPUT naming the option for a non-duration idle value', async () => {
    await expectHalt(() => run('timeout<idle: "x"> { 1 }'), {
      code: 'INVALID_INPUT',
      messagePattern: /idle/,
    });
  });
});

// ---------------------------------------------------------------------------
// AC-15 / EC-2: #TIMEOUT_IDLE fires when body is inactive too long
// ---------------------------------------------------------------------------

describe('timeout<idle:> restarts on activity', () => {
  const { it: ruleIt } = rule('construct-options.timeout-idle-activity');

  /** Scheduler that records each requested delay; it never fires. */
  function makeRecordingScheduler(): {
    scheduler: TimeoutScheduler;
    requested: number[];
  } {
    const requested: number[] = [];
    return {
      requested,
      scheduler: {
        setTimeout: (_fn, ms) => {
          requested.push(ms);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: () => {},
      },
    };
  }

  const returnsAtOnce: RillFunction = {
    params: [],
    returnType: anyTypeValue,
    fn: () => 'ok',
  };

  ruleIt('re-arms the idle timer each time a host call returns', async () => {
    const recording = makeRecordingScheduler();
    const result = await run(
      'timeout<idle: duration("50ms")> { quick()\nquick()\nquick() }',
      { functions: { quick: returnsAtOnce }, scheduler: recording.scheduler }
    );
    expect(result).toBe('ok');
    expect(recording.requested).toEqual([50, 50, 50, 50]);
  });

  ruleIt('does not re-arm the idle timer for pure computation', async () => {
    const recording = makeRecordingScheduler();
    const result = await run(
      'timeout<idle: duration("50ms")> { (1 + 2) * 3 }',
      { scheduler: recording.scheduler }
    );
    expect(result).toBe(9);
    expect(recording.requested).toEqual([50]);
  });

  ruleIt('re-arms every enclosing idle timer from a nested body', async () => {
    const recording = makeRecordingScheduler();
    await run(
      'timeout<idle: duration("50ms")> { timeout<idle: duration("70ms")> { quick() } }',
      { functions: { quick: returnsAtOnce }, scheduler: recording.scheduler }
    );
    expect(recording.requested).toEqual([50, 70, 50, 70]);
  });

  // -------------------------------------------------------------------------
  // Virtual clock: host work and timeout timers share one deterministic
  // timeline, so no real time passes.
  // -------------------------------------------------------------------------

  interface VirtualClock {
    readonly scheduler: TimeoutScheduler;
    sleep(ms: number): Promise<void>;
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
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      }
    };
    return {
      scheduler,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          scheduler.setTimeout(resolve, ms);
        }),
      drive: async (pending) => {
        let settled = false;
        const mark = (): void => {
          settled = true;
        };
        void pending.then(mark, mark);
        for (let guard = 0; guard < 1000; guard++) {
          await settle();
          if (settled) break;
          let earliest: [number, { at: number; fn: () => void }] | undefined;
          for (const entry of timers) {
            if (earliest === undefined || entry[1].at < earliest[1].at) {
              earliest = entry;
            }
          }
          if (earliest === undefined) {
            throw new Error(
              `virtual clock stalled at ${now}ms: no timers remain and the script has not settled`
            );
          }
          timers.delete(earliest[0]);
          now = earliest[1].at;
          earliest[1].fn();
        }
        if (!settled) {
          throw new Error(
            `virtual clock stalled at ${now}ms: the script did not settle after 1000 timer steps`
          );
        }
        return pending;
      },
    };
  }

  function msParam(name: string): RillFunction['params'][number] {
    return {
      name,
      type: { kind: 'number' },
      defaultValue: undefined,
      annotations: {},
    };
  }

  function runVirtual(
    script: string,
    build: (clock: VirtualClock) => Record<string, RillFunction>
  ): Promise<RillValue> {
    const clock = makeVirtualClock();
    return clock.drive(
      run(script, { functions: build(clock), scheduler: clock.scheduler })
    );
  }

  const workFn = (clock: VirtualClock): RillFunction => ({
    params: [msParam('ms')],
    returnType: anyTypeValue,
    fn: async (args) => {
      await clock.sleep(Number(args['ms']));
      return 'ok';
    },
  });

  const ticksFn = (clock: VirtualClock): RillFunction => ({
    params: [msParam('count'), msParam('gap_ms')],
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
  });

  ruleIt(
    'restarts the idle timer when stream chunks arrive in time',
    async () => {
      const result = await runVirtual(
        'timeout<idle: duration("50ms")> { ticks(5, 30) -> seq({ $ }) -> .len }',
        (clock) => ({ ticks: ticksFn(clock) })
      );
      expect(result).toBe(5);
    }
  );

  ruleIt(
    'halts #RILL_R083 when a stream gap outlasts the idle window',
    async () => {
      const result = await runVirtual(
        `
      guard { timeout<idle: duration("50ms")> { ticks(3, 80) -> seq({ $ }) } } => $r
      ($r.!code == #RILL_R083)
    `,
        (clock) => ({ ticks: ticksFn(clock) })
      );
      expect(result).toBe(true);
    }
  );

  ruleIt('does not count a host call that halts as activity', async () => {
    const result = await runVirtual(
      `
      guard { timeout<idle: duration("50ms")> { guard { failing() } => $a
        work(30)
      } } => $r
      ($r.!code == #RILL_R083)
    `,
      (clock) => ({
        work: workFn(clock),
        failing: {
          params: [],
          returnType: anyTypeValue,
          fn: async () => {
            await clock.sleep(30);
            throw new Error('boom');
          },
        },
      })
    );
    expect(result).toBe(true);
  });

  ruleIt('does not restart the limit from a sibling fan branch', async () => {
    const result = await runVirtual(
      `
      list[1, 2] -> fan({
        ($ == 1) ? guard { timeout<idle: duration("50ms")> { work(100) } } ! work(30)
      }) => $r
      ($r[0].!code == #RILL_R083)
    `,
      (clock) => ({ work: workFn(clock) })
    );
    expect(result).toBe(true);
  });
});

describe('timeout limits need a fixed-length duration', () => {
  const { it: ruleIt } = rule('construct-options.timeout-fixed-duration');

  ruleIt('halts #INVALID_INPUT for a total with a months part', async () => {
    await expectHalt(() => run('timeout<total: duration("1mo")> { 1 }'), {
      code: 'INVALID_INPUT',
      messagePattern: /total/,
    });
  });

  ruleIt('halts #INVALID_INPUT for an idle with a years part', async () => {
    await expectHalt(() => run('timeout<idle: duration("1y")> { 1 }'), {
      code: 'INVALID_INPUT',
      messagePattern: /idle/,
    });
  });
});

describe('timeout limits have a ceiling', () => {
  const { it: ruleIt } = rule('construct-options.timeout-ceiling');

  ruleIt('halts #INVALID_INPUT for a total above the ceiling', async () => {
    await expectHalt(
      () => run('timeout<total: duration("2147483648ms")> { 1 }'),
      { code: 'INVALID_INPUT', messagePattern: /total/ }
    );
  });

  ruleIt('halts #INVALID_INPUT for an idle above the ceiling', async () => {
    await expectHalt(
      () => run('timeout<idle: duration("2147483648ms")> { 1 }'),
      { code: 'INVALID_INPUT', messagePattern: /idle/ }
    );
  });

  ruleIt('accepts a total at the ceiling', async () => {
    expect(await run('timeout<total: duration("2147483647ms")> { 1 }')).toBe(1);
  });
});

describe('AC-15 / EC-2: timeout<idle:> fires #TIMEOUT_IDLE', () => {
  it('produces #TIMEOUT_IDLE when body does not complete within idle window', async () => {
    // A host call that never returns is a body with no activity, so the idle
    // timer is never restarted and fires. A signal-aware host function
    // aborts when the idle timer fires.
    const result = await run(
      'guard { timeout<idle: duration("50ms")> { idle_slow() } }',
      { functions: { idle_slow: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R083'));
  });

  it('timeout<idle:> is catchable — guard catches #TIMEOUT_IDLE', async () => {
    // Same as above; verifies the guard path explicitly.
    const result = await run(
      'guard { timeout<idle: duration("50ms")> { idle_slow() } }',
      { functions: { idle_slow: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R083'));
  });
});

// ---------------------------------------------------------------------------
// EC-3: non-duration argument halts with INVALID_INPUT
// ---------------------------------------------------------------------------

describe('EC-3: non-duration arg to timeout<> halts with INVALID_INPUT', () => {
  it('string duration arg throws a catchable RuntimeHaltSignal with INVALID_INPUT', async () => {
    // The parser accepts a string literal as the duration expression;
    // the runtime rejects it at evaluation time via isDuration() check.
    // The catchable halt escapes run() as a rejected promise.
    await expectHalt(() => run('timeout<total: "100ms"> { "x" }'), {
      code: 'INVALID_INPUT',
    });
  });

  it('numeric duration arg throws a catchable halt', async () => {
    // The parser accepts a numeric literal; the runtime rejects it at evaluation.
    await expectHalt(() => run('timeout<total: 100> { "x" }'), {
      code: 'INVALID_INPUT',
    });
  });

  it('INVALID_INPUT halt is catchable — guard recovers it', async () => {
    // Guard catches the INVALID_INPUT halt and returns the invalid value.
    // The ?? operator then replaces the invalid value with the fallback.
    const result = await run(
      'guard { timeout<total: "bad"> { "x" } } ?? "recovered"'
    );
    expect(result).toBe('recovered');
  });
});

// ---------------------------------------------------------------------------
// EC-5: RILL-R010 iteration ceiling propagates through timeout body
// ---------------------------------------------------------------------------

describe('EC-5: iteration ceiling RILL-R010 propagates through timeout body', () => {
  it('seq loop exceeding 10000 iterations throws RILL-R010 through timeout', async () => {
    // Default iteration ceiling is 10000. range(0, 10001) -> seq has 10001
    // iterations, which triggers RILL-R010 as a non-catchable fatal halt.
    // The timeout body re-throws it unchanged per §NOD.10.4.
    // Use a large duration literal (not duration() call — named args unsupported).
    await expect(
      run('timeout<total: duration("10s")> { range(0, 10001) -> seq({ $ }) }')
    ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R010' }));
  });

  it('RILL-R010 is not catchable — guard does not catch it', async () => {
    await expect(
      run(
        'guard { timeout<total: duration("10s")> { range(0, 10001) -> seq({ $ }) } }'
      )
    ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R010' }));
  });
});

// ---------------------------------------------------------------------------
// AC-20 / BC-3: nested timeouts — outer fires first
// ---------------------------------------------------------------------------

describe('AC-20 / BC-3: nested timeouts — outer fires first', () => {
  it('outer total timeout fires before inner idle timeout', async () => {
    // Outer timeout: 80ms total. Inner timeout: 5000ms idle.
    // Outer fires first. The inner idle body waits 500ms via signal-aware fn.
    // Abort propagates from outer -> inner, and the outer catch block throws
    // #TIMEOUT_TOTAL because expired=true. Guard catches it.
    const result = await run(
      `guard {
        timeout<total: duration("80ms")> {
          timeout<idle: duration("5s")> {
            outer_slow()
          }
        }
      }`,
      { functions: { outer_slow: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R082'));
  });
});

// ---------------------------------------------------------------------------
// AC-22 / BC-5: timeout<total:> recovery via guard + ??
// ---------------------------------------------------------------------------

describe('AC-22 / BC-5: timeout<total:> recovery via guard + ??', () => {
  it('guard catches timeout and ?? fallback resolves to default', async () => {
    // guard catches the catchable #TIMEOUT_TOTAL halt and returns the
    // invalid value. The ?? operator then replaces it with the fallback string.
    // [DEVIATION] Plain `timeout<...> { } ?? "fallback"` does not work because
    // the catchable RuntimeHaltSignal thrown by timeout is not intercepted by ??
    // (which only handles RILL_R007/R008 and isInvalid return values).
    const result = await run(
      'guard { timeout<total: duration("50ms")> { slow_for_fallback() } } ?? "timeout"',
      { functions: { slow_for_fallback: makeSlowFn() } }
    );
    expect(result).toBe('timeout');
    expect(isInvalid(result as never)).toBe(false);
  });

  it('?? fallback is not invoked when timeout body completes in time', async () => {
    const result = await run(
      'guard { timeout<total: duration("200ms")> { "ok" } } ?? "fallback"'
    );
    expect(result).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// AC-23 / BC-6: timeout<idle:> recovery via guard + type inspection
// ---------------------------------------------------------------------------

describe('AC-23 / BC-6: timeout<idle:> invalid value inspectable via guard', () => {
  it('guard catches #TIMEOUT_IDLE and the invalid value is inspectable', async () => {
    const result = await run(
      'guard { timeout<idle: duration("50ms")> { idle_for_guard() } }',
      { functions: { idle_for_guard: makeSlowFn() } }
    );
    expect(isInvalid(result as never)).toBe(true);
    const code = getStatus(result as never).code;
    expect(code).toBe(resolveAtom('RILL_R083'));
  });

  it('guard<on: list[#RILL_R083]> catches only the matching idle timeout', async () => {
    const result = await run(
      'guard<on: list[#RILL_R083]> { timeout<idle: duration("50ms")> { guard_idle_fn() } } ?? "idle_timeout"',
      { functions: { guard_idle_fn: makeSlowFn() } }
    );
    expect(result).toBe('idle_timeout');
  });
});
