/**
 * AgentHost — core module that ties together lifecycle, sessions,
 * execution, observability, and HTTP serving.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import type { ObservabilityCallbacks } from '@rcrsr/rill';
import type {
  AgentCard,
  AgentCapabilities,
  AgentSkill,
} from '@rcrsr/rill-agent-shared';
export type { AgentCard, AgentCapabilities, AgentSkill };
import { AgentHostError } from './errors.js';
import { SessionManager } from './session.js';
import { createMetrics } from './metrics.js';
import { registerSignalHandlers } from './signals.js';
import { registerRoutes } from './routes.js';
import type { RouteHost, SseEvent, SseStore } from './routes.js';
import type {
  AgentHostOptions,
  LifecyclePhase,
  LogLevel,
  RunRequest,
  RunResponse,
  HealthStatus,
  SessionRecord,
} from './types.js';

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULTS = {
  port: 3000,
  healthPath: '/healthz',
  readyPath: '/readyz',
  metricsPath: '/metrics',
  drainTimeout: 30000,
  sessionTtl: 3600000,
  maxConcurrentSessions: 10,
  responseTimeout: 30000,
  logLevel: 'info' as LogLevel,
} as const;

// ============================================================
// LOGGING
// ============================================================

const LOG_PRIORITY = { silent: 0, info: 1, debug: 2 } as const;

function log(level: 'info' | 'debug', msg: string, logLevel: LogLevel): void {
  if (LOG_PRIORITY[level] <= LOG_PRIORITY[logLevel]) {
    console.log(msg);
  }
}

// ============================================================
// COMPOSED AGENT INTERFACES
// ============================================================

export interface ComposedAgent {
  ast: import('@rcrsr/rill').ScriptNode;
  context: import('@rcrsr/rill').RuntimeContext;
  card: AgentCard;
  dispose(): Promise<void>;
  extensions: Record<string, import('@rcrsr/rill').ExtensionResult>;
}

// ============================================================
// AgentHost INTERFACE
// ============================================================

export interface AgentHost {
  readonly phase: LifecyclePhase;
  run(input: RunRequest): Promise<RunResponse>;
  /**
   * Run a specific agent by name.
   * Used by ComposedHarness.bindHost() for in-process AHI routing.
   *
   * EC-6: agentName not in map → AgentHostError('agent "<name>" not found', 'init')
   */
  runForAgent(agentName: string, input: RunRequest): Promise<RunResponse>;
  stop(): Promise<void>;
  health(): HealthStatus;
  metrics(): Promise<string>;
  sessions(): Promise<SessionRecord[]>;
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  // RouteHost extensions
  abortSession(id: string): boolean;
  getSession(id: string): Promise<SessionRecord | undefined>;
}

// ============================================================
// FACTORY OVERLOADS
// ============================================================

/**
 * Create an AgentHost for a single pre-composed agent.
 * Accepts a pre-composed agent; no init() step required.
 *
 * EC-1: agent null/undefined → TypeError('agent is required')
 */
export function createAgentHost(
  agent: ComposedAgent,
  options?: AgentHostOptions
): AgentHost;

/**
 * Create an AgentHost for multiple pre-composed agents.
 * Routes are mounted under /:agentName/ prefix.
 *
 * EC-6: empty agents map → AgentHostError('agents map must not be empty', 'init')
 */
// eslint-disable-next-line no-redeclare
export function createAgentHost(
  agents: Map<string, ComposedAgent>,
  options?: AgentHostOptions
): AgentHost;

