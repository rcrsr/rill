/**
 * Tests for createRedisBackend — connection failure cases.
 *
 * Uses a vi.mock stub that throws on connect() to simulate ECONNREFUSED.
 * Real ioredis retries connections and has a 10 s connectTimeout by default;
 * createRedisBackend does not expose retry or timeout overrides. Testing
 * AC-40/EC-17 with a real unreachable port would block for 10+ seconds per
 * test. A stub that throws the same Error type ioredis would produce is the
 * correct unit-test approach.
 *
 * Covered:
 *   AC-40  ECONNREFUSED on unreachable host propagates native error
 *   EC-17  Connection refused → ioredis connection error
 */

import { describe, it, expect, vi } from 'vitest';

// Stub Redis so connect() immediately rejects with an ECONNREFUSED-style error.
// The stub matches the shape createRedisBackend requires: constructor accepting
// options, plus connect(), ping(), quit(), and pipeline() methods.
vi.mock('ioredis', () => {
  class RedisFailing {
    constructor(_options: unknown) {}

    connect(): Promise<never> {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:1');
      // ioredis adds a code property to connection errors.
      (err as Error & { code?: string }).code = 'ECONNREFUSED';
      return Promise.reject(err);
    }

    ping(): Promise<string> {
      return Promise.resolve('PONG');
    }

    quit(): Promise<string> {
      return Promise.resolve('OK');
    }

    pipeline(): { exec(): Promise<null> } {
      return { exec: () => Promise.resolve(null) };
    }
  }

  return { Redis: RedisFailing };
});

import { createRedisBackend } from '../src/index.js';

// ============================================================
// ECONNREFUSED: AC-40, EC-17
// ============================================================

describe('createRedisBackend — connection failure (AC-40, EC-17)', () => {
  it('connect() rejects when the host is unreachable (ECONNREFUSED)', async () => {
    const backend = createRedisBackend({ host: '127.0.0.1', port: 1 });

    await expect(backend.connect()).rejects.toThrow('ECONNREFUSED');
  });

  it('connect() rejection is an Error instance with ECONNREFUSED in message', async () => {
    const backend = createRedisBackend({ host: '127.0.0.1', port: 1 });

    let caught: unknown;
    try {
      await backend.connect();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('ECONNREFUSED');
  });
});
