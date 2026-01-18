/**
 * Rill Runtime Tests: Configuration
 * Tests for timeout and autoExceptions
 */

import {
  AutoExceptionError,
  createRuntimeContext,
  RuntimeError,
  TimeoutError,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

import { mockAsyncFn, run } from './helpers/runtime.js';

describe('Rill Runtime: Configuration', () => {
  describe('Timeout', () => {
    it('completes when function finishes before timeout', async () => {
      const fastFn = mockAsyncFn(10, 'done');
      const result = await run('"x" -> slowFn', {
        functions: { slowFn: fastFn },
        timeout: 100,
      });
      expect(result).toBe('done');
    });

    it('throws TimeoutError when function exceeds timeout', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      await expect(
        run('"x" -> slowFn', {
          functions: { slowFn },
          timeout: 50,
        })
      ).rejects.toThrow(TimeoutError);
    });

    it('TimeoutError has correct properties', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      try {
        await run('"x" -> slowFn', {
          functions: { slowFn },
          timeout: 50,
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
        const timeoutErr = err as TimeoutError;
        expect(timeoutErr.timeoutMs).toBe(50);
        expect(timeoutErr.functionName).toBe('slowFn');
      }
    });

    it('does not apply timeout to sync functions', async () => {
      const syncFn = (): string => 'sync result';
      const result = await run('"x" -> syncFn', {
        functions: { syncFn },
        timeout: 1, // Very short timeout
      });
      expect(result).toBe('sync result');
    });

    it('timeout applies to each function call independently', async () => {
      let callCount = 0;
      const fn = async (): Promise<string> => {
        callCount++;
        await new Promise((r) => setTimeout(r, 30));
        return `call${callCount}`;
      };
      const result = await run('"x" -> fn -> fn -> fn', {
        functions: { fn },
        timeout: 100, // Each call takes 30ms, should all complete
      });
      expect(result).toBe('call3');
      expect(callCount).toBe(3);
    });
  });

  describe('AutoExceptions', () => {
    it('throws when pattern matches string $_', async () => {
      await expect(
        run('"ERROR: something failed"', {
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('does not throw when pattern does not match', async () => {
      const result = await run('"OK: success"', {
        autoExceptions: ['ERROR'],
      });
      expect(result).toBe('OK: success');
    });

    it('matches with regex pattern', async () => {
      await expect(
        run('"Code: 500"', {
          autoExceptions: ['Code: [45]\\d\\d'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('does not throw for non-string values', async () => {
      const result = await run('42', {
        autoExceptions: ['42'],
      });
      expect(result).toBe(42);
    });

    it('checks after each statement', async () => {
      // First statement OK, second triggers exception
      await expect(
        run('"OK" -> $first\n"ERROR happened"', {
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('AutoExceptionError has correct properties', async () => {
      try {
        await run('"FATAL: crash"', {
          autoExceptions: ['FATAL'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AutoExceptionError);
        const autoErr = err as AutoExceptionError;
        expect(autoErr.pattern).toBe('FATAL');
        expect(autoErr.matchedValue).toBe('FATAL: crash');
      }
    });

    it('supports multiple patterns', async () => {
      await expect(
        run('"WARNING: issue"', {
          autoExceptions: ['ERROR', 'FATAL', 'WARNING'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('first matching pattern wins', async () => {
      try {
        await run('"ERROR and FATAL"', {
          autoExceptions: ['ERROR', 'FATAL'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        const autoErr = err as AutoExceptionError;
        expect(autoErr.pattern).toBe('ERROR');
      }
    });

    it('throws on invalid regex pattern during context creation', () => {
      expect(() =>
        createRuntimeContext({
          autoExceptions: ['[invalid'],
        })
      ).toThrow(RuntimeError);
    });

    it('works with complex regex', async () => {
      await expect(
        run('"Exit code: 1"', {
          autoExceptions: ['Exit code: [1-9]\\d*'],
        })
      ).rejects.toThrow(AutoExceptionError);

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

      // AutoException should trigger on the result
      await expect(
        run('"x" -> slowFn', {
          functions: { slowFn },
          timeout: 200,
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('timeout fires before autoException when function is slow', async () => {
      const verySlowFn = mockAsyncFn(500, 'ERROR: failed');

      await expect(
        run('"x" -> verySlowFn', {
          functions: { verySlowFn },
          timeout: 50,
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(TimeoutError);
    });
  });
});
