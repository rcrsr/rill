/**
 * HTTP route definitions for rill-agent-proxy.
 *
 * IC-39: All proxy endpoints registered on a Hono app instance.
 * Routes delegate to a RouteContext provided by createProxy.
 */

import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { RunRequest, RunResponse } from '@rcrsr/rill-agent-shared';
import type { CatalogEntry } from './catalog.js';
import type { ActiveProcess } from './process-manager.js';
import type { ConcurrencyStats } from './concurrency.js';
import {
  ProxyError,
  PROXY_CONCURRENCY_LIMIT,
  PROXY_TIMEOUT,
} from './errors.js';

// ============================================================
// ROUTE CONTEXT INTERFACE
// ============================================================

/**
 * Minimal surface that routes need from the proxy.
 * createProxy passes a RouteContext when calling registerProxyRoutes.
 */
export interface RouteContext {
  run(agentName: string, request: RunRequest): Promise<RunResponse>;
  catalogEntries(): CatalogEntry[];
  refreshCatalog(): Promise<void>;
  activeProcesses(): ActiveProcess[];
  concurrencyStats(): ConcurrencyStats;
  metricsText(): Promise<string>;
  startedAt: number;
}

// ============================================================
// REGISTER ROUTES
// ============================================================

/**
 * Register all proxy HTTP routes on the Hono app.
 *
 * @param app - Hono application instance
 * @param ctx - Minimal proxy surface for route handlers
 * @param requestTimeoutMs - Default request timeout in milliseconds
 */
export function registerProxyRoutes(
  app: Hono,
  ctx: RouteContext,
  requestTimeoutMs: number
): void {
  // ----------------------------------------------------------
  // POST /agents/:name/run
  // AC-20: spawns child and returns result
  // AC-34: agent config injected into message
  // AC-37: agent not in catalog → 404
  // AC-49: concurrency limit → 429
  // EC-8: ProxyError with agent not found → 404
  // ----------------------------------------------------------
  app.post('/agents/:name/run', async (c) => {
    const name = c.req.param('name');

    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      return c.json(
        {
          error: {
            code: 'PROXY_INVALID_REQUEST',
            message: 'Invalid JSON body',
          },
        },
        400
      );
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json(
        {
          error: {
            code: 'PROXY_INVALID_REQUEST',
            message: 'Body must be a JSON object',
          },
        },
        400
      );
    }

    const raw = body as Record<string, unknown>;

    const params =
      typeof raw['params'] === 'object' &&
      raw['params'] !== null &&
      !Array.isArray(raw['params'])
        ? (raw['params'] as Record<string, unknown>)
        : {};

    const timeout =
      typeof raw['timeout'] === 'number' && raw['timeout'] > 0
        ? raw['timeout']
        : requestTimeoutMs;

    const correlationId = randomUUID();

    const runRequest: RunRequest = {
      params,
      correlationId,
      timeout,
    };

    let response: RunResponse;
    try {
      response = await ctx.run(name, runRequest);
    } catch (err) {
      if (err instanceof ProxyError) {
        if (err.code === 'PROXY_NOT_FOUND') {
          return c.json(
            { error: { code: err.code, message: err.message } },
            404
          );
        }
        if (err.code === PROXY_CONCURRENCY_LIMIT) {
          return c.json(
            { error: { code: err.code, message: err.message } },
            429
          );
        }
        if (err.code === PROXY_TIMEOUT) {
          return c.json(
            { error: { code: err.code, message: err.message } },
            504
          );
        }
        return c.json(
          {
            error: {
              code: err.code,
              message: err.message,
              ...(err.detail !== undefined && { detail: err.detail }),
            },
          },
          500
        );
      }
      const message_ = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: 'PROXY_INTERNAL_ERROR', message: message_ } },
        500
      );
    }

    return c.json(response, 200);
  });

  // ----------------------------------------------------------
  // GET /agents/:name/card
  // AC-35: returns agent card from catalog
  // AC-37: agent not in catalog → 404
  // ----------------------------------------------------------
  app.get('/agents/:name/card', (c) => {
    const name = c.req.param('name');
    const entry = ctx.catalogEntries().find((e) => e.name === name);
    if (entry === undefined) {
      return c.json(
        {
          error: {
            code: 'PROXY_NOT_FOUND',
            message: `Agent "${name}" not found in catalog`,
          },
        },
        404
      );
    }
    return c.json(entry.card, 200);
  });

  // ----------------------------------------------------------
  // GET /catalog
  // AC-19: returns all catalog entries
  // ----------------------------------------------------------
  app.get('/catalog', (c) => {
    const entries = ctx.catalogEntries().map((e) => ({
      name: e.name,
      version: e.version,
      checksum: e.checksum,
      dependencies: e.dependencies,
    }));
    return c.json(entries, 200);
  });

  // ----------------------------------------------------------
  // POST /catalog/refresh
  // AC-27: re-scans bundles directory
  // ----------------------------------------------------------
  app.post('/catalog/refresh', async (c) => {
    try {
      await ctx.refreshCatalog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: 'PROXY_CATALOG_REFRESH_ERROR', message: msg } },
        500
      );
    }
    const entries = ctx.catalogEntries().map((e) => ({
      name: e.name,
      version: e.version,
      checksum: e.checksum,
      dependencies: e.dependencies,
    }));
    return c.json({ refreshed: true, agents: entries }, 200);
  });

  // ----------------------------------------------------------
  // GET /healthz
  // AC-23: returns { status: "ok", uptime }
  // ----------------------------------------------------------
  app.get('/healthz', (c) => {
    const uptime = (Date.now() - ctx.startedAt) / 1000;
    return c.json({ status: 'ok', uptime }, 200);
  });

  // ----------------------------------------------------------
  // GET /readyz
  // AC-24: { ready: true } when catalog has agents
  // ----------------------------------------------------------
  app.get('/readyz', (c) => {
    const ready = ctx.catalogEntries().length > 0;
    if (!ready) {
      return c.json({ ready: false }, 503);
    }
    return c.json({ ready: true }, 200);
  });

  // ----------------------------------------------------------
  // GET /metrics
  // AC-26: Prometheus text format
  // ----------------------------------------------------------
  app.get('/metrics', async (c) => {
    let text: string;
    try {
      text = await ctx.metricsText();
    } catch {
      return c.json(
        {
          error: {
            code: 'PROXY_METRICS_ERROR',
            message: 'Failed to collect metrics',
          },
        },
        500
      );
    }
    return c.text(text, 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
  });

  // ----------------------------------------------------------
  // GET /status
  // AC-25: active count + concurrency stats
  // ----------------------------------------------------------
  app.get('/status', (c) => {
    const active = ctx.activeProcesses();
    const stats = ctx.concurrencyStats();
    return c.json(
      {
        activeCount: active.length,
        active: active.map((p) => ({
          pid: p.pid,
          agentName: p.agentName,
          correlationId: p.correlationId,
          spawnedAt: p.spawnedAt,
          timeoutAt: p.timeoutAt,
        })),
        concurrency: stats,
      },
      200
    );
  });
}
