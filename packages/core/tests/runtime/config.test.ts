/**
 * Rill Runtime Tests: Configuration
 * Tests for timeout and autoExceptions
 */

import {
  anyTypeValue,
  atomName,
  createRuntimeContext,
  getStatus,
  RuntimeError,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
import { describe, expect, it, vi } from 'vitest';

import { mockAsyncFn, run } from '../helpers/runtime.js';

/**
 * Asserts the thrown error is an auto-exception halt:
 * RuntimeHaltSignal with status.code=#R999, non-catchable.
 */
async function expectAutoExceptionHalt(
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
  expect(signal.name).toBe('RuntimeHaltSignal');
  expect(signal.catchable).toBe(false);
  const status = getStatus(signal.value);
  expect(atomName(status.code)).toBe('R999');
  return signal;
}

/**
 * Runs a script under fake setTimeout/clearTimeout (withTimeout and
 * mockAsyncFn both use the global timers) and advances fake time by
 * advanceMs. The settle handler is attached before time advances so a
 * timeout rejection is never unhandled. No real time elapses.
 */
async function runWithFakeTimers(
  source: string,
  options: Parameters<typeof run>[1],
  advanceMs: number
): Promise<{ value?: unknown; error?: unknown }> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const settled = run(source, options).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.advanceTimersByTimeAsync(advanceMs);
    return await settled;
  } finally {
    vi.useRealTimers();
  }
}

