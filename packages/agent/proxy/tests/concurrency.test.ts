/**
 * ConcurrencyLimiter unit tests.
 *
 * Acquire/release cycle works
 * AC-29: global limit enforced (PROXY_CONCURRENCY_LIMIT)
 * AC-30: per-agent limit enforced (PROXY_CONCURRENCY_LIMIT)
 * AC-62: queueSize:0 immediate 429 (ProxyError)
 * AC-61: AHI children count against global (multiple acquires count)
 */

import { describe, it, expect } from 'vitest';
import { createConcurrencyLimiter } from '../src/concurrency.js';
import { ProxyError, PROXY_CONCURRENCY_LIMIT } from '../src/errors.js';

describe('createConcurrencyLimiter', () => {
  describe('acquire/release cycle', () => {
    it('returns a token with the correct agentName', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 5,
        maxConcurrentPerAgent: 2,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });

      // Act
      const token = await limiter.acquire('agentA');

      // Assert
      expect(token.agentName).toBe('agentA');
      expect(typeof token.acquiredAt).toBe('number');
    });

    it('increments active count on acquire and decrements on release', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 5,
        maxConcurrentPerAgent: 5,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });

      // Act & Assert
      expect(limiter.stats.active).toBe(0);
      const token = await limiter.acquire('agentA');
      expect(limiter.stats.active).toBe(1);
      limiter.release(token);
      expect(limiter.stats.active).toBe(0);
    });

    it('tracks per-agent active count in stats', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 10,
        maxConcurrentPerAgent: 5,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });

      // Act
      const t1 = await limiter.acquire('agentA');
      const t2 = await limiter.acquire('agentA');

      // Assert
      expect(limiter.stats.activeByAgent['agentA']).toBe(2);

      limiter.release(t1);
      expect(limiter.stats.activeByAgent['agentA']).toBe(1);

      limiter.release(t2);
      expect(limiter.stats.activeByAgent['agentA']).toBeUndefined();
    });

    it('release is a no-op when already fully released', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 5,
        maxConcurrentPerAgent: 5,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      const token = await limiter.acquire('agentA');
      limiter.release(token);

      // Act — double release should not throw or corrupt state
      limiter.release(token);

      // Assert
      expect(limiter.stats.active).toBe(0);
    });
  });

  describe('AC-29: global limit enforcement', () => {
    it('rejects when global limit is reached', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 2,
        maxConcurrentPerAgent: 10,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');
      await limiter.acquire('agentB');

      // Act & Assert — third acquire should be rejected
      await expect(limiter.acquire('agentC')).rejects.toBeInstanceOf(
        ProxyError
      );
    });

    it('rejected token has PROXY_CONCURRENCY_LIMIT code', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxConcurrentPerAgent: 10,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');

      // Act
      let caught: unknown;
      try {
        await limiter.acquire('agentB');
      } catch (err) {
        caught = err;
      }

      // Assert
      expect(caught).toBeInstanceOf(ProxyError);
      expect((caught as ProxyError).code).toBe(PROXY_CONCURRENCY_LIMIT);
    });

    it('allows acquire again after release brings count below limit', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxConcurrentPerAgent: 10,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      const token = await limiter.acquire('agentA');
      limiter.release(token);

      // Act & Assert — should succeed after release
      const token2 = await limiter.acquire('agentA');
      expect(token2.agentName).toBe('agentA');
    });
  });

  describe('AC-30: per-agent limit enforcement', () => {
    it('rejects when per-agent limit is reached for that agent', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 100,
        maxConcurrentPerAgent: 2,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');
      await limiter.acquire('agentA');

      // Act & Assert
      await expect(limiter.acquire('agentA')).rejects.toBeInstanceOf(
        ProxyError
      );
    });

    it('per-agent limit does not affect other agents', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 100,
        maxConcurrentPerAgent: 1,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');

      // Act — agentB should succeed even though agentA is at its limit
      const token = await limiter.acquire('agentB');

      // Assert
      expect(token.agentName).toBe('agentB');
    });

    it('per-agent rejection has PROXY_CONCURRENCY_LIMIT code', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 100,
        maxConcurrentPerAgent: 1,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');

      // Act
      let caught: unknown;
      try {
        await limiter.acquire('agentA');
      } catch (err) {
        caught = err;
      }

      // Assert
      expect(caught).toBeInstanceOf(ProxyError);
      expect((caught as ProxyError).code).toBe(PROXY_CONCURRENCY_LIMIT);
      expect((caught as ProxyError).agentName).toBe('agentA');
    });
  });

  describe('AC-62: queueSize:0 immediate rejection', () => {
    it('immediately rejects when at capacity (no queuing)', async () => {
      // Arrange — queueSize: 0 means reject immediately when full
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxConcurrentPerAgent: 1,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');

      // Act — must reject synchronously (Promise.reject, not a deferred wait)
      const start = Date.now();
      let caught: unknown;
      try {
        await limiter.acquire('agentA');
      } catch (err) {
        caught = err;
      }
      const elapsed = Date.now() - start;

      // Assert: rejected immediately (well under 100 ms)
      expect(caught).toBeInstanceOf(ProxyError);
      expect(elapsed).toBeLessThan(100);
    });

    it('increments rejected count on each rejection', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxConcurrentPerAgent: 1,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');
      expect(limiter.stats.rejected).toBe(0);

      // Act
      await limiter.acquire('agentA').catch(() => undefined);
      await limiter.acquire('agentA').catch(() => undefined);

      // Assert
      expect(limiter.stats.rejected).toBe(2);
    });
  });

  describe('AC-61: AHI children count against global limit', () => {
    it('multiple concurrent acquires from different agents all count toward global', async () => {
      // Arrange — global limit of 3, per-agent limit high
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 3,
        maxConcurrentPerAgent: 10,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });

      // Simulate parent + two AHI children each acquiring a slot
      const t1 = await limiter.acquire('agentParent');
      const t2 = await limiter.acquire('agentChildB');
      const t3 = await limiter.acquire('agentChildC');

      // Act — global limit hit; fourth acquire (any agent) must fail
      await expect(limiter.acquire('agentParent')).rejects.toBeInstanceOf(
        ProxyError
      );

      // Assert stats reflect all 3 active slots consumed
      expect(limiter.stats.active).toBe(3);

      // Release one slot and verify it recovers
      limiter.release(t3);
      const t4 = await limiter.acquire('agentChildC');
      expect(t4.agentName).toBe('agentChildC');

      // Cleanup
      limiter.release(t1);
      limiter.release(t2);
      limiter.release(t4);
    });
  });

  describe('stats', () => {
    it('queued is always 0 in phase 4 (no queuing implemented)', async () => {
      // Arrange
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 5,
        maxConcurrentPerAgent: 5,
        queueSize: 0,
        requestTimeoutMs: 60000,
      });
      await limiter.acquire('agentA');

      // Assert
      expect(limiter.stats.queued).toBe(0);
    });
  });
});
