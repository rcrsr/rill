/**
 * Test suite for function wrapper factory.
 * Validates error contracts (EC-20, EC-21) and acceptance criteria (AC-9).
 */

import { describe, it, expect, vi } from 'vitest';
import { createFunctionWrapper } from '../src/wrapper.js';
import { createDisposalState } from '../src/disposal.js';
import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';

describe('createFunctionWrapper', () => {
  const provider = 'testdb';

  function createMockContext(): RuntimeContext {
    return {
      parent: undefined,
      variables: new Map(),
      variableTypes: new Map(),
      functions: new Map(),
      methods: new Map(),
      callbacks: {
        onOutput: vi.fn(),
        onLogEvent: vi.fn(),
      },
      observability: {},
      pipeValue: null,
      timeout: undefined,
      autoExceptions: [],
      signal: undefined,
      maxCallStackDepth: 100,
      annotationStack: [],
      callStack: [],
    };
  }

  describe('EC-20: disposed state throws', () => {
    it('throws RuntimeError when state is disposed', async () => {
      const state = createDisposalState(provider);
      state.isDisposed = true;

      const wrap = createFunctionWrapper(provider, state);
      const wrappedFn = wrap('query', async () => 'result', undefined);

      const ctx = createMockContext();
      await expect(wrappedFn([], ctx)).rejects.toThrow(RuntimeError);
      await expect(wrappedFn([], ctx)).rejects.toThrow('operation cancelled');
    });

    it('checks disposal before executing function', async () => {
      const state = createDisposalState(provider);
      const executionSpy = vi.fn(async () => 'result');

      const wrap = createFunctionWrapper(provider, state);
      const wrappedFn = wrap('query', executionSpy, undefined);

      // Dispose before calling
      state.isDisposed = true;

      const ctx = createMockContext();
      await expect(wrappedFn([], ctx)).rejects.toThrow();
      expect(executionSpy).not.toHaveBeenCalled();
    });
  });

  describe('EC-21: error mapping', () => {
    it('maps function errors via mapVectorError', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const wrappedFn = wrap(
        'query',
        async () => {
          throw new Error('401 unauthorized');
        },
        undefined
      );

      const ctx = createMockContext();
      await expect(wrappedFn([], ctx)).rejects.toThrow(RuntimeError);
      await expect(wrappedFn([], ctx)).rejects.toThrow('authentication failed');
    });

    it('emits error event on failure', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap(
        'upsert',
        async () => {
          throw new Error('dimension mismatch');
        },
        undefined
      );

      await expect(wrappedFn([], ctx)).rejects.toThrow();
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:error`,
          subsystem: `extension:${provider}`,
          error: expect.stringContaining('dimension mismatch'),
        })
      );
    });

    it('includes duration in error event', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap(
        'query',
        async () => {
          throw new Error('timeout');
        },
        undefined
      );

      await expect(wrappedFn([], ctx)).rejects.toThrow();
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('AC-9: event emission on success', () => {
    it('emits success event with duration', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('query', async () => 'result', undefined);

      await wrappedFn([], ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:query`,
          subsystem: `extension:${provider}`,
          duration: expect.any(Number),
        })
      );
    });

    it('includes metadata in success event', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap(
        'upsert',
        async () => 'ok',
        (args: RillValue[]) => ({
          collection: args[0],
          count: args[1],
        })
      );

      await wrappedFn(['my-collection', 5], ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'my-collection',
          count: 5,
        })
      );
    });

    it('emits event without metadata when callback absent', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('delete', async () => null, undefined);

      await wrappedFn([], ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:delete`,
          duration: expect.any(Number),
        })
      );
    });

    it('handles absent onLogEvent callback gracefully', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = undefined;

      const wrappedFn = wrap('query', async () => 'result', undefined);

      // Should not throw
      await expect(wrappedFn([], ctx)).resolves.toBe('result');
    });
  });

  describe('timing behavior', () => {
    it('records start time before function execution', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap(
        'query',
        async () => {
          // Simulate delay
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'result';
        },
        undefined
      );

      await wrappedFn([], ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: expect.any(Number),
        })
      );

      const duration = onLogEvent.mock.calls[0][0].duration;
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('return value', () => {
    it('returns wrapped function result on success', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const wrappedFn = wrap('query', async () => 'success', undefined);

      const ctx = createMockContext();
      const result = await wrappedFn([], ctx);

      expect(result).toBe('success');
    });

    it('preserves complex return values', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const expected = { items: [1, 2, 3], count: 3 };
      const wrappedFn = wrap('query', async () => expected, undefined);

      const ctx = createMockContext();
      const result = await wrappedFn([], ctx);

      expect(result).toEqual(expected);
    });
  });

  describe('wrapper factory behavior', () => {
    it('creates multiple wrapped functions with same state', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const query = wrap('query', async () => 'query-result', undefined);
      const upsert = wrap('upsert', async () => 'upsert-result', undefined);

      const ctx = createMockContext();

      expect(await query([], ctx)).toBe('query-result');
      expect(await upsert([], ctx)).toBe('upsert-result');
    });

    it('all wrapped functions check same disposal state', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);

      const query = wrap('query', async () => 'result', undefined);
      const upsert = wrap('upsert', async () => 'result', undefined);

      const ctx = createMockContext();

      // Dispose state
      state.isDisposed = true;

      // Both should throw
      await expect(query([], ctx)).rejects.toThrow('operation cancelled');
      await expect(upsert([], ctx)).rejects.toThrow('operation cancelled');
    });
  });
});
