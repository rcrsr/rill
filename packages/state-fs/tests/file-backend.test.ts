/**
 * Tests for createFileBackend — success paths.
 *
 * Covered:
 *   AC-1   saveCheckpoint persists data and resolves
 *   AC-2   loadCheckpoint returns full CheckpointData for known sessionId
 *   AC-3   loadCheckpoint returns null for unknown sessionId [EC-3]
 *   AC-4   listCheckpoints returns summaries ordered by timestamp descending
 *   AC-5   listCheckpoints returns [] for agent with no checkpoints [EC-5]
 *   AC-6   listCheckpoints with limit: N returns at most N entries
 *   AC-7   deleteCheckpoint removes the checkpoint and resolves
 *   AC-8   getSession returns state or null
 *   AC-9   putSession persists state
 *   AC-13  connect() creates directory when absent
 *   AC-14  One JSON file per checkpoint named by checkpoint ID
 *   AC-15  One JSON file per session named by session ID
 *   AC-16  Atomic writes via temp-then-rename
 *   AC-17  Write immediately visible to subsequent read in same process
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBackend, type FileBackendConfig } from '../src/index.js';
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
    pipeValue: null,
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
    startTime: Date.now(),
    lastActivity: Date.now(),
    metadata: {},
    ...overrides,
  };
}

// ============================================================
// SETUP
// ============================================================

let tmpDir: string;
let config: FileBackendConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rill-state-fs-test-'));
  config = { dir: tmpDir };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// CONNECT
// ============================================================

describe('createFileBackend', () => {
  describe('connect()', () => {
    it('creates checkpoints and sessions subdirectories when absent (AC-13)', async () => {
      const backend = createFileBackend(config);

      await backend.connect();

      expect(existsSync(join(tmpDir, 'checkpoints'))).toBe(true);
      expect(existsSync(join(tmpDir, 'sessions'))).toBe(true);
    });
  });

  // ============================================================
  // SAVE + LOAD CHECKPOINT
  // ============================================================

  describe('saveCheckpoint / loadCheckpoint', () => {
    it('persists checkpoint and retrieves it by sessionId (AC-1, AC-2)', async () => {
      const backend = createFileBackend(config);
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
      expect(loaded!.pipeValue).toBe(checkpoint.pipeValue);
      expect(loaded!.variables).toEqual(checkpoint.variables);
      expect(loaded!.variableTypes).toEqual(checkpoint.variableTypes);
      expect(loaded!.extensionState).toEqual(checkpoint.extensionState);
    });

    it('returns null for an unknown sessionId (AC-3, EC-3)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      const loaded = await backend.loadCheckpoint('unknown-session');

      expect(loaded).toBeNull();
    });

    it('overwrites checkpoint when saved with same id (idempotent)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const first = makeCheckpoint({ timestamp: 100 });
      const second = makeCheckpoint({ timestamp: 200 });

      await backend.saveCheckpoint(first);
      await backend.saveCheckpoint(second);

      const loaded = await backend.loadCheckpoint(first.sessionId);
      expect(loaded!.timestamp).toBe(200);
    });

    it('stores one JSON file per checkpoint named by ID (AC-14)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint({ id: 'chk-abc' });

      await backend.saveCheckpoint(checkpoint);

      expect(existsSync(join(tmpDir, 'checkpoints', 'chk-abc.json'))).toBe(
        true
      );
    });

    it('final file exists after atomic write (AC-16)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint({ id: 'chk-atomic' });

      await backend.saveCheckpoint(checkpoint);

      expect(existsSync(join(tmpDir, 'checkpoints', 'chk-atomic.json'))).toBe(
        true
      );
    });

    it('write is immediately visible to subsequent read in same process (AC-17)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint();

      await backend.saveCheckpoint(checkpoint);
      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).not.toBeNull();
    });
  });

  // ============================================================
  // LIST CHECKPOINTS
  // ============================================================

  describe('listCheckpoints', () => {
    it('returns summaries ordered by timestamp descending (AC-4)', async () => {
      const backend = createFileBackend(config);
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
      expect(results[0]!.id).toBe('chk-B');
      expect(results[1]!.id).toBe('chk-C');
      expect(results[2]!.id).toBe('chk-A');
    });

    it('returns [] for an agent with no checkpoints (AC-5, EC-5)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      await backend.saveCheckpoint(
        makeCheckpoint({ agentName: 'other-agent' })
      );

      const results = await backend.listCheckpoints('no-match-agent');

      expect(results).toEqual([]);
    });

    it('returns at most N entries when limit is specified (AC-6)', async () => {
      const backend = createFileBackend(config);
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

      const results = await backend.listCheckpoints('test-agent', { limit: 3 });

      expect(results).toHaveLength(3);
    });

    it('summaries contain only summary fields (not full checkpoint data)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      await backend.saveCheckpoint(makeCheckpoint());

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toHaveLength(1);
      const summary = results[0]!;
      expect(summary).toHaveProperty('id');
      expect(summary).toHaveProperty('sessionId');
      expect(summary).toHaveProperty('agentName');
      expect(summary).toHaveProperty('timestamp');
      expect(summary).toHaveProperty('stepIndex');
      expect(summary).toHaveProperty('totalSteps');
      expect(summary).not.toHaveProperty('pipeValue');
      expect(summary).not.toHaveProperty('variables');
    });
  });

  // ============================================================
  // DELETE CHECKPOINT
  // ============================================================

  describe('deleteCheckpoint', () => {
    it('removes the checkpoint so loadCheckpoint returns null (AC-7)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint();

      await backend.saveCheckpoint(checkpoint);
      await expect(
        backend.deleteCheckpoint(checkpoint.id)
      ).resolves.toBeUndefined();

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);
      expect(loaded).toBeNull();
    });

    it('removes the file from disk after delete', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint({ id: 'chk-del' });

      await backend.saveCheckpoint(checkpoint);
      await backend.deleteCheckpoint(checkpoint.id);

      expect(existsSync(join(tmpDir, 'checkpoints', 'chk-del.json'))).toBe(
        false
      );
    });
  });

  // ============================================================
  // GET SESSION / PUT SESSION
  // ============================================================

  describe('getSession / putSession', () => {
    it('returns null for an unknown sessionId (AC-8)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      const result = await backend.getSession('unknown-session');

      expect(result).toBeNull();
    });

    it('persists session state and retrieves it (AC-8, AC-9)', async () => {
      const backend = createFileBackend(config);
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
    });

    it('overwrites session when put with same sessionId (idempotent)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const first = makeSession({ state: 'running' });
      const second = makeSession({ state: 'completed' });

      await backend.putSession('sess-001', first);
      await backend.putSession('sess-001', second);

      const loaded = await backend.getSession('sess-001');
      expect(loaded!.state).toBe('completed');
    });

    it('stores one JSON file per session named by sessionId (AC-15)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const session = makeSession({ sessionId: 'sess-file-check' });

      await backend.putSession(session.sessionId, session);

      expect(existsSync(join(tmpDir, 'sessions', 'sess-file-check.json'))).toBe(
        true
      );
    });
  });
});
