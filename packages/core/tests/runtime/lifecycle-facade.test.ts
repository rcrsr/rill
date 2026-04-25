/**
 * Rill Runtime Tests: LifecycleContext facade
 *
 * Specification Mapping:
 * - IR-3: dispose() is idempotent; second call returns same promise.
 * - IR-4: isDisposed() returns false while active, true after dispose() begins.
 * - IR-5: createDisposedResult() produces #DISPOSED invalid value.
 * - IR-6: trackInflight() registers promise before disposal; no-op after disposal.
 * - IR-7: invalidate() classifies known and unknown error codes into RillValue.
 * - IR-8: catch() wraps thunk execution; returns result or invalid value.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for all contexts.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
  resolveAtom,
} from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

describe('LifecycleContext', () => {
  describe('IR-3: dispose() idempotency', () => {
    it('returns same Promise on second call', () => {
      const ctx = createRuntimeContext({});
      const p1 = ctx.dispose();
      const p2 = ctx.dispose();
      expect(p1).toBe(p2);
    });

    it('returns same Promise after first resolves', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      const p2 = ctx.dispose();
      // The cached promise reference is returned; it is already resolved.
      expect(p2).toBeInstanceOf(Promise);
      await expect(p2).resolves.toBeUndefined();
    });

    it('all concurrent dispose calls share the same promise', () => {
      const ctx = createRuntimeContext({});
      const p1 = ctx.dispose();
      const p2 = ctx.dispose();
      const p3 = ctx.dispose();
      expect(p1).toBe(p2);
      expect(p2).toBe(p3);
    });
  });

  describe('IR-4: isDisposed() state transitions', () => {
    it('returns false on a fresh context', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.isDisposed()).toBe(false);
    });

    it('returns true after dispose() resolves', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      expect(ctx.isDisposed()).toBe(true);
    });

    it('remains true on repeated checks after dispose', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      expect(ctx.isDisposed()).toBe(true);
      expect(ctx.isDisposed()).toBe(true);
    });
  });

  describe('IR-5: createDisposedResult()', () => {
    it('returns an invalid RillValue', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.createDisposedResult();
      expect(isInvalid(result)).toBe(true);
    });

    it('carries code #DISPOSED', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.createDisposedResult();
      expect(getStatus(result).code).toBe(resolveAtom('DISPOSED'));
    });

    it('can be called before dispose', () => {
      const ctx = createRuntimeContext({});
      expect(() => ctx.createDisposedResult()).not.toThrow();
    });

    it('can be called after dispose', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      const result = ctx.createDisposedResult();
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('DISPOSED'));
    });
  });

  describe('IR-6: trackInflight()', () => {
    it('is a no-op after dispose has already begun', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      expect(() => ctx.trackInflight(Promise.resolve())).not.toThrow();
    });

    it('registered promise is awaited during dispose', async () => {
      const ctx = createRuntimeContext({});
      let settled = false;
      const p = Promise.resolve().then(() => {
        settled = true;
      });
      ctx.trackInflight(p);
      await ctx.dispose();
      // After dispose completes, the inflight promise has settled.
      expect(settled).toBe(true);
    });

    it('dispose completes when inflight promise resolves before timeout', async () => {
      const ctx = createRuntimeContext({});
      const p = Promise.resolve();
      ctx.trackInflight(p);
      await expect(ctx.dispose()).resolves.toBeUndefined();
    });

    it('after settle, trackInflight entry is removed and dispose is fast', async () => {
      const ctx = createRuntimeContext({});
      const p = Promise.resolve();
      ctx.trackInflight(p);
      // Flush microtasks so settle handler removes entry.
      await p;
      await Promise.resolve();
      // Dispose should complete without waiting; no inflight entries remain.
      await expect(ctx.dispose()).resolves.toBeUndefined();
    });
  });

  describe('IR-7: invalidate()', () => {
    it('returns an invalid RillValue for a known error code', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.invalidate(new Error('auth failure'), {
        code: 'AUTH',
        provider: 'idp',
      });
      expect(isInvalid(result)).toBe(true);
    });

    it('resolves known atom code correctly', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.invalidate(new Error('timed out'), {
        code: 'TIMEOUT',
        provider: 'svc',
      });
      expect(getStatus(result).code).toBe(resolveAtom('TIMEOUT'));
    });

    it('unregistered code falls back to #R001 without throwing', () => {
      const ctx = createRuntimeContext({});
      expect(() =>
        ctx.invalidate(new Error('x'), {
          code: 'COMPLETELY_UNKNOWN_CODE_XYZ',
          provider: 'test',
        })
      ).not.toThrow();
      const result = ctx.invalidate(new Error('x'), {
        code: 'COMPLETELY_UNKNOWN_CODE_XYZ',
        provider: 'test',
      });
      expect(getStatus(result).code).toBe(resolveAtom('R001'));
    });

    it('does not throw when first arg is a non-Error value', () => {
      const ctx = createRuntimeContext({});
      expect(() =>
        ctx.invalidate('plain string', { code: 'R999', provider: 'p' })
      ).not.toThrow();
      expect(() =>
        ctx.invalidate(42, { code: 'R999', provider: 'p' })
      ).not.toThrow();
      expect(() =>
        ctx.invalidate(null, { code: 'R999', provider: 'p' })
      ).not.toThrow();
    });

    it('preserves provider field from meta', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.invalidate(new Error('err'), {
        code: 'AUTH',
        provider: 'my-provider',
      });
      expect(getStatus(result).provider).toBe('my-provider');
    });
  });

  describe('IR-8: catch()', () => {
    it('passes through the resolved value when thunk succeeds', async () => {
      const ctx = createRuntimeContext({});
      const result = await ctx.catch(
        async () => 'success-value',
        () => null
      );
      expect(result).toBe('success-value');
    });

    it('wraps an Error throw into an invalid RillValue', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw new Error('boom');
        },
        () => null
      )) as RillValue;
      expect(isInvalid(result)).toBe(true);
    });

    it('detector returning null produces #R999 for Error throw', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw new Error('unclassified');
        },
        () => null
      )) as RillValue;
      expect(getStatus(result).code).toBe(resolveAtom('R999'));
    });

    it('wraps a non-Error throw into an invalid RillValue with #R999', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw 'plain-string';
        },
        () => null
      )) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('R999'));
    });

    it('non-Error throw records raw.original as String(thrown)', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw 99;
        },
        () => null
      )) as RillValue;
      const raw = getStatus(result).raw as unknown as { original?: unknown };
      expect(raw.original).toBe('99');
    });

    it('detector-provided meta drives atom code on Error throw', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw new Error('upstream slow');
        },
        () => ({ code: 'TIMEOUT', provider: 'upstream' })
      )) as RillValue;
      expect(getStatus(result).code).toBe(resolveAtom('TIMEOUT'));
    });

    it('detector receives the original Error for classification', async () => {
      const ctx = createRuntimeContext({});
      const seen: unknown[] = [];
      await ctx.catch(
        async () => {
          throw new Error('classify-me');
        },
        (err) => {
          seen.push(err);
          return { code: 'AUTH', provider: 'idp' };
        }
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(Error);
    });
  });

  describe('dispose timeout warning (EC-3 overlap)', () => {
    it('completes dispose even when inflight exceeds timeout', async () => {
      const logs: string[] = [];
      const ctx = createRuntimeContext({
        callbacks: { onLog: (msg) => logs.push(msg) },
      });
      const neverSettle = new Promise<void>(() => {});
      ctx.trackInflight(neverSettle);

      vi.useFakeTimers();
      try {
        const disposePromise = ctx.dispose();
        await vi.advanceTimersByTimeAsync(5001);
        await disposePromise;
      } finally {
        vi.useRealTimers();
      }

      expect(ctx.isDisposed()).toBe(true);
    });
  });

  describe('Error Contracts (EC-*)', () => {
    it('EC-3: dispose() returns identical promise reference on second call', () => {
      const ctx = createRuntimeContext({});
      const p1 = ctx.dispose();
      const p2 = ctx.dispose();
      expect(p1).toBe(p2);
    });

    it('EC-4: dispose() with hung inflight past timeout logs warning and flips isDisposed()', async () => {
      const logs: string[] = [];
      const ctx = createRuntimeContext({
        callbacks: { onLog: (msg) => logs.push(msg) },
      });
      const neverSettle = new Promise<void>(() => {});
      ctx.trackInflight(neverSettle);

      vi.useFakeTimers();
      try {
        const disposePromise = ctx.dispose();
        await vi.advanceTimersByTimeAsync(5001);
        await disposePromise;
      } finally {
        vi.useRealTimers();
      }

      expect(ctx.isDisposed()).toBe(true);
      const warning = logs.find((l) => l.includes('dispose()'));
      expect(warning).toBeDefined();
    });

    it('EC-5: invalidate() with unregistered error code resolves to #R001', () => {
      const ctx = createRuntimeContext({});
      const result = ctx.invalidate(new Error('unknown'), {
        code: 'TOTALLY_UNREGISTERED_XYZ_CODE',
        provider: 'test',
      });
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('R001'));
    });

    it('EC-6: catch() with non-Error thrown produces invalid RillValue with code #R999', async () => {
      const ctx = createRuntimeContext({});
      const result = (await ctx.catch(
        async () => {
          throw 'not an error object';
        },
        () => null
      )) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code).toBe(resolveAtom('R999'));
    });

    it('EC-7: trackInflight() after dispose() begins is silent no-op; isDisposed() is true', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();
      // After disposal, trackInflight must not throw and must not affect lifecycle.
      expect(() => ctx.trackInflight(Promise.resolve())).not.toThrow();
      expect(ctx.isDisposed()).toBe(true);
    });
  });
});
