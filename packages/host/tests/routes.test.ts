/**
 * Integration tests for registerRoutes().
 *
 * Each test creates a Hono app wired to a mock RouteHost,
 * then uses app.request() to exercise the HTTP surface.
 *
 * Covered:
 *   AC-7   GET /healthz → 200 + HealthStatus JSON
 *   AC-8   POST /run → 200 + X-Correlation-ID header
 *   AC-9   GET /sessions/:id/stream emits step/capture/done SSE events
 *   AC-10  GET /.well-known/agent-card.json → 200 + AgentCard
 *   AC-11  POST /stop → 202
 *   AC-18  POST /run at capacity → 429
 *   AC-20  GET /sessions/:id unknown ID → 404
 *   AC-21  POST /sessions/:id/abort on completed session → 409
 *   AC-22  POST /sessions/:id/pause → 501
 *   AC-23  GET /readyz when phase=init → 503
 *   AC-24  GET /healthz during stopped phase → 503
 *   AC-33  SSE late connect receives buffered done event
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AgentCard } from '../src/index.js';
import { registerRoutes } from '../src/routes.js';
import type { RouteHost, SseStore } from '../src/routes.js';
import type {
  LifecyclePhase,
  HealthStatus,
  SessionRecord,
  RunRequest,
  RunResponse,
} from '../src/types.js';

// ============================================================
// TEST FIXTURES
// ============================================================

const CARD: AgentCard = {
  name: 'test-agent',
  version: '1.0.0',
  capabilities: [{ namespace: 'app', functions: ['greet'] }],
};

const HEALTH: HealthStatus = {
  phase: 'ready',
  uptimeSeconds: 42,
  activeSessions: 0,
  extensions: {},
};

const COMPLETED_SESSION: SessionRecord = {
  id: 'sess-completed',
  state: 'completed',
  startTime: Date.now() - 1000,
  durationMs: 800,
  stepCount: 3,
  variables: {},
  trigger: 'http',
  correlationId: 'corr-1',
  value: 'done',
};

const RUNNING_SESSION: SessionRecord = {
  id: 'sess-running',
  state: 'running',
  startTime: Date.now(),
  durationMs: undefined,
  stepCount: 0,
  variables: {},
  trigger: 'http',
  correlationId: 'corr-2',
};

const RUN_RESPONSE: RunResponse = {
  sessionId: 'sess-abc',
  correlationId: 'corr-abc',
  state: 'completed',
  value: 42,
  durationMs: 100,
};

// ============================================================
// MOCK HOST FACTORY
// ============================================================

function makeHost(overrides: Partial<RouteHost> = {}): RouteHost {
  return {
    phase: 'ready' as LifecyclePhase,
    run: async (_input: RunRequest): Promise<RunResponse> => RUN_RESPONSE,
    stop: async (): Promise<void> => undefined,
    health: (): HealthStatus => HEALTH,
    metrics: async (): Promise<string> =>
      '# HELP rill_sessions_total Total sessions\n',
    sessions: (): SessionRecord[] => [],
    abortSession: (_id: string): boolean => true,
    getSession: (_id: string): SessionRecord | undefined => undefined,
    ...overrides,
  };
}

// ============================================================
// APP FACTORY
// ============================================================

// ============================================================
// HELPERS
// ============================================================

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ============================================================
// TESTS
// ============================================================

describe('registerRoutes', () => {
  let sseStore: SseStore;

  beforeEach(() => {
    sseStore = {
      eventBuffers: new Map(),
      subscribers: new Map(),
    };
  });

  function makeApp(host: RouteHost): Hono {
    const app = new Hono();
    registerRoutes(app, host, CARD, sseStore);
    return app;
  }

  // --------------------------------------------------------
  // GET /healthz
  // --------------------------------------------------------
  describe('GET /healthz', () => {
    it('returns 200 with HealthStatus when phase is ready (AC-7)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/healthz');

      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body).toMatchObject({
        phase: 'ready',
        uptimeSeconds: 42,
        activeSessions: 0,
      });
    });

    it('returns 503 when phase is stopped (AC-24)', async () => {
      const host = makeHost({
        phase: 'stopped',
        health: (): HealthStatus => ({ ...HEALTH, phase: 'stopped' }),
      });
      const app = makeApp(host);

      const res = await app.request('/healthz');

      expect(res.status).toBe(503);
      expect(await jsonBody(res)).toMatchObject({
        error: 'service unavailable',
      });
    });
  });

  // --------------------------------------------------------
  // GET /readyz
  // --------------------------------------------------------
  describe('GET /readyz', () => {
    it('returns 200 when phase is ready', async () => {
      const app = makeApp(makeHost({ phase: 'ready' }));

      const res = await app.request('/readyz');

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ ready: true });
    });

    it('returns 503 when phase is init (AC-23)', async () => {
      const app = makeApp(makeHost({ phase: 'init' }));

      const res = await app.request('/readyz');

      expect(res.status).toBe(503);
      expect(await jsonBody(res)).toMatchObject({
        error: 'service unavailable',
      });
    });

    it('returns 503 when phase is stopped', async () => {
      const app = makeApp(makeHost({ phase: 'stopped' }));

      const res = await app.request('/readyz');

      expect(res.status).toBe(503);
    });
  });

  // --------------------------------------------------------
  // POST /run
  // --------------------------------------------------------
  describe('POST /run', () => {
    it('returns 200 with RunResponse and X-Correlation-ID header (AC-8)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'http' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Correlation-ID')).toBeTruthy();
      const body = await jsonBody(res);
      expect(body).toMatchObject({ sessionId: 'sess-abc', state: 'completed' });
    });

    it('propagates X-Correlation-ID from request header', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': 'my-corr-id',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Correlation-ID')).toBe('my-corr-id');
    });

    it('returns 429 when host throws session limit error (AC-18)', async () => {
      const host = makeHost({
        run: async (): Promise<RunResponse> => {
          throw new Error('session limit reached');
        },
      });
      const app = makeApp(host);

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(429);
      expect(await jsonBody(res)).toMatchObject({
        error: 'session limit reached',
      });
    });

    it('returns 400 for invalid JSON body', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      });

      expect(res.status).toBe(400);
      expect(await jsonBody(res)).toMatchObject({ error: 'invalid request' });
    });

    it('returns 400 for invalid trigger value', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'invalid' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-positive timeout', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: -1 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for callback with non-http/https scheme', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback: 'ftp://example.com/cb' }),
      });

      expect(res.status).toBe(400);
    });

    it('accepts valid http callback URL', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback: 'https://example.com/done' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 503 when host phase is init', async () => {
      const app = makeApp(makeHost({ phase: 'init' }));

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(503);
    });

    it('returns 500 for unexpected host error', async () => {
      const host = makeHost({
        run: async (): Promise<RunResponse> => {
          throw new Error('unexpected boom');
        },
      });
      const app = makeApp(host);

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      expect(await jsonBody(res)).toMatchObject({ error: 'internal error' });
    });
  });

  // --------------------------------------------------------
  // POST /stop
  // --------------------------------------------------------
  describe('POST /stop', () => {
    it('returns 202 with shutdown message (AC-11)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/stop', { method: 'POST' });

      expect(res.status).toBe(202);
      expect(await jsonBody(res)).toEqual({ message: 'shutdown initiated' });
    });

    it('returns 503 when not in ready or running phase', async () => {
      const app = makeApp(makeHost({ phase: 'init' }));

      const res = await app.request('/stop', { method: 'POST' });

      expect(res.status).toBe(503);
    });
  });

  // --------------------------------------------------------
  // GET /metrics
  // --------------------------------------------------------
  describe('GET /metrics', () => {
    it('returns 200 with Prometheus content-type', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/metrics');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain(
        'text/plain; version=0.0.4'
      );
    });

    it('returns 500 when metrics() throws', async () => {
      const host = makeHost({
        metrics: async (): Promise<string> => {
          throw new Error('registry failure');
        },
      });
      const app = makeApp(host);

      const res = await app.request('/metrics');

      expect(res.status).toBe(500);
    });
  });

  // --------------------------------------------------------
  // GET /sessions
  // --------------------------------------------------------
  describe('GET /sessions', () => {
    it('returns 200 with session array', async () => {
      const host = makeHost({
        sessions: (): SessionRecord[] => [COMPLETED_SESSION],
      });
      const app = makeApp(host);

      const res = await app.request('/sessions');

      expect(res.status).toBe(200);
      const body = (await jsonBody(res)) as SessionRecord[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0]?.id).toBe('sess-completed');
    });
  });

  // --------------------------------------------------------
  // GET /sessions/:id
  // --------------------------------------------------------
  describe('GET /sessions/:id', () => {
    it('returns 200 with SessionRecord for known ID', async () => {
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === 'sess-completed' ? COMPLETED_SESSION : undefined,
      });
      const app = makeApp(host);

      const res = await app.request('/sessions/sess-completed');

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toMatchObject({ id: 'sess-completed' });
    });

    it('returns 404 for unknown session ID (AC-20)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/sessions/no-such-id');

      expect(res.status).toBe(404);
      expect(await jsonBody(res)).toMatchObject({ error: 'session not found' });
    });
  });

  // --------------------------------------------------------
  // POST /sessions/:id/abort
  // --------------------------------------------------------
  describe('POST /sessions/:id/abort', () => {
    it('returns 200 with failed state for running session', async () => {
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === 'sess-running' ? RUNNING_SESSION : undefined,
        abortSession: (_id: string): boolean => true,
      });
      const app = makeApp(host);

      const res = await app.request('/sessions/sess-running/abort', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body).toMatchObject({
        sessionId: 'sess-running',
        state: 'failed',
      });
    });

    it('returns 409 for completed session (AC-21)', async () => {
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === 'sess-completed' ? COMPLETED_SESSION : undefined,
      });
      const app = makeApp(host);

      const res = await app.request('/sessions/sess-completed/abort', {
        method: 'POST',
      });

      expect(res.status).toBe(409);
      expect(await jsonBody(res)).toMatchObject({
        error: 'session not active',
      });
    });

    it('returns 404 for unknown session ID', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/sessions/no-such/abort', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      expect(await jsonBody(res)).toMatchObject({ error: 'session not found' });
    });

    it('returns 409 when abortSession returns false (race condition)', async () => {
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === 'sess-running' ? RUNNING_SESSION : undefined,
        abortSession: (_id: string): boolean => false,
      });
      const app = makeApp(host);

      const res = await app.request('/sessions/sess-running/abort', {
        method: 'POST',
      });

      expect(res.status).toBe(409);
    });
  });

  // --------------------------------------------------------
  // POST /sessions/:id/pause  (AC-22)
  // --------------------------------------------------------
  describe('POST /sessions/:id/pause', () => {
    it('returns 501 with not implemented error (AC-22)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/sessions/any-id/pause', {
        method: 'POST',
      });

      expect(res.status).toBe(501);
      expect(await jsonBody(res)).toMatchObject({
        error: 'not implemented',
        reason: 'awaiting core stepper serialization',
      });
    });
  });

  // --------------------------------------------------------
  // POST /sessions/:id/resume
  // --------------------------------------------------------
  describe('POST /sessions/:id/resume', () => {
    it('returns 501 with not implemented error', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/sessions/any-id/resume', {
        method: 'POST',
      });

      expect(res.status).toBe(501);
      expect(await jsonBody(res)).toMatchObject({ error: 'not implemented' });
    });
  });

  // --------------------------------------------------------
  // GET /.well-known/agent-card.json
  // --------------------------------------------------------
  describe('GET /.well-known/agent-card.json', () => {
    it('returns 200 with AgentCard (AC-10)', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/.well-known/agent-card.json');

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toMatchObject({
        name: 'test-agent',
        version: '1.0.0',
      });
    });

    it('returns 503 when phase is init', async () => {
      const app = makeApp(makeHost({ phase: 'init' }));

      const res = await app.request('/.well-known/agent-card.json');

      expect(res.status).toBe(503);
    });
  });

  // --------------------------------------------------------
  // GET /sessions/:id/stream  (AC-9, AC-33)
  // --------------------------------------------------------
  describe('GET /sessions/:id/stream', () => {
    it('returns 404 for unknown session ID', async () => {
      const app = makeApp(makeHost());

      const res = await app.request('/sessions/no-such/stream');

      expect(res.status).toBe(404);
    });

    it('replays buffered events for late-connecting client (AC-33)', async () => {
      const sessionId = 'sess-late';
      const session: SessionRecord = {
        ...COMPLETED_SESSION,
        id: sessionId,
      };
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);

      // Pre-populate the buffer as host.ts would do after execution
      sseStore.eventBuffers.set(sessionId, [
        { event: 'step', data: JSON.stringify({ index: 0, value: 'hello' }) },
        {
          event: 'done',
          data: JSON.stringify({ sessionId, state: 'completed' }),
        },
      ]);

      const res = await app.request(`/sessions/${sessionId}/stream`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const text = await res.text();
      expect(text).toContain('event: step');
      expect(text).toContain('event: done');
    });

    it('emits synthetic done event for terminal session with empty buffer (AC-9)', async () => {
      const sessionId = 'sess-terminal';
      const session: SessionRecord = {
        ...COMPLETED_SESSION,
        id: sessionId,
      };
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);

      const res = await app.request(`/sessions/${sessionId}/stream`);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('event: done');
      expect(text).toContain(sessionId);
    });

    it('streams live events via sseSubscribers (AC-9)', async () => {
      const sessionId = 'sess-live';
      const session: SessionRecord = {
        ...RUNNING_SESSION,
        id: sessionId,
      };
      const host = makeHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);

      // Kick off the SSE request (don't await — it hangs until done)
      const resPromise = app.request(`/sessions/${sessionId}/stream`);

      // Wait one tick so the route handler registers the subscriber
      await new Promise((r) => setTimeout(r, 10));

      // Simulate host.ts pushing events
      const subscriber = sseStore.subscribers.get(sessionId);
      expect(subscriber).toBeDefined();

      if (subscriber !== undefined) {
        subscriber({
          event: 'step',
          data: JSON.stringify({ index: 0, value: 1 }),
        });
        subscriber({
          event: 'capture',
          data: JSON.stringify({ name: '$x', value: 1 }),
        });
        subscriber({
          event: 'done',
          data: JSON.stringify({ sessionId, state: 'completed' }),
        });
      }

      const res = await resPromise;

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('event: step');
      expect(text).toContain('event: capture');
      expect(text).toContain('event: done');
    });
  });
});
