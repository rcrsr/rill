/**
 * Route unit tests for rill-agent-proxy using in-process Hono testing.
 *
 * AC-23: /healthz → { status: "ok" }
 * AC-24: /readyz → { ready: true }
 * AC-25: /status → active count + concurrency stats
 * AC-26: /metrics → Prometheus text
 * AC-19: /catalog → all agents
 * AC-27: /catalog/refresh → re-scan
 * AC-35: /agents/:name/card → agent card
 * AC-37/AC-45: /agents/:name/run → 404 for missing agent
 * AC-49: /agents/:name/run → 429 at limit
 * AC-34: Agent config injection from --config
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { RunResponse } from '@rcrsr/rill-agent-shared';
import type { CatalogEntry } from '../src/catalog.js';
import type { ActiveProcess } from '../src/process-manager.js';
import type { ConcurrencyStats } from '../src/concurrency.js';
import type { RouteContext } from '../src/routes.js';
import { registerProxyRoutes } from '../src/routes.js';
import { ProxyError, PROXY_CONCURRENCY_LIMIT } from '../src/errors.js';

// ============================================================
// HELPERS
// ============================================================

function makeCatalogEntry(name: string): CatalogEntry {
  return {
    name,
    version: '1.0.0',
    bundlePath: `/bundles/${name}`,
    checksum: 'sha256:abc123',
    card: {
      name,
      version: '1.0.0',
      description: `${name} agent`,
      url: 'http://localhost',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      skills: [],
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
    },
    agents: {},
    dependencies: [],
  };
}

function makeActiveProcess(agentName: string): ActiveProcess {
  return {
    pid: 1234,
    agentName,
    correlationId: 'test-corr',
    spawnedAt: Date.now(),
    timeoutAt: Date.now() + 60000,
  };
}

function makeConcurrencyStats(
  overrides: Partial<ConcurrencyStats> = {}
): ConcurrencyStats {
  return {
    active: 0,
    activeByAgent: {},
    queued: 0,
    rejected: 0,
    ...overrides,
  };
}

/**
 * Build a Hono app with registerProxyRoutes applied.
 * Returns the app and the mock ctx for assertion.
 */
function makeApp(
  ctxOverrides: Partial<RouteContext> = {},
  requestTimeoutMs = 30000
): { app: Hono; ctx: RouteContext } {
  const defaultRun = vi.fn<RouteContext['run']>().mockResolvedValue({
    state: 'completed',
    result: 'ok',
  } as RunResponse);

  const ctx: RouteContext = {
    startedAt: Date.now() - 5000,
    run: defaultRun,
    catalogEntries: vi.fn().mockReturnValue([makeCatalogEntry('agentAlpha')]),
    refreshCatalog: vi.fn().mockResolvedValue(undefined),
    activeProcesses: vi.fn().mockReturnValue([]),
    concurrencyStats: vi.fn().mockReturnValue(makeConcurrencyStats()),
    metricsText: vi
      .fn()
      .mockResolvedValue('# metrics\nrill_active_processes 0\n'),
    ...ctxOverrides,
  };

  const app = new Hono();
  registerProxyRoutes(app, ctx, requestTimeoutMs);
  return { app, ctx };
}

// ============================================================
// TEST SUITE
// ============================================================

