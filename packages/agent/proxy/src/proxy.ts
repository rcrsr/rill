/**
 * createProxy: top-level factory for rill-agent-proxy.
 *
 * IC-33: AgentProxy interface and createProxy factory.
 * AC-18: listen() starts HTTP on configured port.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { ChildProcess } from 'node:child_process';
import type {
  RunRequest,
  RunResponse,
  StdioRunMessage,
  StdioAhiRequest,
} from '@rcrsr/rill-agent-shared';
import type { CatalogEntry, Catalog } from './catalog.js';
import type { ActiveProcess } from './process-manager.js';
import type { ConcurrencyStats } from './concurrency.js';
import type { ProxyConfig } from './config.js';
import {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_CONCURRENCY,
  DEFAULT_DRAIN_TIMEOUT_MS,
} from './config.js';
import { createCatalog } from './catalog.js';
import { createConcurrencyLimiter } from './concurrency.js';
import { createProcessManager } from './process-manager.js';
import { createAhiHandler } from './ahi-mediator.js';
import { createProxyMetrics } from './metrics.js';
import { registerProxyRoutes, type RouteContext } from './routes.js';
import { ProxyError, PROXY_CONCURRENCY_LIMIT } from './errors.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

/**
 * IC-33: Handle returned by createProxy.
 */
export interface AgentProxy {
  listen(): Promise<void>;
  close(): Promise<void>;
  run(agentName: string, request: RunRequest): Promise<RunResponse>;
  catalog(): CatalogEntry[];
  active(): ActiveProcess[];
  refreshCatalog(): Promise<void>;
}

// ============================================================
// INTERNAL CONSTANTS
// ============================================================

const PROXY_NOT_FOUND = 'PROXY_NOT_FOUND';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a fully initialized AgentProxy.
 *
 * Initialization steps (IC-33):
 * 1. createCatalog — scans bundlesDir; throws EC-6, EC-7 if invalid.
 * 2. createConcurrencyLimiter — enforces global + per-agent limits.
 * 3. Circular dep wiring — ahiHandlerBridge references processManager via closure.
 * 4. createProcessManager — uses ahiHandlerBridge to break circular dep.
 * 5. createProxyMetrics — per-instance Registry (IC-40).
 * 6. Register Hono routes.
 */
