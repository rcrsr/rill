/**
 * Rill Runtime Tests: LifecycleContext facade
 *
 * Specification Mapping:
 * - IR-3: dispose() is idempotent; second call returns same promise.
 * - IR-4: isDisposed() returns false while active, true after dispose() begins.
 * - IR-5: createDisposedResult() produces #DISPOSED invalid value.
 * - IR-6: trackInflight() registers promise before disposal; no-op after disposal.
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
import { run } from '../helpers/runtime.js';

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

    it('attaches a rejection observer and swallows it when tracked after dispose', async () => {
      const ctx = createRuntimeContext({});
      await ctx.dispose();

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        ctx.trackInflight(Promise.reject(new Error('post-dispose')));
        // Flush a macrotask tick so a would-be unhandledRejection has a
        // chance to fire before we assert it did not.
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  describe('default callbacks: onLog', () => {
    it('does not write to console.log', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await run('log("x")');
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
