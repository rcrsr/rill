/**
 * Tests for createRedisBackend — success and standard operation paths.
 *
 * Uses ioredis-mock to provide an in-memory Redis substitute.
 * ioredis-mock shares state across instances with the same host:port,
 * so each test flushes all keys via flushall() in afterEach.
 *
 * Covered:
 *   AC-22  Connects via connection string or host/port/password
 *   AC-23  keyPrefix prepends to all Redis keys
 *   AC-26  Atomic writes (no partial checkpoint observable)
 *   AC-1   saveCheckpoint persists data and resolves
 *   AC-2   loadCheckpoint returns full CheckpointData for known sessionId
 *   AC-3   loadCheckpoint returns null for unknown sessionId
 *   AC-4   listCheckpoints returns summaries ordered by timestamp descending
 *   AC-5   listCheckpoints returns [] for agent with no checkpoints
 *   AC-6   listCheckpoints with limit: N returns at most N entries
 *   AC-7   deleteCheckpoint removes checkpoint and resolves
 *   AC-8   getSession returns state or null
 *   AC-9   putSession persists state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CheckpointData, PersistedSessionState } from '@rcrsr/rill-host';

// Hoist: must appear before any imports that use 'ioredis'.
vi.mock('ioredis', async () => {
  // ioredis-mock is a CJS default export; wrap as named { Redis } to match
  // the implementation's `import { Redis } from 'ioredis'` pattern.
  const RedisMock = (await import('ioredis-mock')).default;
  return { Redis: RedisMock };
});

// Import implementation AFTER vi.mock so the mock is active.
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
// SETUP
// ============================================================

// A single backend instance reused across tests; flushed in afterEach.
let backend: ReturnType<typeof createRedisBackend>;

// ioredis-mock shares state across instances with the same host:port.
// A bare RedisMock instance (lazyConnect defaults to false) auto-connects
// on construction — no explicit connect() call needed for flushall.
let rawRedis: { flushall(): Promise<'OK'> };

beforeEach(async () => {
  // Flush before each test to isolate shared ioredis-mock state.
  const RedisMock = (await import('ioredis-mock')).default;
  rawRedis = new RedisMock({ host: 'localhost', port: 6379 }) as {
    flushall(): Promise<'OK'>;
  };
  await rawRedis.flushall();

  backend = createRedisBackend({ host: 'localhost', port: 6379 });
  await backend.connect();
});

afterEach(async () => {
  await backend.close();
  await rawRedis.flushall();
});

// ============================================================
// CONNECT: AC-22
// ============================================================

describe('createRedisBackend', () => {
  describe('connect() — AC-22', () => {
    it('connects using host/port/password config without error', async () => {
      // The beforeEach uses host/port config; this test verifies it resolved.
      // If connect() rejects, beforeEach throws and the test fails.
      // We just verify the backend is usable after connect.
      await expect(
        backend.saveCheckpoint(makeCheckpoint())
      ).resolves.toBeUndefined();
    });

    it('connects using a connection URL string', async () => {
      const urlBackend = createRedisBackend({ url: 'redis://localhost:6379' });
      await expect(urlBackend.connect()).resolves.toBeUndefined();
      await urlBackend.close();
    });

    it('connect() is idempotent — second call resolves without error (AC-44)', async () => {
      // backend is already connected from beforeEach; second call must no-op.
      await expect(backend.connect()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // SAVE + LOAD CHECKPOINT: AC-1, AC-2, AC-3
  // ============================================================

  describe('saveCheckpoint / loadCheckpoint', () => {
    it('persists checkpoint and retrieves it by sessionId (AC-1, AC-2)', async () => {
      const checkpoint = makeCheckpoint();

      await expect(backend.saveCheckpoint(checkpoint)).resolves.toBeUndefined();

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(checkpoint.id);
      expect(loaded!.sessionId).toBe(checkpoint.sessionId);
      expect(loaded!.agentName).toBe(checkpoint.agentName);
      expect(loaded!.timestamp).toBe(checkpoint.timestamp);
      expect(loaded!.stepIndex).toBe(checkpoint.stepIndex);
      expect(loaded!.totalSteps).toBe(checkpoint.totalSteps);
      expect(loaded!.pipeResult).toBe(checkpoint.pipeResult);
      expect(loaded!.variables).toEqual(checkpoint.variables);
      expect(loaded!.variableTypes).toEqual(checkpoint.variableTypes);
      expect(loaded!.extensionState).toEqual(checkpoint.extensionState);
    });

    it('preserves non-null pipeResult and nested data (AC-1, AC-2)', async () => {
      const checkpoint = makeCheckpoint({
        pipeResult: 'hello',
        variables: { x: 42 },
        variableTypes: { x: 'number' },
        extensionState: { kv: { count: 3 } },
      });

      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded!.pipeResult).toBe('hello');
      expect(loaded!.variables).toEqual({ x: 42 });
      expect(loaded!.variableTypes).toEqual({ x: 'number' });
      expect(loaded!.extensionState).toEqual({ kv: { count: 3 } });
    });

    it('returns null for an unknown sessionId (AC-3)', async () => {
      const loaded = await backend.loadCheckpoint('no-such-session');

      expect(loaded).toBeNull();
    });

    it('overwrites checkpoint when saved with same id', async () => {
      await backend.saveCheckpoint(makeCheckpoint({ timestamp: 100 }));
      await backend.saveCheckpoint(makeCheckpoint({ timestamp: 200 }));

      const loaded = await backend.loadCheckpoint('sess-001');

      expect(loaded!.timestamp).toBe(200);
    });
  });

  // ============================================================
  // LIST CHECKPOINTS: AC-4, AC-5, AC-6
  // ============================================================

  describe('listCheckpoints', () => {
    it('returns summaries ordered by timestamp descending (AC-4)', async () => {
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-A', sessionId: 'sess-A', timestamp: 100 })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-B', sessionId: 'sess-B', timestamp: 300 })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-C', sessionId: 'sess-C', timestamp: 200 })
      );

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe('chk-B'); // timestamp 300
      expect(results[1]!.id).toBe('chk-C'); // timestamp 200
      expect(results[2]!.id).toBe('chk-A'); // timestamp 100
    });

    it('returns [] for an agent with no checkpoints (AC-5, AC-42)', async () => {
      // Save a checkpoint for a different agent to confirm isolation.
      await backend.saveCheckpoint(
        makeCheckpoint({ agentName: 'other-agent' })
      );

      const results = await backend.listCheckpoints('no-match-agent');

      expect(results).toEqual([]);
    });

    it('returns [] when no checkpoints exist at all (AC-5)', async () => {
      const results = await backend.listCheckpoints('test-agent');

      expect(results).toEqual([]);
    });

    it('returns at most N entries when limit is specified (AC-6)', async () => {
      for (let i = 0; i < 5; i++) {
        await backend.saveCheckpoint(
          makeCheckpoint({
            id: `chk-${i}`,
            sessionId: `sess-${i}`,
            timestamp: i * 10,
          })
        );
      }

      const results = await backend.listCheckpoints('test-agent', { limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('summaries contain only summary fields, not full checkpoint payload', async () => {
      await backend.saveCheckpoint(makeCheckpoint());

      const results = await backend.listCheckpoints('test-agent');
      const summary = results[0]!;

      expect(summary).toHaveProperty('id');
      expect(summary).toHaveProperty('sessionId');
      expect(summary).toHaveProperty('agentName');
      expect(summary).toHaveProperty('timestamp');
      expect(summary).toHaveProperty('stepIndex');
      expect(summary).toHaveProperty('totalSteps');
      expect(summary).not.toHaveProperty('pipeResult');
      expect(summary).not.toHaveProperty('variables');
    });
  });

  // ============================================================
  // DELETE CHECKPOINT: AC-7
  // ============================================================

  describe('deleteCheckpoint', () => {
    it('removes the checkpoint so loadCheckpoint returns null (AC-7)', async () => {
      const checkpoint = makeCheckpoint();

      await backend.saveCheckpoint(checkpoint);
      await expect(
        backend.deleteCheckpoint(checkpoint.id)
      ).resolves.toBeUndefined();

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).toBeNull();
    });

    it('removes the checkpoint from listCheckpoints after deletion (AC-7)', async () => {
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-keep', sessionId: 'sess-keep' })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-del', sessionId: 'sess-del' })
      );

      await backend.deleteCheckpoint('chk-del');

      const results = await backend.listCheckpoints('test-agent');

      expect(results.map((r) => r.id)).not.toContain('chk-del');
      expect(results.map((r) => r.id)).toContain('chk-keep');
    });

    it('resolves without error on nonexistent ID (AC-43)', async () => {
      await expect(
        backend.deleteCheckpoint('does-not-exist')
      ).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // GET SESSION / PUT SESSION: AC-8, AC-9
  // ============================================================

  describe('getSession / putSession', () => {
    it('returns null for an unknown sessionId (AC-8)', async () => {
      const result = await backend.getSession('unknown-session');

      expect(result).toBeNull();
    });

    it('persists session state and retrieves it (AC-8, AC-9)', async () => {
      const session = makeSession({
        sessionId: 'sess-xyz',
        agentName: 'my-agent',
      });

      await expect(
        backend.putSession(session.sessionId, session)
      ).resolves.toBeUndefined();

      const loaded = await backend.getSession(session.sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.agentName).toBe(session.agentName);
      expect(loaded!.state).toBe(session.state);
      expect(loaded!.startTime).toBe(session.startTime);
      expect(loaded!.lastActivity).toBe(session.lastActivity);
      expect(loaded!.metadata).toEqual(session.metadata);
    });

    it('persists all session fields correctly (AC-9)', async () => {
      const session = makeSession({
        sessionId: 'sess-full',
        agentName: 'full-agent',
        state: 'paused',
        startTime: 1111,
        lastActivity: 9999,
        metadata: { key: 'value', count: 42 },
      });

      await backend.putSession(session.sessionId, session);

      const loaded = await backend.getSession('sess-full');

      expect(loaded!.sessionId).toBe('sess-full');
      expect(loaded!.agentName).toBe('full-agent');
      expect(loaded!.state).toBe('paused');
      expect(loaded!.startTime).toBe(1111);
      expect(loaded!.lastActivity).toBe(9999);
      expect(loaded!.metadata).toEqual({ key: 'value', count: 42 });
    });

    it('overwrites session when put with same sessionId', async () => {
      await backend.putSession('sess-001', makeSession({ state: 'running' }));
      await backend.putSession('sess-001', makeSession({ state: 'completed' }));

      const loaded = await backend.getSession('sess-001');

      expect(loaded!.state).toBe('completed');
    });
  });

  // ============================================================
  // KEY PREFIX: AC-23
  // ============================================================

  describe('keyPrefix — AC-23', () => {
    it('checkpoint saved with prefix is isolated from unprefixed backend', async () => {
      const prefixedBackend = createRedisBackend({
        host: 'localhost',
        port: 6379,
        keyPrefix: 'myapp:',
      });
      await prefixedBackend.connect();

      // Save checkpoint in unprefixed backend (the main `backend`).
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-nopfx', sessionId: 'sess-nopfx' })
      );

      // Prefixed backend must not see unprefixed checkpoint.
      const loaded = await prefixedBackend.loadCheckpoint('sess-nopfx');

      expect(loaded).toBeNull();

      await prefixedBackend.close();
    });

    it('two backends with different prefixes store checkpoints independently', async () => {
      const backendA = createRedisBackend({
        host: 'localhost',
        port: 6379,
        keyPrefix: 'ns-a:',
      });
      const backendB = createRedisBackend({
        host: 'localhost',
        port: 6379,
        keyPrefix: 'ns-b:',
      });

      await backendA.connect();
      await backendB.connect();

      await backendA.saveCheckpoint(
        makeCheckpoint({ id: 'chk-a', sessionId: 'sess-a' })
      );
      await backendB.saveCheckpoint(
        makeCheckpoint({ id: 'chk-b', sessionId: 'sess-b' })
      );

      // Each backend only sees its own checkpoint.
      expect(await backendA.loadCheckpoint('sess-b')).toBeNull();
      expect(await backendB.loadCheckpoint('sess-a')).toBeNull();

      // Each backend sees its own checkpoint.
      expect(await backendA.loadCheckpoint('sess-a')).not.toBeNull();
      expect(await backendB.loadCheckpoint('sess-b')).not.toBeNull();

      await backendA.close();
      await backendB.close();
    });
  });

  // ============================================================
  // ATOMIC WRITES: AC-26
  // ============================================================

  describe('saveCheckpoint atomicity — AC-26', () => {
    it('checkpoint data and session index are both written before resolving', async () => {
      const checkpoint = makeCheckpoint({
        id: 'chk-atomic',
        sessionId: 'sess-atomic',
      });

      // After save resolves, both the checkpoint and its session-to-id index
      // must be readable. No partial state must be observable.
      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint('sess-atomic');

      // If session index was missing, loadCheckpoint returns null.
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('chk-atomic');
    });

    it('checkpoint appears in listCheckpoints immediately after save', async () => {
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-list-test', sessionId: 'sess-list' })
      );

      const results = await backend.listCheckpoints('test-agent');

      expect(results.map((r) => r.id)).toContain('chk-list-test');
    });
  });

  // ============================================================
  // CLOSE: AC-45
  // ============================================================

  describe('close()', () => {
    it('resolves without error (AC-45)', async () => {
      await expect(backend.close()).resolves.toBeUndefined();
    });

    it('close() called twice resolves without error (AC-45)', async () => {
      await expect(backend.close()).resolves.toBeUndefined();
      await expect(backend.close()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // BOUNDARY: AC-46
  // ============================================================

  describe('boundary conditions', () => {
    it('saveCheckpoint with extensionState: {} persists and loads as {} (AC-46)', async () => {
      const checkpoint = makeCheckpoint({
        extensionState: {},
        variables: { n: 7 },
        variableTypes: { n: 'number' },
        pipeResult: 'result',
      });

      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.extensionState).toEqual({});
      expect(loaded!.variables).toEqual({ n: 7 });
      expect(loaded!.variableTypes).toEqual({ n: 'number' });
      expect(loaded!.pipeResult).toBe('result');
    });
  });
});