describe('registerProxyRoutes', () => {
  // ----------------------------------------------------------
  // AC-23: /healthz
  // ----------------------------------------------------------
  describe('GET /healthz', () => {
    it('AC-23: returns { status: "ok" } with 200', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/healthz');
      const body = (await res.json()) as { status: string; uptime: number };

      // Assert
      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------
  // AC-24: /readyz
  // ----------------------------------------------------------
  describe('GET /readyz', () => {
    it('AC-24: returns { ready: true } when catalog has agents', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/readyz');
      const body = (await res.json()) as { ready: boolean };

      // Assert
      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
    });

    it('returns { ready: false } with 503 when catalog is empty', async () => {
      // Arrange
      const { app } = makeApp({
        catalogEntries: vi.fn().mockReturnValue([]),
      });

      // Act
      const res = await app.request('/readyz');
      const body = (await res.json()) as { ready: boolean };

      // Assert
      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // AC-25: /status
  // ----------------------------------------------------------
  describe('GET /status', () => {
    it('AC-25: returns activeCount and concurrency stats with 200', async () => {
      // Arrange
      const activeProcess = makeActiveProcess('agentAlpha');
      const stats = makeConcurrencyStats({
        active: 1,
        activeByAgent: { agentAlpha: 1 },
      });
      const { app } = makeApp({
        activeProcesses: vi.fn().mockReturnValue([activeProcess]),
        concurrencyStats: vi.fn().mockReturnValue(stats),
      });

      // Act
      const res = await app.request('/status');
      const body = (await res.json()) as {
        activeCount: number;
        active: ActiveProcess[];
        concurrency: ConcurrencyStats;
      };

      // Assert
      expect(res.status).toBe(200);
      expect(body.activeCount).toBe(1);
      expect(body.active).toHaveLength(1);
      expect(body.active[0]?.agentName).toBe('agentAlpha');
      expect(body.concurrency.active).toBe(1);
    });

    it('returns zero active count when no processes running', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/status');
      const body = (await res.json()) as { activeCount: number };

      // Assert
      expect(res.status).toBe(200);
      expect(body.activeCount).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // AC-26: /metrics
  // ----------------------------------------------------------
  describe('GET /metrics', () => {
    it('AC-26: returns Prometheus text with correct Content-Type', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/metrics');
      const text = await res.text();

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(text).toContain('rill_active_processes');
    });

    it('returns 500 when metricsText throws', async () => {
      // Arrange
      const { app } = makeApp({
        metricsText: vi.fn().mockRejectedValue(new Error('registry error')),
      });

      // Act
      const res = await app.request('/metrics');
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(500);
      expect(body.error.code).toBe('PROXY_METRICS_ERROR');
    });
  });

  // ----------------------------------------------------------
  // AC-19: /catalog
  // ----------------------------------------------------------
  describe('GET /catalog', () => {
    it('AC-19: returns all catalog entries with 200', async () => {
      // Arrange
      const entries = [makeCatalogEntry('agentA'), makeCatalogEntry('agentB')];
      const { app } = makeApp({
        catalogEntries: vi.fn().mockReturnValue(entries),
      });

      // Act
      const res = await app.request('/catalog');
      const body = (await res.json()) as Array<{
        name: string;
        version: string;
      }>;

      // Assert
      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0]?.name).toBe('agentA');
      expect(body[1]?.name).toBe('agentB');
    });

    it('returns entry fields: name, version, checksum, dependencies', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/catalog');
      const body = (await res.json()) as Array<{
        name: string;
        version: string;
        checksum: string;
        dependencies: string[];
      }>;

      // Assert
      expect(body[0]?.checksum).toBe('sha256:abc123');
      expect(Array.isArray(body[0]?.dependencies)).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // AC-27: /catalog/refresh
  // ----------------------------------------------------------
  describe('POST /catalog/refresh', () => {
    it('AC-27: calls refreshCatalog and returns refreshed entries', async () => {
      // Arrange
      const refreshMock = vi.fn().mockResolvedValue(undefined);
      const { app, ctx } = makeApp({ refreshCatalog: refreshMock });

      // Act
      const res = await app.request('/catalog/refresh', { method: 'POST' });
      const body = (await res.json()) as {
        refreshed: boolean;
        agents: unknown[];
      };

      // Assert
      expect(res.status).toBe(200);
      expect(body.refreshed).toBe(true);
      expect(refreshMock).toHaveBeenCalledOnce();
      expect(Array.isArray(body.agents)).toBe(true);
      void ctx;
    });

    it('returns 500 when refreshCatalog throws', async () => {
      // Arrange
      const { app } = makeApp({
        refreshCatalog: vi.fn().mockRejectedValue(new Error('disk error')),
      });

      // Act
      const res = await app.request('/catalog/refresh', { method: 'POST' });
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(500);
      expect(body.error.code).toBe('PROXY_CATALOG_REFRESH_ERROR');
    });
  });

  // ----------------------------------------------------------
  // AC-35: /agents/:name/card
  // ----------------------------------------------------------
  describe('GET /agents/:name/card', () => {
    it('AC-35: returns agent card for known agent', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/agents/agentAlpha/card');
      const body = (await res.json()) as { name: string };

      // Assert
      expect(res.status).toBe(200);
      expect(body.name).toBe('agentAlpha');
    });

    it('returns 404 for unknown agent', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/agents/nonExistent/card');
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(404);
      expect(body.error.code).toBe('PROXY_NOT_FOUND');
    });
  });

  // ----------------------------------------------------------
  // AC-37/AC-45: /agents/:name/run → 404 for missing agent
  // ----------------------------------------------------------
  describe('POST /agents/:name/run — 404 for missing agent', () => {
    it('AC-37: returns 404 when agent not in catalog', async () => {
      // Arrange
      const { app } = makeApp({
        run: vi
          .fn()
          .mockRejectedValue(
            new ProxyError(
              'Agent "ghost" not found in catalog',
              'PROXY_NOT_FOUND',
              'ghost'
            )
          ),
      });

      // Act
      const res = await app.request('/agents/ghost/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      });
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(404);
      expect(body.error.code).toBe('PROXY_NOT_FOUND');
    });
  });

  // ----------------------------------------------------------
  // AC-49: /agents/:name/run → 429 at limit
  // ----------------------------------------------------------
  describe('POST /agents/:name/run — 429 at concurrency limit', () => {
    it('AC-49: returns 429 when concurrency limit reached', async () => {
      // Arrange
      const { app } = makeApp({
        run: vi
          .fn()
          .mockRejectedValue(
            new ProxyError(
              'Global concurrency limit reached',
              PROXY_CONCURRENCY_LIMIT,
              'agentAlpha'
            )
          ),
      });

      // Act
      const res = await app.request('/agents/agentAlpha/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      });
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(429);
      expect(body.error.code).toBe(PROXY_CONCURRENCY_LIMIT);
    });
  });

  // ----------------------------------------------------------
  // AC-34: Route layer passes RunRequest (no config) to ctx.run.
  // Config injection happens in publicRun (proxy.ts), not here.
  // ----------------------------------------------------------
  describe('POST /agents/:name/run — RunRequest shape (AC-34)', () => {
    it('AC-34: calls ctx.run with params, correlationId, and timeout from the HTTP body', async () => {
      // Arrange
      const runMock = vi.fn<RouteContext['run']>().mockResolvedValue({
        state: 'completed',
        result: 'ok',
      } as RunResponse);

      const { app } = makeApp({ run: runMock });

      // Act
      const res = await app.request('/agents/agentAlpha/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { input: 'hello' }, timeout: 5000 }),
      });

      // Assert
      expect(res.status).toBe(200);
      expect(runMock).toHaveBeenCalledOnce();
      const [agentName, request] = runMock.mock.calls[0]!;
      expect(agentName).toBe('agentAlpha');
      expect(request.params).toEqual({ input: 'hello' });
      expect(typeof request.correlationId).toBe('string');
      expect(request.timeout).toBe(5000);
      // Route layer does not inject config — RunRequest has no config field
      expect('config' in request).toBe(false);
    });

    it('falls back to requestTimeoutMs when body has no timeout', async () => {
      // Arrange
      const runMock = vi.fn<RouteContext['run']>().mockResolvedValue({
        state: 'completed',
        result: 'ok',
      } as RunResponse);

      const { app } = makeApp({ run: runMock }, 15000);

      // Act
      await app.request('/agents/agentAlpha/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      });

      // Assert
      const [, request] = runMock.mock.calls[0]!;
      expect(request.timeout).toBe(15000);
    });
  });

  // ----------------------------------------------------------
  // Bad request handling
  // ----------------------------------------------------------
  describe('POST /agents/:name/run — bad request', () => {
    it('returns 400 for invalid JSON body', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/agents/agentAlpha/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(400);
      expect(body.error.code).toBe('PROXY_INVALID_REQUEST');
    });

    it('returns 200 with successful run result', async () => {
      // Arrange
      const { app } = makeApp();

      // Act
      const res = await app.request('/agents/agentAlpha/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { key: 'val' } }),
      });
      const body = (await res.json()) as { state: string };

      // Assert
      expect(res.status).toBe(200);
      expect(body.state).toBe('completed');
    });
  });
});
