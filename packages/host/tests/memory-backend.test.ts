/**
 * Tests for createMemoryBackend.
 *
 * Covered:
 *   AC-1   saveCheckpoint persists data and resolves
 *   AC-2   loadCheckpoint returns full CheckpointData for known sessionId
 *   AC-3   loadCheckpoint returns null for unknown sessionId [EC-3]
 *   AC-4   listCheckpoints returns summaries ordered by timestamp descending
 *   AC-5   listCheckpoints returns [] for agent with no checkpoints [EC-5]
 *   AC-6   listCheckpoints with limit: N returns at most N entries
 *   AC-7   deleteCheckpoint removes the checkpoint and resolves
 *   AC-8   getSession returns state for known sessionId, null for unknown [EC-8]
 *   AC-9   putSession persists session state and resolves
 *   AC-10  connect() and close() resolve as no-ops
 *   AC-11  createAgentHost accepts options without stateBackend (memory default)
 *   AC-12  new createMemoryBackend() instance has no prior data
 *   AC-42  listCheckpoints with 0 matching returns []
 *   AC-43  deleteCheckpoint on nonexistent ID resolves [EC-6]
 *   AC-44  connect() called twice resolves
 *   AC-45  close() called twice resolves
 *   AC-46  saveCheckpoint with extensionState: {} persists correctly
 */

import { describe, it, expect } from 'vitest';
import {
  createMemoryBackend,
  createAgentHost,
  type CheckpointData,
  type PersistedSessionState,
} from '../src/index.js';
import { mockComposedAgent } from './helpers/host.js';

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
    extensionState: { some: 'state' },
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
// SAVE + LOAD CHECKPOINT
// ============================================================

describe('createMemoryBackend', () => {
  describe('saveCheckpoint / loadCheckpoint', () => {
    it('persists checkpoint and retrieves it by sessionId (AC-1, AC-2)', async () => {
      const backend = createMemoryBackend();
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
      const backend = createMemoryBackend();

      const loaded = await backend.loadCheckpoint('unknown-session');

      expect(loaded).toBeNull();
    });

    it('persists checkpoint with extensionState: {} correctly (AC-46)', async () => {
      const backend = createMemoryBackend();
      const checkpoint = makeCheckpoint({ extensionState: {} });

      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.extensionState).toEqual({});
    });
  });

  // ============================================================
  // LIST CHECKPOINTS
  // ============================================================

  describe('listCheckpoints', () => {
    it('returns summaries ordered by timestamp descending (AC-4)', async () => {
      const backend = createMemoryBackend();

      const first = makeCheckpoint({
        id: 'chk-A',
        sessionId: 'sess-A',
        timestamp: 100,
      });
      const second = makeCheckpoint({
        id: 'chk-B',
        sessionId: 'sess-B',
        timestamp: 200,
      });
      const third = makeCheckpoint({
        id: 'chk-C',
        sessionId: 'sess-C',
        timestamp: 150,
      });

      await backend.saveCheckpoint(first);
      await backend.saveCheckpoint(second);
      await backend.saveCheckpoint(third);

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe('chk-B'); // timestamp 200
      expect(results[1]!.id).toBe('chk-C'); // timestamp 150
      expect(results[2]!.id).toBe('chk-A'); // timestamp 100
    });

    it('returns [] for an agent with no checkpoints (AC-5, EC-5)', async () => {
      const backend = createMemoryBackend();
      await backend.saveCheckpoint(
        makeCheckpoint({ agentName: 'other-agent' })
      );

      const results = await backend.listCheckpoints('no-match-agent');

      expect(results).toEqual([]);
    });

    it('returns at most N entries when limit is specified (AC-6)', async () => {
      const backend = createMemoryBackend();

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

    it('returns [] when no checkpoints exist at all (AC-42)', async () => {
      const backend = createMemoryBackend();

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // DELETE CHECKPOINT
  // ============================================================

  describe('deleteCheckpoint', () => {
    it('removes the checkpoint so loadCheckpoint returns null (AC-7)', async () => {
      const backend = createMemoryBackend();
      const checkpoint = makeCheckpoint();

      await backend.saveCheckpoint(checkpoint);
      await expect(
        backend.deleteCheckpoint(checkpoint.id)
      ).resolves.toBeUndefined();

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);
      expect(loaded).toBeNull();
    });

    it('resolves without error for a nonexistent ID (AC-43, EC-6)', async () => {
      const backend = createMemoryBackend();

      await expect(
        backend.deleteCheckpoint('no-such-id')
      ).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // GET SESSION / PUT SESSION
  // ============================================================

  describe('getSession / putSession', () => {
    it('returns null for an unknown sessionId (AC-8, EC-8)', async () => {
      const backend = createMemoryBackend();

      const result = await backend.getSession('unknown-session');

      expect(result).toBeNull();
    });

    it('persists session state and retrieves it (AC-8, AC-9)', async () => {
      const backend = createMemoryBackend();
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
  });

  // ============================================================
  // CONNECT / CLOSE
  // ============================================================

  describe('connect() / close()', () => {
    it('connect() resolves as a no-op (AC-10)', async () => {
      const backend = createMemoryBackend();

      await expect(backend.connect()).resolves.toBeUndefined();
    });

    it('close() resolves as a no-op (AC-10)', async () => {
      const backend = createMemoryBackend();

      await expect(backend.close()).resolves.toBeUndefined();
    });

    it('connect() called twice resolves both times (AC-44)', async () => {
      const backend = createMemoryBackend();

      await expect(backend.connect()).resolves.toBeUndefined();
      await expect(backend.connect()).resolves.toBeUndefined();
    });

    it('close() called twice resolves both times (AC-45)', async () => {
      const backend = createMemoryBackend();

      await expect(backend.close()).resolves.toBeUndefined();
      await expect(backend.close()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // DATA ISOLATION (NEW INSTANCE)
  // ============================================================

  describe('data isolation', () => {
    it('new instance has no data from a previous instance (AC-12)', async () => {
      const backendA = createMemoryBackend();
      await backendA.saveCheckpoint(makeCheckpoint());
      await backendA.putSession('sess-001', makeSession());

      // Simulate restart by creating a new instance.
      const backendB = createMemoryBackend();

      const checkpoint = await backendB.loadCheckpoint('sess-001');
      const session = await backendB.getSession('sess-001');
      const list = await backendB.listCheckpoints('test-agent');

      expect(checkpoint).toBeNull();
      expect(session).toBeNull();
      expect(list).toEqual([]);
    });
  });
});

// ============================================================
// DEFAULT BACKEND (createAgentHost without stateBackend)
// ============================================================

describe('createAgentHost default backend', () => {
  it('accepts options without stateBackend and initializes (AC-11)', async () => {
    const agent = await mockComposedAgent();

    // No stateBackend provided — host must default to memory backend internally.
    expect(() => createAgentHost(agent, { logLevel: 'silent' })).not.toThrow();
  });
});
