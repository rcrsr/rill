/**
 * Child contexts created for block/loop/closure/each bodies must inherit
 * the parent's virtual-clock (nowMs), timezone, and scheduler fields so
 * now(), timezone-aware datetime methods, and timeout<> behave the same
 * inside a nested body as they do at the top level.
 */
import { describe, expect, it } from 'vitest';

import type { TimeoutScheduler } from '@rcrsr/rill';

import { mockAsyncFn, run } from '../helpers/runtime.js';

describe('child context time-field inheritance', () => {
  it('now() inside a seq body reflects the parent nowMs virtual clock', async () => {
    const fixedMs = 1710316800000;

    const result = await run('list[1] -> seq({ now().unix })', {
      nowMs: fixedMs,
    });

    expect(result).toEqual([fixedMs]);
  });

  it('now() inside a while-do loop body reflects the parent nowMs virtual clock', async () => {
    const fixedMs = 1710316800000;

    const result = await run('0 -> while ($ < 1) do { now().unix }', {
      nowMs: fixedMs,
    });

    expect(result).toBe(fixedMs);
  });

  it('now() inside a closure body reflects the parent nowMs virtual clock', async () => {
    const fixedMs = 1710316800000;

    const result = await run('{ now().unix } => $f\n0 -> $f', {
      nowMs: fixedMs,
    });

    expect(result).toBe(fixedMs);
  });

  it('a datetime method inside a seq body honors the parent timezone', async () => {
    const result = await run(
      'list[1] -> seq({ datetime("2026-03-13T08:00:00Z").local_iso })',
      { timezone: 1 }
    );

    expect(Array.isArray(result)).toBe(true);
    const [value] = result as unknown[];
    expect(typeof value).toBe('string');
    expect(value as string).toContain('+01:00');
    expect(value as string).toContain('2026-03-13T09:00:00');
  });

  it('timeout<> inside a seq body uses the parent-injected scheduler', async () => {
    // The fake scheduler fires almost immediately regardless of the
    // requested duration, proving it (not the real global scheduler)
    // is the one servicing the timer. The script requests a duration
    // far longer than the test's real wall-clock budget, and the host
    // body takes long enough that only an inherited fake scheduler can
    // expire the timeout before the body resolves.
    const fired: number[] = [];
    const fakeScheduler: TimeoutScheduler = {
      setTimeout(fn, ms) {
        fired.push(ms);
        return setTimeout(fn, 5);
      },
      clearTimeout(handle) {
        clearTimeout(handle);
      },
    };

    const result = await run(
      'list[1] -> seq({ guard { timeout<total: duration(0,0,1)> { $slow() } } => $r\n$r.! ? "timed_out" ! "completed" })',
      {
        scheduler: fakeScheduler,
        functions: { slow: mockAsyncFn(200, 'done') },
      }
    );

    expect(fired.length).toBeGreaterThan(0);
    expect(result).toEqual(['timed_out']);
  });
});
