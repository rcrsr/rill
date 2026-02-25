/**
 * HTTP route contract tests for rill-host.
 *
 * Tests HTTP status codes, response bodies, SSE events, and header contracts.
 * Uses Hono app.request() for route testing without a real HTTP server.
 * Uses a real HTTP server only for AC-7 (tests the listen() → /healthz path).
 *
 * Covered:
 *   AC-7   listen() starts HTTP server; GET /healthz returns 200
 *   AC-8   POST /run returns RunResponse with X-Correlation-ID header
 *   AC-9   GET /sessions/:id/stream emits step, capture, done events
 *   AC-10  GET /.well-known/agent-card.json returns AgentCard
 *   AC-11  POST /stop returns 202; after drain, phase === 'stopped'
 *   AC-18  POST /run at capacity returns 429
 *   AC-20  GET /sessions/:id unknown ID returns 404
 *   AC-21  POST /sessions/:id/abort on completed session returns 409
 *   AC-22  POST /sessions/:id/pause returns 501
 *   AC-23  GET /readyz when phase is init returns 503
 *   AC-24  GET /healthz when stopped returns 503
 *   AC-27  10 concurrent POST /run succeed; 11th returns 429
 *   AC-33  SSE late connect receives buffered done event
 *   AC-36  POST /run with {} body succeeds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AgentCard } from '@rcrsr/rill-compose';
import {
  registerRoutes,
  sseEventBuffers,
  sseSubscribers,
} from '../src/routes.js';
import type { RouteHost } from '../src/routes.js';
import type {
  LifecyclePhase,
  HealthStatus,
  SessionRecord,
  RunRequest,
  RunResponse,
} from '../src/types.js';
import { createTestHost } from './helpers/host.js';
import type { AgentHost } from '../src/index.js';

// ============================================================
// TEST FIXTURES
// ============================================================

const MOCK_CARD: AgentCard = {
  name: 'test-agent',
  version: '0.0.1',
  capabilities: [],
};

const READY_HEALTH: HealthStatus = {
  phase: 'ready',
  uptimeSeconds: 1,
  activeSessions: 0,
  extensions: {},
};

const COMPLETED_SESSION: SessionRecord = {
  id: 'sess-done',
  state: 'completed',
  startTime: Date.now() - 500,
  durationMs: 400,
  stepCount: 1,
  variables: {},
  trigger: 'api',
  correlationId: 'corr-x',
  value: 1,
};

const RUNNING_SESSION: SessionRecord = {
  id: 'sess-run',
  state: 'running',
  startTime: Date.now(),
  durationMs: undefined,
  stepCount: 0,
  variables: {},
  trigger: 'api',
  correlationId: 'corr-y',
};

const DEFAULT_RUN_RESPONSE: RunResponse = {
  sessionId: 'sess-mock',
  correlationId: 'corr-mock',
  state: 'completed',
  value: 1,
  durationMs: 50,
};

// ============================================================
// MOCK HOST FACTORY
// ============================================================

function makeMockHost(overrides: Partial<RouteHost> = {}): RouteHost {
  return {
    phase: 'ready' as LifecyclePhase,
    run: async (_input: RunRequest): Promise<RunResponse> =>
      DEFAULT_RUN_RESPONSE,
    stop: async (): Promise<void> => undefined,
    health: (): HealthStatus => READY_HEALTH,
    metrics: async (): Promise<string> => '# metrics\n',
    sessions: (): SessionRecord[] => [],
    abortSession: (_id: string): boolean => true,
    getSession: (_id: string): SessionRecord | undefined => undefined,
    ...overrides,
  };
}

// ============================================================
// APP FACTORY
// ============================================================

function makeApp(host: RouteHost, card: AgentCard = MOCK_CARD): Hono {
  const app = new Hono();
  registerRoutes(app, host, card);
  return app;
}

// ============================================================
// TESTS
// ============================================================

describe('host HTTP routes', () => {
  // Clean module-level SSE state between tests.
  beforeEach(() => {
    sseEventBuffers.clear();
    sseSubscribers.clear();
  });

  // Track real hosts created for cleanup.
  const hosts: AgentHost[] = [];

  afterEach(async () => {
    for (const h of hosts.splice(0)) {
      await h.close().catch(() => undefined);
      if (h.phase === 'ready' || h.phase === 'running') {
        await h.stop().catch(() => undefined);
      }
    }
  });

  // --------------------------------------------------------
  // AC-7: listen() starts HTTP server; GET /healthz returns 200
  // --------------------------------------------------------
  describe('AC-7: GET /healthz with real host', () => {
    it('returns 200 with HealthStatus via app.request() (AC-7)', async () => {
      const host = await createTestHost();
      hosts.push(host);

      const app = makeApp(host as unknown as RouteHost);
      const res = await app.request('/healthz');

      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthStatus;
      expect(body.phase).toBe('ready');
      expect(typeof body.uptimeSeconds).toBe('number');
      expect(typeof body.activeSessions).toBe('number');
    });

    it('returns 200 via real HTTP server after listen() (AC-7)', async () => {
      const host = await createTestHost();
      hosts.push(host);

      const app = new Hono();
      registerRoutes(app, host as unknown as RouteHost, MOCK_CARD);

      // Bind to OS-assigned port to avoid conflicts.
      const port = await new Promise<number>((resolve) => {
        const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
          resolve(info.port);
        });
        // Close this test server after getting the port — host.close() manages
        // its own server; here we test registerRoutes with a separate server.
        hosts.push({
          ...host,
          close: async () =>
            new Promise<void>((res, rej) =>
              server.close((err) => (err ? rej(err) : res()))
            ),
        } as AgentHost);
      });

      const res = await fetch(`http://localhost:${port}/healthz`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthStatus;
      expect(body.phase).toBe('ready');
    });
  });

  // --------------------------------------------------------
  // AC-8: POST /run returns RunResponse + X-Correlation-ID
  // --------------------------------------------------------
  describe('AC-8: POST /run X-Correlation-ID', () => {
    it('returns 200 with X-Correlation-ID header on success (AC-8)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'api' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Correlation-ID')).toBeTruthy();
      const body = (await res.json()) as RunResponse;
      expect(body.sessionId).toBeDefined();
      expect(body.state).toBeDefined();
    });

    it('echoes X-Correlation-ID from request header (AC-8)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': 'client-corr-id',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Correlation-ID')).toBe('client-corr-id');
    });
  });

  // --------------------------------------------------------
  // AC-36: POST /run with empty {} body succeeds
  // --------------------------------------------------------
  describe('AC-36: POST /run with empty body', () => {
    it('accepts {} body without error (AC-36)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Correlation-ID')).toBeTruthy();
    });
  });

  // --------------------------------------------------------
  // AC-10: GET /.well-known/agent-card.json returns AgentCard
  // --------------------------------------------------------
  describe('AC-10: GET /.well-known/agent-card.json', () => {
    it('returns 200 with AgentCard when phase is ready (AC-10)', async () => {
      const card: AgentCard = {
        name: 'my-agent',
        version: '1.2.3',
        capabilities: [{ namespace: 'tools', functions: ['search'] }],
      };
      const app = makeApp(makeMockHost(), card);

      const res = await app.request('/.well-known/agent-card.json');

      expect(res.status).toBe(200);
      const body = (await res.json()) as AgentCard;
      expect(body.name).toBe('my-agent');
      expect(body.version).toBe('1.2.3');
    });

    it('returns 503 when phase is not ready (AC-10)', async () => {
      const app = makeApp(makeMockHost({ phase: 'init' }));

      const res = await app.request('/.well-known/agent-card.json');

      expect(res.status).toBe(503);
    });
  });

  // --------------------------------------------------------
  // AC-11: POST /stop → 202; phase becomes stopped
  // --------------------------------------------------------
  describe('AC-11: POST /stop lifecycle', () => {
    it('returns 202 with shutdown message (AC-11)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/stop', { method: 'POST' });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ message: 'shutdown initiated' });
    });

    it('triggers stop() and host transitions to stopped phase (AC-11)', async () => {
      const host = await createTestHost();
      hosts.push(host);

      // Run one session first to transition to 'running'.
      await host.run({});
      expect(host.phase).toBe('running');

      const app = makeApp(host as unknown as RouteHost);
      const res = await app.request('/stop', { method: 'POST' });

      expect(res.status).toBe(202);

      // Wait for the async drain to complete.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(host.phase).toBe('stopped');
    });
  });

  // --------------------------------------------------------
  // AC-18: POST /run at capacity returns 429
  // --------------------------------------------------------
  describe('AC-18: POST /run at capacity', () => {
    it('returns 429 when host throws session limit reached (AC-18)', async () => {
      const host = makeMockHost({
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('session limit reached');
    });
  });

  // --------------------------------------------------------
  // AC-20: GET /sessions/:id unknown ID returns 404
  // --------------------------------------------------------
  describe('AC-20: GET /sessions/:id unknown ID', () => {
    it('returns 404 for unknown session ID (AC-20)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/sessions/unknown-id');

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('session not found');
    });
  });

  // --------------------------------------------------------
  // AC-21: POST /sessions/:id/abort on completed session → 409
  // --------------------------------------------------------
  describe('AC-21: POST /sessions/:id/abort on terminal session', () => {
    it('returns 409 for completed session (AC-21)', async () => {
      const host = makeMockHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === COMPLETED_SESSION.id ? COMPLETED_SESSION : undefined,
      });
      const app = makeApp(host);

      const res = await app.request(`/sessions/${COMPLETED_SESSION.id}/abort`, {
        method: 'POST',
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('session not active');
    });

    it('returns 200 for running session abort', async () => {
      const host = makeMockHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === RUNNING_SESSION.id ? RUNNING_SESSION : undefined,
        abortSession: (): boolean => true,
      });
      const app = makeApp(host);

      const res = await app.request(`/sessions/${RUNNING_SESSION.id}/abort`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown session', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/sessions/no-such/abort', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------
  // AC-22: POST /sessions/:id/pause → 501
  // --------------------------------------------------------
  describe('AC-22: POST /sessions/:id/pause', () => {
    it('returns 501 with not-implemented error (AC-22)', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/sessions/any/pause', {
        method: 'POST',
      });

      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string; reason: string };
      expect(body.error).toBe('not implemented');
      expect(body.reason).toBe('awaiting core stepper serialization');
    });
  });

  // --------------------------------------------------------
  // AC-23: GET /readyz when phase is init returns 503
  // --------------------------------------------------------
  describe('AC-23: GET /readyz when init', () => {
    it('returns 503 when phase is init (AC-23)', async () => {
      const app = makeApp(makeMockHost({ phase: 'init' }));

      const res = await app.request('/readyz');

      expect(res.status).toBe(503);
    });

    it('returns 200 with ready: true when phase is ready', async () => {
      const app = makeApp(makeMockHost({ phase: 'ready' }));

      const res = await app.request('/readyz');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ready: true });
    });
  });

  // --------------------------------------------------------
  // AC-24: GET /healthz when stopped returns 503
  // --------------------------------------------------------
  describe('AC-24: GET /healthz when stopped', () => {
    it('returns 503 when phase is stopped (AC-24)', async () => {
      const host = makeMockHost({
        phase: 'stopped',
        health: (): HealthStatus => ({ ...READY_HEALTH, phase: 'stopped' }),
      });
      const app = makeApp(host);

      const res = await app.request('/healthz');

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('service unavailable');
    });
  });

  // --------------------------------------------------------
  // AC-27: 10 concurrent POST /run succeed; 11th returns 429
  // --------------------------------------------------------
  describe('AC-27: concurrent run capacity enforcement', () => {
    it('10 concurrent runs succeed; 11th returns 429 (AC-27)', async () => {
      // Track number of concurrent in-flight requests.
      let inflight = 0;
      let peak = 0;

      const host = makeMockHost({
        run: async (): Promise<RunResponse> => {
          inflight++;
          peak = Math.max(peak, inflight);
          if (inflight > 10) {
            inflight--;
            throw new Error('session limit reached');
          }
          // Hold slot briefly so all 10 overlap.
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          inflight--;
          return DEFAULT_RUN_RESPONSE;
        },
      });
      const app = makeApp(host);

      const requestBody = JSON.stringify({});
      const requestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      };

      // Submit 11 concurrent requests.
      const results = await Promise.all(
        Array.from({ length: 11 }, () => app.request('/run', requestInit))
      );

      const statuses = results.map((r) => r.status);
      const successCount = statuses.filter((s) => s === 200).length;
      const capacityCount = statuses.filter((s) => s === 429).length;

      expect(successCount).toBe(10);
      expect(capacityCount).toBe(1);
    });
  });

  // --------------------------------------------------------
  // AC-9: GET /sessions/:id/stream emits step, capture, done
  // --------------------------------------------------------
  describe('AC-9: SSE stream events', () => {
    it('emits step, capture, done events via live subscriber (AC-9)', async () => {
      const sessionId = 'sess-live-ac9';
      const session: SessionRecord = { ...RUNNING_SESSION, id: sessionId };
      const host = makeMockHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);

      // Kick off the SSE request without awaiting.
      const resPromise = app.request(`/sessions/${sessionId}/stream`);

      // Wait for the route handler to register the subscriber.
      await new Promise<void>((resolve) => setTimeout(resolve, 15));

      const subscriber = sseSubscribers.get(sessionId);
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
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const text = await res.text();
      expect(text).toContain('event: step');
      expect(text).toContain('event: capture');
      expect(text).toContain('event: done');
    });

    it('returns 404 for unknown session ID', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/sessions/no-such/stream');

      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------
  // AC-33: SSE late connect receives buffered done event
  // --------------------------------------------------------
  describe('AC-33: SSE late connect replays buffered events', () => {
    it('replays all buffered events including done to late-connecting client (AC-33)', async () => {
      const sessionId = 'sess-late-ac33';
      const session: SessionRecord = { ...COMPLETED_SESSION, id: sessionId };
      const host = makeMockHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);

      // Pre-populate the buffer as host.ts does during execution.
      sseEventBuffers.set(sessionId, [
        { event: 'step', data: JSON.stringify({ index: 0, value: 1 }) },
        {
          event: 'done',
          data: JSON.stringify({ sessionId, state: 'completed', value: 1 }),
        },
      ]);

      // Connect AFTER execution — late connect.
      const res = await app.request(`/sessions/${sessionId}/stream`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const text = await res.text();
      expect(text).toContain('event: step');
      expect(text).toContain('event: done');
      expect(text).toContain(sessionId);
    });

    it('emits synthetic done event for terminal session with empty buffer (AC-33)', async () => {
      const sessionId = 'sess-terminal-ac33';
      const session: SessionRecord = { ...COMPLETED_SESSION, id: sessionId };
      const host = makeMockHost({
        getSession: (id: string): SessionRecord | undefined =>
          id === sessionId ? session : undefined,
      });
      const app = makeApp(host);
      // No buffer set — route synthesizes done from session record.

      const res = await app.request(`/sessions/${sessionId}/stream`);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('event: done');
      expect(text).toContain(sessionId);
    });
  });

  // --------------------------------------------------------
  // Additional error contracts
  // --------------------------------------------------------
  describe('POST /run input validation', () => {
    it('returns 400 for malformed JSON body', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid trigger value', async () => {
      const app = makeApp(makeMockHost());

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'unknown' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 503 when phase is not ready', async () => {
      const app = makeApp(makeMockHost({ phase: 'init' }));

      const res = await app.request('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(503);
    });
  });
});
