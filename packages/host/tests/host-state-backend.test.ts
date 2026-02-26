/**
 * Tests for StateBackend lifecycle and session integration.
 *
 * Covered:
 *   AC-27  backend.connect() called before accepting requests in listen()
 *   AC-28  backend.close() called during stop()
 *   AC-29  sessions() reads from configured backend
 *   AC-30  getSession(id) reads from configured backend when not in memory
 *   AC-31  backend-restored sessions appear in session list after host restart
 *   AC-32  abortSession() returns false for backend-restored sessions
 *   AC-41  HTTP 500 when backend throws during GET /sessions or GET /sessions/:id
 *   EC-24  backend read failure during GET /sessions → HTTP 500
 *   EC-25  backend read failure during GET /sessions/:id → HTTP 500
 *   EC-26  session not found in memory or backend → HTTP 404
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createAgentHost } from '../src/index.js';
import type {
  StateBackend,
  PersistedSessionState,
  AgentHost,
} from '../src/index.js';
import type { AgentCard } from '../src/index.js';
import { registerRoutes } from '../src/routes.js';
import type { RouteHost, SseStore } from '../src/routes.js';
import { mockComposedAgent } from './helpers/host.js';
import type { CheckpointData, CheckpointSummary } from '../src/types.js';

// ============================================================
// FIXTURES
// ============================================================

const MOCK_CARD: AgentCard = {
  name: 'test-agent',
  version: '0.0.1',
  capabilities: [],
};

const EMPTY_SSE_STORE: SseStore = {
  eventBuffers: new Map(),
  subscribers: new Map(),
};

// ============================================================
// MOCK BACKEND FACTORY
// ============================================================

interface MockBackendCalls {
  connect: number;
  close: number;
  getSession: string[];
  putSession: string[];
}

type MockBackend = StateBackend & { calls: MockBackendCalls };

function createMockBackend(
  store: Map<string, PersistedSessionState> = new Map(),
  overrides?: Partial<StateBackend>
): MockBackend {
  const calls: MockBackendCalls = {
    connect: 0,
    close: 0,
    getSession: [],
    putSession: [],
  };

  const backend: MockBackend = {
    calls,
    async connect(): Promise<void> {
      calls.connect++;
    },
    async close(): Promise<void> {
      calls.close++;
    },
    async getSession(sessionId: string): Promise<PersistedSessionState | null> {
      calls.getSession.push(sessionId);
      return store.get(sessionId) ?? null;
    },
    async putSession(
      sessionId: string,
      state: PersistedSessionState
    ): Promise<void> {
      calls.putSession.push(sessionId);
      store.set(sessionId, state);
    },
    async saveCheckpoint(_checkpoint: CheckpointData): Promise<void> {},
    async loadCheckpoint(_sessionId: string): Promise<CheckpointData | null> {
      return null;
    },
    async listCheckpoints(
      _agentName: string,
      _options?: { limit?: number }
    ): Promise<CheckpointSummary[]> {
      return [];
    },
    async deleteCheckpoint(_id: string): Promise<void> {},
    ...overrides,
  };

  return backend;
}

// ============================================================
// TEARDOWN REGISTRY
// ============================================================

const hostsToClean: AgentHost[] = [];

afterEach(async () => {
  for (const host of hostsToClean.splice(0)) {
    await host.close().catch(() => undefined);
    if (host.phase === 'ready' || host.phase === 'running') {
      await host.stop().catch(() => undefined);
    }
  }
});

// ============================================================
// StateBackend lifecycle integration
// ============================================================

describe('StateBackend lifecycle integration', () => {
  // ----------------------------------------------------------
  // AC-27: connect() called before accepting requests in listen()
  // ----------------------------------------------------------
  describe('AC-27: connect() called during listen()', () => {
    it('calls backend.connect() when listen() is called (AC-27)', async () => {
      const backend = createMockBackend();
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await host.listen(0);
      await host.close();

      expect(backend.calls.connect).toBe(1);
    });

    it('calls connect() before the server starts accepting requests (AC-27)', async () => {
      const callOrder: string[] = [];
      const backend = createMockBackend(new Map(), {
        connect: async () => {
          callOrder.push('connect');
        },
      });

      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await host.listen(0);
      callOrder.push('server-ready');
      await host.close();

      expect(callOrder[0]).toBe('connect');
      expect(callOrder[1]).toBe('server-ready');
    });

    it('throws AgentHostError when connect() rejects (AC-27)', async () => {
      const backend = createMockBackend(new Map(), {
        connect: async () => {
          throw new Error('refused');
        },
      });

      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await expect(host.listen(0)).rejects.toThrow(
        'state backend connection failed'
      );
    });
  });

  // ----------------------------------------------------------
  // AC-28: close() called during stop()
  // ----------------------------------------------------------
  describe('AC-28: close() called during stop()', () => {
    it('calls backend.close() when stop() is called (AC-28)', async () => {
      const backend = createMockBackend();
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await host.listen(0);
      await host.stop();
      await host.close();

      expect(backend.calls.close).toBe(1);
    });

    it('calls close() after listen() has completed (AC-28)', async () => {
      const callOrder: string[] = [];
      const backend = createMockBackend(new Map(), {
        connect: async () => {
          callOrder.push('connect');
        },
        close: async () => {
          callOrder.push('close');
        },
      });

      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await host.listen(0);
      callOrder.push('server-started');
      await host.stop();
      await host.close();

      expect(callOrder).toContain('connect');
      expect(callOrder).toContain('close');
      // connect must appear before close
      expect(callOrder.indexOf('connect')).toBeLessThan(
        callOrder.indexOf('close')
      );
    });
  });
});

// ============================================================
// StateBackend session integration
// ============================================================

describe('StateBackend session integration', () => {
  // ----------------------------------------------------------
  // AC-29: sessions() reads from configured backend
  // ----------------------------------------------------------
  describe('AC-29: sessions() reads from backend', () => {
    it('returns persisted sessions from backend (AC-29)', async () => {
      const backend = createMockBackend();
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      // Run a session so the host persists it to the backend
      const response = await host.run({});
      expect(response.state).toBe('completed');

      // sessions() should include the persisted session
      const sessions = await host.sessions();
      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(response.sessionId);
    });
  });

  // ----------------------------------------------------------
  // AC-30: getSession(id) reads from backend when not in memory
  // ----------------------------------------------------------
  describe('AC-30: getSession() falls back to backend', () => {
    it('returns session from backend when not in SessionManager memory (AC-30)', async () => {
      const store = new Map<string, PersistedSessionState>();
      const sessionId = 'backend-only-session';
      store.set(sessionId, {
        sessionId,
        agentName: 'test-agent',
        state: 'completed',
        startTime: Date.now() - 1000,
        lastActivity: Date.now(),
        metadata: {},
      });

      const backend = createMockBackend(store);
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      const session = await host.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
      expect(session?.state).toBe('completed');
    });

    it('returns undefined when session is not in memory or backend', async () => {
      const backend = createMockBackend();
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      const session = await host.getSession('no-such-session');

      expect(session).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // AC-31: backend-restored sessions appear in session list
  // ----------------------------------------------------------
  describe('AC-31: restored sessions appear after host restart', () => {
    it('sessions from prior host instance visible via shared backend store (AC-31)', async () => {
      // Shared persistent store simulates a backend surviving host restarts
      const store = new Map<string, PersistedSessionState>();

      // Host A: run a session, which writes to the shared store
      const backendA = createMockBackend(store);
      const agentA = await mockComposedAgent();
      const hostA = createAgentHost(agentA, { stateBackend: backendA });

      const responseA = await hostA.run({});
      expect(responseA.state).toBe('completed');
      await hostA.stop();

      // Verify the session was persisted to the shared store
      expect(store.has(responseA.sessionId)).toBe(true);

      // Host B: shares the same backing store — simulates a restart
      const backendB = createMockBackend(store);
      const agentB = await mockComposedAgent();
      const hostB = createAgentHost(agentB, { stateBackend: backendB });
      hostsToClean.push(hostB);

      // getSession falls back to backend since the session is not in hostB's memory
      const session = await hostB.getSession(responseA.sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe(responseA.sessionId);
      expect(session?.state).toBe('completed');
    });
  });

  // ----------------------------------------------------------
  // AC-32: abortSession() returns false for backend-restored sessions
  // ----------------------------------------------------------
  describe('AC-32: abortSession() false for backend-restored sessions', () => {
    it('returns false for sessions restored from backend (no AbortController in memory) (AC-32)', async () => {
      const store = new Map<string, PersistedSessionState>();

      // Host A: run and persist a session
      const backendA = createMockBackend(store);
      const agentA = await mockComposedAgent();
      const hostA = createAgentHost(agentA, { stateBackend: backendA });

      const responseA = await hostA.run({});
      await hostA.stop();

      // Host B: new instance with same backing store
      const backendB = createMockBackend(store);
      const agentB = await mockComposedAgent();
      const hostB = createAgentHost(agentB, { stateBackend: backendB });
      hostsToClean.push(hostB);

      // Verify session is retrievable from backend
      const session = await hostB.getSession(responseA.sessionId);
      expect(session).toBeDefined();

      // abortSession() returns false — no AbortController in hostB's memory
      const aborted = hostB.abortSession(responseA.sessionId);
      expect(aborted).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // EC-24: backend read failure during sessions() → propagates error
  // ----------------------------------------------------------
  describe('EC-24: backend failure during sessions() propagates error', () => {
    it('sessions() rejects when backend.getSession throws (EC-24)', async () => {
      const backend = createMockBackend(new Map(), {
        getSession: async () => {
          throw new Error('backend down');
        },
      });
      const agent = await mockComposedAgent();
      // sessionTtl: 0 ensures the first session is pruned by the next run()
      const host = createAgentHost(agent, {
        stateBackend: backend,
        sessionTtl: 0,
      });
      hostsToClean.push(host);

      // First run: session is persisted and added to persistedSessionIds
      await host.run({});

      // Second run: prune() removes the expired first session from in-memory
      // manager, making it a backend-only entry in persistedSessionIds
      await host.run({});

      // sessions() now calls backend.getSession for the first session ID,
      // which throws — that error must propagate
      await expect(host.sessions()).rejects.toThrow('backend down');
    });
  });

  // ----------------------------------------------------------
  // EC-25: backend read failure during getSession() → propagates error
  // ----------------------------------------------------------
  describe('EC-25: backend failure during getSession() propagates error', () => {
    it('getSession() rejects when backend.getSession throws (EC-25)', async () => {
      const backend = createMockBackend(new Map(), {
        getSession: async () => {
          throw new Error('backend down');
        },
      });
      const agent = await mockComposedAgent();
      const host = createAgentHost(agent, { stateBackend: backend });
      hostsToClean.push(host);

      await expect(host.getSession('any-session-id')).rejects.toThrow(
        'backend down'
      );
    });
  });

  // ----------------------------------------------------------
  // AC-41 / EC-24: HTTP 500 when backend throws during GET /sessions
  // ----------------------------------------------------------
  describe('AC-41 / EC-24: HTTP 500 from backend failure on GET /sessions', () => {
    it('returns HTTP 500 when sessions() throws (AC-41, EC-24)', async () => {
      const mockHost: RouteHost = {
        phase: 'ready',
        run: async () => ({
          sessionId: '',
          correlationId: '',
          state: 'completed',
        }),
        stop: async () => undefined,
        health: () => ({
          phase: 'ready',
          uptimeSeconds: 0,
          activeSessions: 0,
          extensions: {},
        }),
        metrics: async () => '',
        sessions: async () => {
          throw new Error('backend down');
        },
        getSession: async () => undefined,
        abortSession: () => false,
      };

      const app = new Hono();
      registerRoutes(app, mockHost, MOCK_CARD, EMPTY_SSE_STORE);

      const res = await app.request('/sessions');

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('internal error');
    });
  });

  // ----------------------------------------------------------
  // AC-41 / EC-25: HTTP 500 when backend throws during GET /sessions/:id
  // ----------------------------------------------------------
  describe('AC-41 / EC-25: HTTP 500 from backend failure on GET /sessions/:id', () => {
    it('returns HTTP 500 when getSession() throws (AC-41, EC-25)', async () => {
      const mockHost: RouteHost = {
        phase: 'ready',
        run: async () => ({
          sessionId: '',
          correlationId: '',
          state: 'completed',
        }),
        stop: async () => undefined,
        health: () => ({
          phase: 'ready',
          uptimeSeconds: 0,
          activeSessions: 0,
          extensions: {},
        }),
        metrics: async () => '',
        sessions: async () => [],
        getSession: async () => {
          throw new Error('backend down');
        },
        abortSession: () => false,
      };

      const app = new Hono();
      registerRoutes(app, mockHost, MOCK_CARD, EMPTY_SSE_STORE);

      const res = await app.request('/sessions/any-session-id');

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('internal error');
    });
  });

  // ----------------------------------------------------------
  // EC-26: HTTP 404 when session not found in memory or backend
  // ----------------------------------------------------------
  describe('EC-26: HTTP 404 when session not found', () => {
    it('returns HTTP 404 when getSession() returns undefined (EC-26)', async () => {
      const mockHost: RouteHost = {
        phase: 'ready',
        run: async () => ({
          sessionId: '',
          correlationId: '',
          state: 'completed',
        }),
        stop: async () => undefined,
        health: () => ({
          phase: 'ready',
          uptimeSeconds: 0,
          activeSessions: 0,
          extensions: {},
        }),
        metrics: async () => '',
        sessions: async () => [],
        getSession: async () => undefined,
        abortSession: () => false,
      };

      const app = new Hono();
      registerRoutes(app, mockHost, MOCK_CARD, EMPTY_SSE_STORE);

      const res = await app.request('/sessions/no-such-session');

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('session not found');
    });
  });
});
