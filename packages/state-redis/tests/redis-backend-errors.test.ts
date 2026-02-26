/**
 * Tests for createRedisBackend — error and boundary cases.
 *
 * Uses ioredis-mock for mock-compatible tests.
 * Uses real ioredis for the ECONNREFUSED test (AC-40, EC-17).
 *
 * Covered:
 *   AC-40  ECONNREFUSED on unreachable host propagates native error
 *   EC-17  Connection refused → ioredis connection error
 *   AC-47  Redis backend with expired TTL returns null on load (TTL path)
 *   AC-24  ttl causes key expiration (verified via fake timers in ioredis-mock)
 *   AC-42  listCheckpoints with 0 matching returns []
 *   AC-43  deleteCheckpoint on nonexistent ID resolves without error
 *   AC-44  connect() called twice resolves (idempotent)
 *   AC-45  close() called twice resolves (idempotent)
 *   AC-46  saveCheckpoint with extensionState: {} persists correctly
 *
 * Skipped:
 *   AC-25  Auto-reconnect on transient failure — requires real network-level
 *          fault injection; not reproducible with ioredis-mock or unit mocks.
 *   EC-18  Authentication failure — ioredis-mock does not validate passwords;
 *          requires a live Redis instance with requirepass configured.
 *   EC-19  Network timeout — ioredis-mock does not simulate network latency;
 *          requires real network with artificial delay or firewall rule.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CheckpointData, PersistedSessionState } from '@rcrsr/rill-host';

// vi.mock must appear before any imports that load 'ioredis'.
// The mock applies to all tests in this file EXCEPT the ECONNREFUSED tests,
// which use a conditional path (no mock applied for that describe block — the
// ECONNREFUSED test is isolated in a separate file: redis-backend-conn.test.ts).
vi.mock('ioredis', async () => {
  const RedisMock = (await import('ioredis-mock')).default;
  return { Redis: RedisMock };
});

import { createRedisBackend } from '../src/index.js';

// ============================================================
// FIXTURE BUILDERS
// ============================================================

function makeCheckpoint(overrides?: Partial<CheckpointData>): CheckpointData {
  return {
    id: 'chk-001',
    sessionId: 'sess-001',
    agentName: 'test-agent',
    timestamp: 1000,
    stepIndex: 0,
    totalSteps: 5,
    pipeResult: null,
    variables: {},
    variableTypes: {},
    extensionState: {},
    ...overrides,
  };
}

function makeSession(
  overrides?: Partial<PersistedSessionState>
): PersistedSessionState {
  return {
    sessionId: 'sess-001',
    agentName: 'test-agent',
    state: 'running',
    startTime: 1000,
    lastActivity: 2000,
    metadata: {},
    ...overrides,
  };
}

// ============================================================
// HELPER: fresh backend per test
// ============================================================

async function openBackend(
  overrides?: Parameters<typeof createRedisBackend>[0]
): Promise<ReturnType<typeof createRedisBackend>> {
  // Flush all mock state for test isolation.
  // ioredis-mock auto-connects when lazyConnect is false (the default),
  // so no explicit connect() call is needed on the helper instance.
  const RedisMock = (await import('ioredis-mock')).default;
  const tmp = new RedisMock({ host: 'localhost', port: 6379 }) as {
    flushall(): Promise<'OK'>;
  };
  await tmp.flushall();

  const b = createRedisBackend({
    host: 'localhost',
    port: 6379,
    ...overrides,
  });
  await b.connect();
  return b;
}

afterEach(() => {
  // Restore fake timers if any test activated them.
  vi.useRealTimers();
});

// ============================================================
// BOUNDARY CONDITIONS: AC-42, AC-43, AC-44, AC-45, AC-46
// ============================================================

describe('createRedisBackend — boundary conditions', () => {
  it('listCheckpoints returns [] when 0 checkpoints match agentName (AC-42)', async () => {
    const backend = await openBackend();

    await backend.saveCheckpoint(makeCheckpoint({ agentName: 'agent-other' }));

    const results = await backend.listCheckpoints('agent-with-nothing');

    expect(results).toEqual([]);

    await backend.close();
  });

  it('deleteCheckpoint on nonexistent ID resolves without error (AC-43)', async () => {
    const backend = await openBackend();

    await expect(
      backend.deleteCheckpoint('nonexistent-checkpoint-id')
    ).resolves.toBeUndefined();

    await backend.close();
  });

  it('connect() called twice resolves (idempotent) (AC-44)', async () => {
    // The backend is connected after openBackend(). A second connect() call
    // must resolve without throwing.
    const backend = await openBackend();

    await expect(backend.connect()).resolves.toBeUndefined();

    await backend.close();
  });

  it('close() called twice resolves (idempotent) (AC-45)', async () => {
    const backend = await openBackend();

    await expect(backend.close()).resolves.toBeUndefined();
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it('saveCheckpoint with extensionState: {} persists and loads as {} (AC-46)', async () => {
    const backend = await openBackend();
    const checkpoint = makeCheckpoint({
      extensionState: {},
      variables: { n: 7 },
      variableTypes: { n: 'number' },
      pipeResult: 'result',
    });

    await backend.saveCheckpoint(checkpoint);

    const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

    expect(loaded).not.toBeNull();
    // extensionState must round-trip as an empty object, not null/undefined.
    expect(loaded!.extensionState).toEqual({});
    expect(loaded!.variables).toEqual({ n: 7 });
    expect(loaded!.variableTypes).toEqual({ n: 'number' });
    expect(loaded!.pipeResult).toBe('result');

    await backend.close();
  });
});

// ============================================================
// TTL: AC-24, AC-47
// ============================================================

describe('createRedisBackend — TTL expiry (AC-24, AC-47)', () => {
  it('loadCheckpoint returns null after TTL has elapsed (AC-24, AC-47)', async () => {
    // ioredis-mock uses Date.now() for expiry checks.
    // vi.useFakeTimers() intercepts Date.now() so we can advance time.
    vi.useFakeTimers();

    const backend = createRedisBackend({
      host: 'localhost',
      port: 6379,
      ttl: 1, // 1 second TTL
    });

    // Connect manually (ioredis-mock's connect() is synchronous under the hood).
    await backend.connect();

    // Flush to isolate this test from shared ioredis-mock state.
    const RedisMock = (await import('ioredis-mock')).default;
    const tmp = new RedisMock({ host: 'localhost', port: 6379 }) as {
      flushall(): Promise<'OK'>;
    };
    await tmp.flushall();

    const checkpoint = makeCheckpoint({
      id: 'chk-ttl',
      sessionId: 'sess-ttl',
    });

    await backend.saveCheckpoint(checkpoint);

    // Verify data is visible immediately after save.
    const before = await backend.loadCheckpoint('sess-ttl');
    expect(before).not.toBeNull();

    // Advance time past the TTL (1 second = 1000 ms).
    vi.advanceTimersByTime(2000);

    // After TTL elapsed, loadCheckpoint should return null.
    const after = await backend.loadCheckpoint('sess-ttl');
    expect(after).toBeNull();

    await backend.close();
    vi.useRealTimers();
  });

  it('putSession value is gone after TTL elapses (AC-24)', async () => {
    vi.useFakeTimers();

    const backend = createRedisBackend({
      host: 'localhost',
      port: 6379,
      ttl: 1, // 1 second TTL
    });

    await backend.connect();

    const RedisMock = (await import('ioredis-mock')).default;
    const tmp = new RedisMock({ host: 'localhost', port: 6379 }) as {
      flushall(): Promise<'OK'>;
    };
    await tmp.flushall();

    const session = makeSession({ sessionId: 'sess-ttl-s' });
    await backend.putSession(session.sessionId, session);

    const before = await backend.getSession('sess-ttl-s');
    expect(before).not.toBeNull();

    vi.advanceTimersByTime(2000);

    const after = await backend.getSession('sess-ttl-s');
    expect(after).toBeNull();

    await backend.close();
    vi.useRealTimers();
  });
});

// ============================================================
// AUTO-RECONNECT: AC-25
// ============================================================

describe('createRedisBackend — auto-reconnect (AC-25)', () => {
  it.skip('reconnects automatically after transient connection failure (AC-25)', () => {
    // SKIP REASON: Auto-reconnect requires real network-level fault injection
    // (e.g., firewall rule, TCP RST) that is not reproducible with ioredis-mock
    // or in a single-process Vitest run. Testing this requires a live Redis
    // instance and the ability to interrupt the TCP connection mid-session.
  });
});

// ============================================================
// AUTHENTICATION / NETWORK ERRORS: EC-18, EC-19
// ============================================================

describe('createRedisBackend — environment-dependent errors', () => {
  it.skip('authentication failure propagates as ioredis ReplyError (EC-18)', () => {
    // SKIP REASON: ioredis-mock does not validate passwords. This test requires
    // a live Redis instance configured with requirepass and a wrong password
    // provided. The error type is ioredis ReplyError with message "WRONGPASS".
  });

  it.skip('network timeout propagates as ioredis connection error (EC-19)', () => {
    // SKIP REASON: ioredis-mock does not simulate network latency or timeouts.
    // Testing this requires either a real Redis instance on a rate-limited
    // network path or an OS-level TCP proxy that delays packets beyond the
    // configured connectTimeout.
  });
});