// eslint-disable-next-line no-redeclare
export function createAgentHost(
  agentOrAgents: ComposedAgent | Map<string, ComposedAgent>,
  options?: AgentHostOptions
): AgentHost {
  // ----------------------------------------------------------
  // Dispatch: single-agent vs multi-agent
  // ----------------------------------------------------------
  let agentsMap: Map<string, ComposedAgent>;
  if (agentOrAgents instanceof Map) {
    agentsMap = agentOrAgents;
    if (agentsMap.size === 0) {
      throw new AgentHostError('agents map must not be empty', 'init');
    }
  } else {
    if (agentOrAgents == null) {
      throw new TypeError('agent is required');
    }
    const agent = agentOrAgents;
    agentsMap = new Map([[agent.card.name, agent]]);
  }

  // ----------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------
  const cfg = {
    port: options?.port ?? DEFAULTS.port,
    healthPath: options?.healthPath ?? DEFAULTS.healthPath,
    readyPath: options?.readyPath ?? DEFAULTS.readyPath,
    metricsPath: options?.metricsPath ?? DEFAULTS.metricsPath,
    drainTimeout: options?.drainTimeout ?? DEFAULTS.drainTimeout,
    sessionTtl: options?.sessionTtl ?? DEFAULTS.sessionTtl,
    maxConcurrentSessions:
      options?.maxConcurrentSessions ?? DEFAULTS.maxConcurrentSessions,
    responseTimeout: options?.responseTimeout ?? DEFAULTS.responseTimeout,
    logLevel: options?.logLevel ?? DEFAULTS.logLevel,
    manifest: options?.manifest,
    registryEndpoint: options?.registryEndpoint,
  };

  // ----------------------------------------------------------
  // Per-host metrics bundle (AC-16, AC-17)
  // ----------------------------------------------------------
  const metrics = createMetrics();

  // ----------------------------------------------------------
  // Shared session manager (single global cap, per-agent filtering)
  // ----------------------------------------------------------
  const sessionManager = new SessionManager({
    maxConcurrentSessions: cfg.maxConcurrentSessions,
    sessionTtl: cfg.sessionTtl,
    agentCaps: options?.agentCaps,
  });

  const startTime = Date.now();

  let phase: LifecyclePhase = 'ready';
  let httpServer: ServerType | undefined;

  // Registry lifecycle state
  let registryClient:
    | import('@rcrsr/rill-agent-registry').RegistryClient
    | undefined;
  let heartbeatHandle: ReturnType<typeof setInterval> | undefined;
  let registrationComplete = false;

  const sseStore: SseStore = {
    eventBuffers: new Map<string, SseEvent[]>(),
    subscribers: new Map<string, (event: SseEvent) => void>(),
  };

  function pushSseEvent(sessionId: string, event: string, data: unknown): void {
    const payload: SseEvent = { event, data: JSON.stringify(data) };
    const buf = sseStore.eventBuffers.get(sessionId) ?? [];
    buf.push(payload);
    sseStore.eventBuffers.set(sessionId, buf);
    const subscriber = sseStore.subscribers.get(sessionId);
    if (subscriber !== undefined) subscriber(payload);
  }

  // ============================================================
  // INTERNAL EXECUTION ENGINE
  // ============================================================

  /**
   * Core execution logic for a single agent run.
   * Called by both single-agent and per-agent route handlers.
   */
  async function runForAgent(
    input: RunRequest,
    composedAgent: ComposedAgent
  ): Promise<RunResponse> {
    if (phase === 'stopped') {
      throw new AgentHostError('host stopped', 'lifecycle');
    }

    sessionManager.prune();

    const correlationId = input.correlationId ?? randomUUID();
    const agentName = composedAgent.card.name;
    // SessionManager.create() throws AgentHostError('session limit reached', 'capacity')
    const record = sessionManager.create(input, correlationId, agentName);
    const sessionId = record.id;

    // Transition on first run
    if (phase === 'ready') {
      phase = 'running';
    }

    log(
      'debug',
      `[host] session ${sessionId} started (trigger: ${input.trigger ?? 'api'})`,
      cfg.logLevel
    );

    metrics.sessionsActive.labels({ agent: agentName }).inc();

    // Build per-session AbortController
    const sessionController = sessionManager.getController(sessionId);
    const controller = sessionController!;

    // Build observability callbacks wired to metrics + SSE
    const observability: ObservabilityCallbacks = {
      onStepEnd(event) {
        metrics.stepsTotal.inc();
        record.stepCount++;
        pushSseEvent(sessionId, 'step', {
          sessionId,
          index: event.index,
          total: event.total,
          value: event.value,
          durationMs: event.durationMs,
        });
      },
      onHostCall(event) {
        metrics.hostCallsTotal.labels({ function: event.name }).inc();
      },
      onCapture(event) {
        pushSseEvent(sessionId, 'capture', {
          sessionId,
          name: event.name,
          value: event.value,
        });
      },
      onError(event) {
        pushSseEvent(sessionId, 'error', {
          sessionId,
          error: event.error.message,
        });
      },
    };

    // Create a session-scoped context with session params, signal, and
    // observability. Then overlay the composedAgent's full functions map
    // (including host extensions) so all registered callables are available.
    const baseContext = composedAgent.context;
    const sessionContext = createRuntimeContext({
      ...(input.params !== undefined && {
        variables: input.params as Record<
          string,
          import('@rcrsr/rill').RillValue
        >,
      }),
      ...(baseContext.timeout !== undefined && {
        timeout: baseContext.timeout,
      }),
      observability,
      signal: controller.signal,
      maxCallStackDepth: baseContext.maxCallStackDepth,
      callbacks: {
        onLog: (value: import('@rcrsr/rill').RillValue) => {
          const msg = typeof value === 'string' ? value : JSON.stringify(value);
          log('info', `[rill] ${msg}`, cfg.logLevel);
        },
      },
      metadata: {
        correlationId,
        sessionId,
        agentName,
        ...(input.timeout !== undefined && {
          timeoutDeadline: String(Date.now() + input.timeout),
        }),
      },
    });

    // Override the builtin-only functions map with the full composedAgent
    // functions map (host extensions included).
    for (const [name, fn] of baseContext.functions) {
      sessionContext.functions.set(name, fn);
    }

    const executionStart = Date.now();

    // responseTimeout race: if execute() exceeds responseTimeout ms, return
    // state='running' immediately while execution continues async.
    let resolved = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const executePromise = execute(composedAgent.ast, sessionContext).then(
      (result) => {
        const durationMs = Date.now() - executionStart;
        metrics.executionDurationSeconds
          .labels({ agent: agentName })
          .observe(durationMs / 1000);

        record.state = 'completed';
        record.durationMs = durationMs;
        record.result = result.result;
        record.variables = result.variables;

        metrics.sessionsActive.labels({ agent: agentName }).dec();
        metrics.sessionsTotal
          .labels({
            state: 'completed',
            trigger:
              typeof input.trigger === 'object'
                ? input.trigger.type
                : (input.trigger ?? 'api'),
            agent: agentName,
          })
          .inc();

        pushSseEvent(sessionId, 'done', {
          sessionId,
          state: 'completed',
          result: result.result,
          durationMs,
        });

        // Deliver callback if specified
        if (input.callback !== undefined) {
          const response: RunResponse = {
            sessionId,
            correlationId,
            state: 'completed',
            result: result.result,
            durationMs,
          };
          void deliverCallback(input.callback, response, record);
        }

        return {
          sessionId,
          correlationId,
          state: 'completed' as const,
          result: result.result,
          durationMs,
        };
      },
      (err: unknown) => {
        const durationMs = Date.now() - executionStart;
        metrics.executionDurationSeconds
          .labels({ agent: agentName })
          .observe(durationMs / 1000);

        record.state = 'failed';
        record.durationMs = durationMs;
        record.error = err instanceof Error ? err.message : String(err);

        console.error(`[host] session ${sessionId} failed: ${record.error}`);

        metrics.sessionsActive.labels({ agent: agentName }).dec();
        metrics.sessionsTotal
          .labels({
            state: 'failed',
            trigger:
              typeof input.trigger === 'object'
                ? input.trigger.type
                : (input.trigger ?? 'api'),
            agent: agentName,
          })
          .inc();

        pushSseEvent(sessionId, 'done', {
          sessionId,
          state: 'failed',
          error: record.error,
          durationMs,
        });

        // Deliver callback if specified
        if (input.callback !== undefined) {
          const response: RunResponse = {
            sessionId,
            correlationId,
            state: 'failed',
            durationMs,
          };
          void deliverCallback(input.callback, response, record);
        }

        return {
          sessionId,
          correlationId,
          state: 'failed' as const,
          durationMs,
        };
      }
    );

    const timeoutPromise = new Promise<RunResponse>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          sessionId,
          correlationId,
          state: 'running',
        });
      }, cfg.responseTimeout);
    });

    const winner = await Promise.race([
      executePromise.then((r) => {
        resolved = true;
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        return r as RunResponse;
      }),
      timeoutPromise,
    ]);

    if (!resolved) {
      // Timeout won — execution continues in background (executePromise keeps running).
      // Suppress unhandled rejection on executePromise.
      executePromise.catch(() => {
        // already handled inside executePromise chain
      });
    }

    return winner;
  }

  // ============================================================
  // AgentHost IMPLEMENTATION
  // ============================================================

  const host: AgentHost = {
    get phase(): LifecyclePhase {
      return phase;
    },

    // ----------------------------------------------------------
    // IR-3: run()
    // Single-agent mode: routes to the only agent.
    // Multi-agent mode: also routes to the only agent (wrapping
    // already put one agent in the map). For multi-agent mode
    // callers use per-agent RouteHost adapters via runForAgent().
    // ----------------------------------------------------------
    async run(input: RunRequest): Promise<RunResponse> {
      // In single-agent or direct-call mode, pick the first (only) agent.
      const composedAgent = agentsMap.values().next().value as ComposedAgent;
      return runForAgent(input, composedAgent);
    },

    // ----------------------------------------------------------
    // runForAgent(): per-agent routing for in-process AHI
    // Used by ComposedHarness.bindHost() to route directly to the
    // correct ComposedAgent without HTTP overhead.
    // ----------------------------------------------------------
    async runForAgent(
      agentName: string,
      input: RunRequest
    ): Promise<RunResponse> {
      const composedAgent = agentsMap.get(agentName);
      if (composedAgent === undefined) {
        throw new AgentHostError(`agent "${agentName}" not found`, 'init');
      }
      return runForAgent(input, composedAgent);
    },

    // ----------------------------------------------------------
    // IR-4: stop()
    // ----------------------------------------------------------
    async stop(): Promise<void> {
      if (phase === 'stopped') {
        // Idempotent — no-op
        return;
      }

      const agentNames = Array.from(agentsMap.keys()).join(', ');
      log('info', `[host] ${agentNames} stopping`, cfg.logLevel);

      phase = 'stopped';

      // Registry: deregister before drain begins (AC-35).
      // If register() never completed, skip deregister (AC-42).
      if (registryClient !== undefined && registrationComplete) {
        if (heartbeatHandle !== undefined) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = undefined;
        }
        try {
          for (const [agentName] of agentsMap) {
            await registryClient.deregister(agentName);
          }
        } catch (err) {
          // AC-38: deregister failure is non-fatal — warn and proceed.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[host] registry deregister failed: ${msg}`);
        }
        await registryClient.dispose();
        registryClient = undefined;
      } else if (registryClient !== undefined) {
        // register() did not complete — still dispose the client.
        if (heartbeatHandle !== undefined) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = undefined;
        }
        await registryClient.dispose();
        registryClient = undefined;
      }

      // Drain: wait for active sessions up to drainTimeout
      const drainEnd = Date.now() + cfg.drainTimeout;
      while (sessionManager.activeCount > 0 && Date.now() < drainEnd) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }

      // Dispose all agents
      for (const composedAgent of agentsMap.values()) {
        try {
          await composedAgent.dispose();
        } catch {
          // Best-effort dispose
        }
      }

      log('info', `[host] ${agentNames} stopped`, cfg.logLevel);
    },

    // ----------------------------------------------------------
    // IR-5: health()
    // ----------------------------------------------------------
    health(): HealthStatus {
      return {
        phase,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        activeSessions: sessionManager.activeCount,
        extensions: {},
      };
    },

    // ----------------------------------------------------------
    // IR-6: metrics()
    // ----------------------------------------------------------
    async metrics(): Promise<string> {
      return metrics.getMetricsText();
    },

    // ----------------------------------------------------------
    // IR-7: sessions()
    // Returns ALL sessions across all agents.
    // ----------------------------------------------------------
    async sessions(): Promise<SessionRecord[]> {
      return sessionManager.list();
    },

    // ----------------------------------------------------------
    // IR-8: listen()
    // ----------------------------------------------------------
    async listen(port?: number): Promise<void> {
      if (httpServer !== undefined) {
        throw new AgentHostError('server already listening', 'lifecycle');
      }

      const listenPort = port ?? cfg.port;
      const app = new Hono();

      // ----------------------------------------------------------
      // Multi-agent routing: mount per-agent sub-apps
      // Each sub-app gets its own RouteHost adapter that:
      //   - runs the correct ComposedAgent
      //   - filters sessions to that agent only
      // ----------------------------------------------------------
      for (const [agentName, composedAgent] of agentsMap) {
        const agentRouteHost: RouteHost = {
          get phase() {
            return phase;
          },
          async run(input: RunRequest): Promise<RunResponse> {
            return runForAgent(input, composedAgent);
          },
          stop(): Promise<void> {
            return host.stop();
          },
          health(): HealthStatus {
            return host.health();
          },
          async metrics(): Promise<string> {
            return host.metrics();
          },
          async sessions(): Promise<SessionRecord[]> {
            return sessionManager
              .list()
              .filter((s) => s.agentName === agentName);
          },
          abortSession(id: string): boolean {
            return sessionManager.abort(id);
          },
          async getSession(id: string): Promise<SessionRecord | undefined> {
            return sessionManager.get(id);
          },
        };

        const agentApp = new Hono();
        registerRoutes(
          agentApp,
          agentRouteHost,
          composedAgent.card,
          sseStore,
          composedAgent.card.input
        );
        app.route(`/${agentName}`, agentApp);

        // AC-15 spec: GET /.well-known/:agentName/agent-card.json
        // Registered on the main app, not the sub-app.
        app.get(`/.well-known/${agentName}/agent-card.json`, (c) => {
          if (phase !== 'ready' && phase !== 'running') {
            return c.json({ error: 'service unavailable' }, 503);
          }
          return c.json(composedAgent.card, 200);
        });
      }

      // ----------------------------------------------------------
      // Process-level flat routes (no agent prefix).
      // These are registered on the main app directly.
      // Must be registered BEFORE the /:agentName/* catch-all so Hono
      // matches /healthz, /readyz, /metrics, /stop before the wildcard.
      // ----------------------------------------------------------
      const processRouteHost: RouteHost = {
        get phase() {
          return phase;
        },
        async run(input: RunRequest): Promise<RunResponse> {
          return host.run(input);
        },
        stop(): Promise<void> {
          return host.stop();
        },
        health(): HealthStatus {
          return host.health();
        },
        async metrics(): Promise<string> {
          return host.metrics();
        },
        async sessions(): Promise<SessionRecord[]> {
          return host.sessions();
        },
        abortSession(id: string): boolean {
          return sessionManager.abort(id);
        },
        async getSession(id: string): Promise<SessionRecord | undefined> {
          return sessionManager.get(id);
        },
      };

      // Register process-level routes (healthz, readyz, metrics, stop) on
      // the main app. These are flat (no agent prefix).
      registerProcessRoutes(app, processRouteHost);

      // ----------------------------------------------------------
      // Unknown agent catch-all — must come AFTER known agent routes
      // AND after process-level routes.
      // AC-11: Unknown agent name → HTTP 404 (do not leak agent names).
      // ----------------------------------------------------------
      app.all('/:agentName/*', (c) => c.json({ error: 'not_found' }, 404));

      registerSignalHandlers(host, cfg.drainTimeout);

      await new Promise<void>((resolve, reject) => {
        httpServer = serve({ fetch: app.fetch, port: listenPort }, () => {
          resolve();
        });
        httpServer.once('error', (err: Error & { code?: string }) => {
          httpServer = undefined;
          if (err.code === 'EADDRINUSE') {
            reject(new AgentHostError('port in use', 'init', err));
          } else {
            reject(err);
          }
        });
      });

      const agentNames = Array.from(agentsMap.keys()).join(', ');
      log(
        'info',
        `[host] ${agentNames} listening on http://localhost:${listenPort}`,
        cfg.logLevel
      );

      // Registry integration: register each agent individually.
      const registryUrl = process.env['RILL_REGISTRY_URL'];
      if (registryUrl !== undefined && registryUrl !== '') {
        const ahiAgents = cfg.manifest?.extensions?.['ahi']?.config?.['agents'];
        const ahiDependencies: string[] =
          Array.isArray(ahiAgents) &&
          ahiAgents.every((a): a is string => typeof a === 'string')
            ? ahiAgents
            : [];

        const { createRegistryClient } =
          await import('@rcrsr/rill-agent-registry');
        const client = createRegistryClient({ url: registryUrl });
        registryClient = client;

        for (const [, composedAgent] of agentsMap) {
          const payload = {
            name: composedAgent.card.name,
            version: composedAgent.card.version,
            endpoint: cfg.registryEndpoint ?? `http://localhost:${listenPort}`,
            card: composedAgent.card,
            dependencies: ahiDependencies,
          };

          try {
            await client.register(payload);
            registrationComplete = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[host] registry registration failed: ${msg}`);
          }
        }

        // Heartbeat for all agents
        heartbeatHandle = setInterval(() => {
          for (const [, composedAgent] of agentsMap) {
            void client
              .heartbeat(composedAgent.card.name)
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[host] registry heartbeat failed: ${msg}`);
              });
          }
        }, 30_000);
      }
    },

    // ----------------------------------------------------------
    // IR-9: close()
    // ----------------------------------------------------------
    async close(): Promise<void> {
      if (httpServer === undefined) {
        // No-op
        return;
      }

      const server = httpServer;
      httpServer = undefined;

      await new Promise<void>((resolve, reject) => {
        server.close((err: Error | undefined) => {
          if (err !== undefined && err !== null) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    // ----------------------------------------------------------
    // RouteHost extensions
    // ----------------------------------------------------------
    abortSession(id: string): boolean {
      return sessionManager.abort(id);
    },

    async getSession(id: string): Promise<SessionRecord | undefined> {
      return sessionManager.get(id);
    },
  };

  return host;
}

// ============================================================
// PROCESS-LEVEL ROUTE REGISTRATION
// ============================================================

/**
 * Registers flat process-level routes on the main Hono app.
 * These have no agent prefix: /healthz, /readyz, /metrics, /stop.
 * They operate across all agents.
 */
function registerProcessRoutes(app: Hono, host: RouteHost): void {
  app.get('/healthz', (c) => {
    const status: HealthStatus = host.health();
    if (status.phase === 'stopped') {
      return c.json({ error: 'service unavailable' }, 503);
    }
    return c.json(status, 200);
  });

  app.get('/readyz', (c) => {
    const ph = host.phase;
    if (ph !== 'ready' && ph !== 'running') {
      return c.json({ error: 'service unavailable' }, 503);
    }
    return c.json({ ready: true }, 200);
  });

  app.get('/metrics', async (c) => {
    let text: string;
    try {
      text = await host.metrics();
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }
    return c.text(text, 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
  });

  app.post('/stop', (c) => {
    const ph = host.phase;
    if (ph !== 'ready' && ph !== 'running') {
      return c.json({ error: 'service unavailable' }, 503);
    }
    void host.stop();
    return c.json({ message: 'shutdown initiated' }, 202);
  });
}

// ============================================================
// CALLBACK DELIVERY
// ============================================================

/**
 * POST RunResponse to the callback URL after execution completes.
 * On failure: logs error and stores in SessionRecord.error. No retry.
 */
async function deliverCallback(
  callbackUrl: string,
  response: RunResponse,
  record: SessionRecord
): Promise<void> {
  // Guard: only allow http/https schemes
  const schemeEnd = callbackUrl.indexOf(':');
  const scheme = schemeEnd >= 0 ? callbackUrl.slice(0, schemeEnd) : '';
  if (scheme !== 'http' && scheme !== 'https') {
    record.error = `callback rejected: unsupported scheme '${scheme}'`;
    return;
  }

  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[host] callback delivery failed: ${msg}`);
    record.error = `callback delivery failed: ${msg}`;
  }
}