describe('Rill Runtime: Configuration', () => {
  describe('Timeout', () => {
    it('completes when function finishes before timeout', async () => {
      const fastFn = mockAsyncFn(10, 'done');
      const outcome = await runWithFakeTimers(
        'slowFn()',
        { functions: { slowFn: fastFn }, timeout: 100 },
        100
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.value).toBe('done');
    });

    // A timeout is a catchable halt (bug #270) so that `guard`/`retry` can
    // recover it. Its atom (RILL_R012) is mapped to a host-facing error ID,
    // so uncaught it escapes run() as a RuntimeError coded RILL-R012.
    it('halts with a catchable timeout halt when function exceeds timeout', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      const { error } = await runWithFakeTimers(
        'slowFn()',
        { functions: { slowFn }, timeout: 50 },
        50
      );
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R012');
      expect((error as RuntimeError).message).toContain('timed out');
    });

    it('timeout halt carries function name and timeout duration', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      const { error } = await runWithFakeTimers(
        'slowFn()',
        { functions: { slowFn }, timeout: 50 },
        50
      );
      expect(error).toBeInstanceOf(RuntimeError);
      const runtimeErr = error as RuntimeError;
      expect(runtimeErr.errorId).toBe('RILL-R012');
      const status = getStatus(runtimeErr.haltValue!);
      const raw = status.raw as Record<string, unknown>;
      expect(raw['functionName']).toBe('slowFn');
      expect(raw['timeoutMs']).toBe(50);
      expect(status.message).toContain('50ms');
    });

    it('guard recovers a timeout to its invalid value', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      const outcome = await runWithFakeTimers(
        'guard { slowFn() } => $r  $r.!message',
        { functions: { slowFn }, timeout: 50 },
        50
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.value).toContain('timed out');
    });

    it('does not apply timeout to sync functions', async () => {
      const syncFn = {
        returnType: anyTypeValue,
        params: [
          {
            name: 'input',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (): string => 'sync result',
      };
      const result = await run('"x" -> syncFn', {
        functions: { syncFn },
        timeout: 1, // Very short timeout
      });
      expect(result).toBe('sync result');
    });

    // Three calls of 30ms each total 90ms, over the 50ms limit, yet each
    // call is under it: only a per-call timeout lets the chain complete.
    it('timeout applies to each function call independently', async () => {
      let callCount = 0;
      const fn = {
        returnType: anyTypeValue,
        params: [
          {
            name: 'input',
            type: { kind: 'string' } as const,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: async (): Promise<string> => {
          callCount++;
          await new Promise((r) => setTimeout(r, 30));
          return `call${callCount}`;
        },
      };
      const outcome = await runWithFakeTimers(
        '"x" -> fn -> fn -> fn',
        { functions: { fn }, timeout: 50 },
        100
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.value).toBe('call3');
      expect(callCount).toBe(3);
    });
  });

  describe('AutoExceptions', () => {
    it('throws when pattern matches string $_', async () => {
      await expectAutoExceptionHalt(() =>
        run('"ERROR: something failed"', {
          autoExceptions: ['ERROR'],
        })
      );
    });

    it('does not throw when pattern does not match', async () => {
      const result = await run('"OK: success"', {
        autoExceptions: ['ERROR'],
      });
      expect(result).toBe('OK: success');
    });

    it('matches with regex pattern', async () => {
      await expectAutoExceptionHalt(() =>
        run('"Code: 500"', {
          autoExceptions: ['Code: [45]\\d\\d'],
        })
      );
    });

    it('does not throw for non-string values', async () => {
      const result = await run('42', {
        autoExceptions: ['42'],
      });
      expect(result).toBe(42);
    });

    it('checks after each statement', async () => {
      // First statement OK, second triggers exception
      await expectAutoExceptionHalt(() =>
        run('"OK" => $first\n"ERROR happened"', {
          autoExceptions: ['ERROR'],
        })
      );
    });

    it('auto-exception halt carries pattern and matched value on status.raw', async () => {
      const signal = await expectAutoExceptionHalt(() =>
        run('"FATAL: crash"', {
          autoExceptions: ['FATAL'],
        })
      );
      const status = getStatus(signal.value);
      expect(status.raw['pattern']).toBe('FATAL');
      expect(status.raw['matchedValue']).toBe('FATAL: crash');
      expect(status.provider).toBe('extension');
    });

    it('supports multiple patterns', async () => {
      await expectAutoExceptionHalt(() =>
        run('"WARNING: issue"', {
          autoExceptions: ['ERROR', 'FATAL', 'WARNING'],
        })
      );
    });

    it('first matching pattern wins', async () => {
      const signal = await expectAutoExceptionHalt(() =>
        run('"ERROR and FATAL"', {
          autoExceptions: ['ERROR', 'FATAL'],
        })
      );
      const status = getStatus(signal.value);
      expect(status.raw['pattern']).toBe('ERROR');
    });

    it('throws on invalid regex pattern during context creation', () => {
      expect(() =>
        createRuntimeContext({
          autoExceptions: ['[invalid'],
        })
      ).toThrow(RuntimeError);
    });

    it('works with complex regex', async () => {
      await expectAutoExceptionHalt(() =>
        run('"Exit code: 1"', {
          autoExceptions: ['Exit code: [1-9]\\d*'],
        })
      );

      // Exit code 0 should not match
      const result = await run('"Exit code: 0"', {
        autoExceptions: ['Exit code: [1-9]\\d*'],
      });
      expect(result).toBe('Exit code: 0');
    });
  });

  describe('Combined Configuration', () => {
    it('timeout and autoExceptions work together', async () => {
      const slowFn = mockAsyncFn(50, 'ERROR: failed');

      // The function settles at 50ms, before the 200ms timeout, so the
      // autoException triggers on its result.
      const { error } = await runWithFakeTimers(
        'slowFn()',
        { functions: { slowFn }, timeout: 200, autoExceptions: ['ERROR'] },
        200
      );
      await expectAutoExceptionHalt(() => Promise.reject(error));
    });

    it('timeout fires before autoException when function is slow', async () => {
      const verySlowFn = mockAsyncFn(500, 'ERROR: failed');

      const { error } = await runWithFakeTimers(
        'verySlowFn()',
        {
          functions: { verySlowFn },
          timeout: 50,
          autoExceptions: ['ERROR'],
        },
        50
      );
      // The timeout wins the race: a catchable timeout halt, not the
      // (non-catchable) autoException halt. Uncaught, it escapes as a
      // RuntimeError coded RILL-R012.
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R012');
      expect((error as RuntimeError).message).toContain('timed out');
    });
  });
});
