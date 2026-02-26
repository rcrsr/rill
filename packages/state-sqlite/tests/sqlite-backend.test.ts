/**
 * Tests for createSqliteBackend — success paths.
 *
 * Covered:
 *   AC-18  connect() creates database file and schema when absent
 *   AC-19  WAL mode enabled on connect
 *   AC-20  Concurrent reads do not block writes
 *   AC-21  Schema migration from version 0 to 1 without data loss
 *   AC-1   saveCheckpoint persists data and resolves
 *   AC-2   loadCheckpoint returns full CheckpointData for known sessionId
 *   AC-3   loadCheckpoint returns null for unknown sessionId
 *   AC-4   listCheckpoints returns summaries ordered by timestamp descending
 *   AC-5   listCheckpoints returns [] for agent with no checkpoints
 *   AC-6   listCheckpoints with limit: N returns at most N entries
 *   AC-7   deleteCheckpoint removes the checkpoint and resolves
 *   AC-8   getSession returns state or null
 *   AC-9   putSession persists state
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteBackend, type SqliteBackendConfig } from '../src/index.js';
import type { CheckpointData, PersistedSessionState } from '@rcrsr/rill-host';

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

let tmpDir: string;
let config: SqliteBackendConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rill-state-sqlite-test-'));
  config = { filePath: join(tmpDir, 'state.db') };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// CONNECT
// ============================================================

describe('createSqliteBackend', () => {
  describe('connect()', () => {
    it('creates database file and schema tables when absent (AC-18)', async () => {
      const backend = createSqliteBackend(config);

      await backend.connect();

      // Database file must exist on disk after connect.
      expect(existsSync(config.filePath)).toBe(true);

      // Both tables must exist in the schema.
      const db = new Database(config.filePath, { readonly: true });
      try {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          )
          .all() as Array<{ name: string }>;
        const names = tables.map((r) => r.name);

        expect(names).toContain('checkpoints');
        expect(names).toContain('sessions');
      } finally {
        db.close();
        await backend.close();
      }
    });

    it('sets user_version to 1 after schema creation (AC-21)', async () => {
      const backend = createSqliteBackend(config);

      await backend.connect();

      const db = new Database(config.filePath, { readonly: true });
      try {
        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(1);
      } finally {
        db.close();
        await backend.close();
      }
    });

    it('enables WAL mode on connect (AC-19)', async () => {
      const backend = createSqliteBackend(config);

      await backend.connect();

      const db = new Database(config.filePath, { readonly: true });
      try {
        const mode = db.pragma('journal_mode', { simple: true }) as string;
        expect(mode).toBe('wal');
      } finally {
        db.close();
        await backend.close();
      }
    });

    it('resolves without error when called twice (idempotent connect)', async () => {
      const backend = createSqliteBackend(config);

      await expect(backend.connect()).resolves.toBeUndefined();
      await expect(backend.connect()).resolves.toBeUndefined();

      await backend.close();
    });

    it('migrates database with user_version 0 to schema version 1 (AC-21)', async () => {
      // Pre-create a database with user_version = 0 (no tables).
      const seed = new Database(config.filePath);
      seed.pragma('user_version = 0');
      seed.close();

      const backend = createSqliteBackend(config);

      await backend.connect();

      const db = new Database(config.filePath, { readonly: true });
      try {
        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(1);

        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          )
          .all() as Array<{ name: string }>;
        const names = tables.map((r) => r.name);
        expect(names).toContain('checkpoints');
        expect(names).toContain('sessions');
      } finally {
        db.close();
        await backend.close();
      }
    });

    it('does not overwrite existing data when re-connecting to a populated db (AC-21)', async () => {
      // First connection creates schema and saves a checkpoint.
      const backendA = createSqliteBackend(config);
      await backendA.connect();
      await backendA.saveCheckpoint(makeCheckpoint({ id: 'chk-persist' }));
      await backendA.close();

      // Second connection (user_version already 1) must not drop tables.
      const backendB = createSqliteBackend(config);
      await backendB.connect();

      const loaded = await backendB.loadCheckpoint('sess-001');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('chk-persist');

      await backendB.close();
    });
  });

  // ============================================================
  // CONCURRENT READS DO NOT BLOCK WRITES
  // ============================================================

  describe('concurrency', () => {
    it('concurrent read and write operations resolve without deadlock (AC-20)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      // Issue a write and multiple reads concurrently.
      const write = backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-concurrent' })
      );
      const read1 = backend.loadCheckpoint('sess-001');
      const read2 = backend.listCheckpoints('test-agent');

      await expect(Promise.all([write, read1, read2])).resolves.toBeDefined();

      await backend.close();
    });
  });

  // ============================================================
  // SAVE + LOAD CHECKPOINT
  // ============================================================

  describe('saveCheckpoint / loadCheckpoint', () => {
    it('persists checkpoint and retrieves it by sessionId (AC-1, AC-2)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
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

      await backend.close();
    });

    it('preserves non-null pipeResult across save and load (AC-1, AC-2)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
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

      await backend.close();
    });

    it('returns null for an unknown sessionId (AC-3)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      const loaded = await backend.loadCheckpoint('unknown-session');

      expect(loaded).toBeNull();

      await backend.close();
    });

    it('overwrites checkpoint when saved with same id (idempotent)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      const first = makeCheckpoint({ timestamp: 100 });
      const second = makeCheckpoint({ timestamp: 200 });

      await backend.saveCheckpoint(first);
      await backend.saveCheckpoint(second);

      const loaded = await backend.loadCheckpoint(first.sessionId);

      expect(loaded!.timestamp).toBe(200);

      await backend.close();
    });
  });

  // ============================================================
  // LIST CHECKPOINTS
  // ============================================================

  describe('listCheckpoints', () => {
    it('returns summaries ordered by timestamp descending (AC-4)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-A', sessionId: 'sess-A', timestamp: 100 })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-B', sessionId: 'sess-B', timestamp: 200 })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-C', sessionId: 'sess-C', timestamp: 150 })
      );

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe('chk-B'); // timestamp 200
      expect(results[1]!.id).toBe('chk-C'); // timestamp 150
      expect(results[2]!.id).toBe('chk-A'); // timestamp 100

      await backend.close();
    });

    it('returns [] for an agent with no checkpoints (AC-5)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      await backend.saveCheckpoint(
        makeCheckpoint({ agentName: 'other-agent' })
      );

      const results = await backend.listCheckpoints('no-match-agent');

      expect(results).toEqual([]);

      await backend.close();
    });

    it('returns at most N entries when limit is specified (AC-6)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

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

      await backend.close();
    });

    it('summaries contain only summary fields, not full checkpoint data', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

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

      await backend.close();
    });

    it('returns [] when no checkpoints exist for any agent', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toEqual([]);

      await backend.close();
    });
  });

  // ============================================================
  // DELETE CHECKPOINT
  // ============================================================

  describe('deleteCheckpoint', () => {
    it('removes the checkpoint so loadCheckpoint returns null (AC-7)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint();

      await backend.saveCheckpoint(checkpoint);
      await expect(
        backend.deleteCheckpoint(checkpoint.id)
      ).resolves.toBeUndefined();

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).toBeNull();

      await backend.close();
    });

    it('removes only the targeted checkpoint, not others', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-keep', sessionId: 'sess-keep' })
      );
      await backend.saveCheckpoint(
        makeCheckpoint({ id: 'chk-delete', sessionId: 'sess-delete' })
      );

      await backend.deleteCheckpoint('chk-delete');

      const kept = await backend.loadCheckpoint('sess-keep');
      const deleted = await backend.loadCheckpoint('sess-delete');

      expect(kept).not.toBeNull();
      expect(deleted).toBeNull();

      await backend.close();
    });
  });

  // ============================================================
  // GET SESSION / PUT SESSION
  // ============================================================

  describe('getSession / putSession', () => {
    it('returns null for an unknown sessionId (AC-8)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      const result = await backend.getSession('unknown-session');

      expect(result).toBeNull();

      await backend.close();
    });

    it('persists session state and retrieves it (AC-8, AC-9)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
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

      await backend.close();
    });

    it('persists session metadata object correctly', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      const session = makeSession({
        metadata: { runCount: 5, label: 'test-run' },
      });

      await backend.putSession(session.sessionId, session);

      const loaded = await backend.getSession(session.sessionId);

      expect(loaded!.metadata).toEqual({ runCount: 5, label: 'test-run' });

      await backend.close();
    });

    it('overwrites session when put with same sessionId (idempotent)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      const first = makeSession({ state: 'running' });
      const second = makeSession({ state: 'completed' });

      await backend.putSession('sess-001', first);
      await backend.putSession('sess-001', second);

      const loaded = await backend.getSession('sess-001');

      expect(loaded!.state).toBe('completed');

      await backend.close();
    });

    it('persists all session state values (AC-9)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      const session = makeSession({
        sessionId: 'sess-full',
        agentName: 'full-agent',
        state: 'paused',
        startTime: 1111,
        lastActivity: 9999,
        metadata: { key: 'value' },
      });

      await backend.putSession(session.sessionId, session);

      const loaded = await backend.getSession('sess-full');

      expect(loaded!.sessionId).toBe('sess-full');
      expect(loaded!.agentName).toBe('full-agent');
      expect(loaded!.state).toBe('paused');
      expect(loaded!.startTime).toBe(1111);
      expect(loaded!.lastActivity).toBe(9999);
      expect(loaded!.metadata).toEqual({ key: 'value' });

      await backend.close();
    });
  });

  // ============================================================
  // CLOSE
  // ============================================================

  describe('close()', () => {
    it('resolves without error', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      await expect(backend.close()).resolves.toBeUndefined();
    });

    it('resolves without error when called before connect', async () => {
      const backend = createSqliteBackend(config);

      await expect(backend.close()).resolves.toBeUndefined();
    });
  });
});
