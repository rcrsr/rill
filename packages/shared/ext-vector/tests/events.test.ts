/**
 * Test suite for event emission wrapper.
 * Validates error contracts (EC-9, EC-10) and acceptance criteria (AC-2, AC-16, AC-22).
 */

import { describe, it, expect, vi } from 'vitest';
import { withEventEmission } from '../src/events.js';
import { RuntimeError } from '@rcrsr/rill';
import type { RuntimeContext } from '@rcrsr/rill';

describe('withEventEmission', () => {
  const provider = 'testdb';
  const operation = 'upsert';

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

  describe('AC-2: Success case - emits event with numeric duration', () => {
    it('emits success event with provider:operation format', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      const metadata = { id: 'vec-1', count: 10 };
      const result = await withEventEmission(
        ctx,
        provider,
        operation,
        metadata,
        async () => 'success'
      );

      expect(result).toBe('success');
      expect(onLogEvent).toHaveBeenCalledTimes(1);

      const event = onLogEvent.mock.calls[0][0];
      expect(event.event).toBe(`${provider}:${operation}`);
      expect(event.subsystem).toBe(`extension:${provider}`);
      expect(event.id).toBe('vec-1');
      expect(event.count).toBe(10);
      expect(event.duration).toBeTypeOf('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    it('spreads metadata into event payload', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      const metadata = { vectorId: 'v123', dimension: 384, method: 'cosine' };
      await withEventEmission(
        ctx,
        provider,
        operation,
        metadata,
        async () => true
      );

      const event = onLogEvent.mock.calls[0][0];
      expect(event.vectorId).toBe('v123');
      expect(event.dimension).toBe(384);
      expect(event.method).toBe('cosine');
    });

    it('handles empty metadata object', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await withEventEmission(ctx, provider, operation, {}, async () => 'done');

      const event = onLogEvent.mock.calls[0][0];
      expect(event.event).toBe(`${provider}:${operation}`);
      expect(event.subsystem).toBe(`extension:${provider}`);
      expect(event.duration).toBeTypeOf('number');
    });

    it('returns fn result without modification', async () => {
      const ctx = createMockContext();
      const expectedResult = { data: 'complex', nested: { value: 42 } };

      const result = await withEventEmission(
        ctx,
        provider,
        operation,
        {},
        async () => expectedResult
      );

      expect(result).toEqual(expectedResult);
      expect(result).toBe(expectedResult);
    });
  });

  describe('EC-9 / AC-16: Error case - emits error event before throwing', () => {
    it('emits provider:error event when fn throws', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      const originalError = new Error('Database connection failed');

      await expect(
        withEventEmission(ctx, provider, operation, {}, async () => {
          throw originalError;
        })
      ).rejects.toThrow(RuntimeError);

      expect(onLogEvent).toHaveBeenCalledTimes(1);

      const event = onLogEvent.mock.calls[0][0];
      expect(event.event).toBe(`${provider}:error`);
      expect(event.subsystem).toBe(`extension:${provider}`);
      expect(event.error).toContain('Database connection failed');
      expect(event.duration).toBeTypeOf('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    it('throws mapped RuntimeError after emitting error event', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        withEventEmission(ctx, provider, operation, {}, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow(RuntimeError);

      expect(onLogEvent).toHaveBeenCalledTimes(1);
    });

    it('maps error via mapVectorError before throwing', async () => {
      const ctx = createMockContext();

      const promise = withEventEmission(
        ctx,
        provider,
        operation,
        {},
        async () => {
          throw new Error('401 unauthorized');
        }
      );

      await expect(promise).rejects.toThrow(RuntimeError);
      await expect(promise).rejects.toThrow('authentication failed (401)');
    });

    it('includes error duration in error event', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        withEventEmission(ctx, provider, operation, {}, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('delayed error');
        })
      ).rejects.toThrow(RuntimeError);

      const event = onLogEvent.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(10);
    });
  });

  describe('EC-10 / AC-22: Undefined onLogEvent - executes without error, no event emitted', () => {
    it('executes successfully when onLogEvent is undefined', async () => {
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = undefined;

      const result = await withEventEmission(
        ctx,
        provider,
        operation,
        { id: 'test' },
        async () => 'success'
      );

      expect(result).toBe('success');
    });

    it('does not throw when onLogEvent is undefined', async () => {
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = undefined;

      await expect(
        withEventEmission(ctx, provider, operation, {}, async () => 'result')
      ).resolves.toBe('result');
    });

    it('throws mapped error even when onLogEvent is undefined', async () => {
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = undefined;

      await expect(
        withEventEmission(ctx, provider, operation, {}, async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow(RuntimeError);
    });
  });

  describe('Duration calculation', () => {
    it('calculates duration for fast operations', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await withEventEmission(ctx, provider, operation, {}, async () => 'fast');

      const event = onLogEvent.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(event.duration).toBeLessThan(100);
    });

    it('calculates duration for slow operations', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await withEventEmission(ctx, provider, operation, {}, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'slow';
      });

      const event = onLogEvent.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Provider and operation naming', () => {
    it('uses provider name in event and subsystem', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await withEventEmission(ctx, 'chroma', 'query', {}, async () => 'result');

      const event = onLogEvent.mock.calls[0][0];
      expect(event.event).toBe('chroma:query');
      expect(event.subsystem).toBe('extension:chroma');
    });

    it('uses different operations for different calls', async () => {
      const ctx = createMockContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await withEventEmission(
        ctx,
        provider,
        'delete',
        {},
        async () => 'deleted'
      );

      const event = onLogEvent.mock.calls[0][0];
      expect(event.event).toBe(`${provider}:delete`);
    });
  });
});