export async function createProxy(config: ProxyConfig): Promise<AgentProxy> {
  const port = config.port ?? DEFAULT_PORT;
  const hostname = config.host ?? DEFAULT_HOST;
  const concurrencyConfig = config.concurrency ?? DEFAULT_CONCURRENCY;
  const drainTimeoutMs = config.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const agentConfig = config.agentConfig ?? {};

  // Step 1: catalog
  const catalog: Catalog = await createCatalog(config.bundlesDir);

  // Step 2: concurrency limiter
  const concurrencyLimiter = createConcurrencyLimiter(concurrencyConfig);

  // Step 3 + 4: circular dep wiring
  // processManager needs ahiHandler; ahiHandler needs processManager.
  // We use a mutable reference resolved before any requests arrive.
  let processManager: ReturnType<typeof createProcessManager>;

  const ahiHandlerBridge = async (
    child: ChildProcess,
    request: StdioAhiRequest
  ): Promise<void> => {
    const handler = createAhiHandler(
      catalog,
      processManager,
      concurrencyConfig.requestTimeoutMs,
      request.id
    );
    return handler(child, request);
  };

  processManager = createProcessManager(
    concurrencyConfig.requestTimeoutMs,
    ahiHandlerBridge
  );

  // Step 5: metrics
  const metrics = createProxyMetrics();

  // Step 6: Hono app + routes
  const app = new Hono();
  const startedAt = Date.now();

  const routeContext: RouteContext = {
    startedAt,

    async run(agentName: string, request: RunRequest): Promise<RunResponse> {
      return publicRun(agentName, request);
    },

    catalogEntries(): CatalogEntry[] {
      return Array.from(catalog.entries.values());
    },

    async refreshCatalog(): Promise<void> {
      return catalog.refresh();
    },

    activeProcesses(): ActiveProcess[] {
      return Array.from(processManager.active());
    },

    concurrencyStats(): ConcurrencyStats {
      return concurrencyLimiter.stats;
    },

    async metricsText(): Promise<string> {
      return metrics.registry.metrics();
    },
  };

  registerProxyRoutes(app, routeContext, concurrencyConfig.requestTimeoutMs);

  let server: ServerType | undefined;

  // ============================================================
  // CORE RUN FUNCTION
  // ============================================================

  async function proxyRun(
    agentName: string,
    message: StdioRunMessage
  ): Promise<RunResponse> {
    // EC-8: agent not in catalog → ProxyError (404)
    const entry = catalog.get(agentName);
    if (entry === undefined) {
      throw new ProxyError(
        `Agent "${agentName}" not found in catalog`,
        PROXY_NOT_FOUND,
        agentName
      );
    }

    // Acquire concurrency token → throws PROXY_CONCURRENCY_LIMIT if at limit
    const token = await concurrencyLimiter.acquire(agentName);

    const spawnStart = Date.now();

    let result: RunResponse;
    try {
      metrics.activeProcesses.inc({ agent: agentName });
      const requestEnd = metrics.requestDurationSeconds.startTimer({
        agent: agentName,
      });

      const stdioResult = await processManager.spawn(entry, message);

      const spawnDurationSec = (Date.now() - spawnStart) / 1000;
      metrics.spawnDurationSeconds.observe(
        { agent: agentName },
        spawnDurationSec
      );
      requestEnd();

      const status = stdioResult.state === 'completed' ? '200' : '500';
      metrics.requestsTotal.inc({ agent: agentName, status });

      result = {
        state: stdioResult.state,
        result: stdioResult.result,
        error: stdioResult.error,
        durationMs: stdioResult.durationMs,
      } as RunResponse;
    } catch (err) {
      const proxyErr = err instanceof ProxyError ? err : undefined;
      const code = proxyErr?.code ?? 'PROXY_ERROR';
      if (code === PROXY_CONCURRENCY_LIMIT) {
        metrics.concurrencyRejectionsTotal.inc({ agent: agentName });
      }
      metrics.childErrorsTotal.inc({ agent: agentName, code });
      metrics.requestsTotal.inc({ agent: agentName, status: 'error' });
      throw err;
    } finally {
      metrics.activeProcesses.dec({ agent: agentName });
      concurrencyLimiter.release(token);
    }

    return result;
  }

  // ============================================================
  // PUBLIC RUN ADAPTER
  // ============================================================

  async function publicRun(
    agentName: string,
    request: RunRequest
  ): Promise<RunResponse> {
    const message: StdioRunMessage = {
      method: 'run',
      name: agentName,
      params: request.params ?? {},
      config: agentConfig[agentName] ?? {},
      bindings: {},
      timeout: request.timeout ?? concurrencyConfig.requestTimeoutMs,
      correlationId: request.correlationId ?? randomUUID(),
    };
    return proxyRun(agentName, message);
  }

  // ============================================================
  // AGENT PROXY INTERFACE
  // ============================================================

  return {
    async listen(): Promise<void> {
      return new Promise<void>((resolve) => {
        server = serve({ fetch: app.fetch, port, hostname }, () => {
          resolve();
        });
      });
    },

    async close(): Promise<void> {
      return gracefulShutdown();
    },

    run: publicRun,

    catalog(): CatalogEntry[] {
      return Array.from(catalog.entries.values());
    },

    active(): ActiveProcess[] {
      return Array.from(processManager.active());
    },

    async refreshCatalog(): Promise<void> {
      return catalog.refresh();
    },
  };

  // ============================================================
  // GRACEFUL SHUTDOWN
  // ============================================================

  async function gracefulShutdown(): Promise<void> {
    // Drain: wait for active processes to finish, up to drainTimeoutMs.
    const deadline = Date.now() + drainTimeoutMs;

    await new Promise<void>((resolve) => {
      function poll(): void {
        if (processManager.activeCount === 0 || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(poll, 100);
      }
      poll();
    });

    // Close HTTP server
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
  }
}
