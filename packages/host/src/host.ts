/**
 * AgentHost — core module that ties together lifecycle, sessions,
 * execution, observability, and HTTP serving.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import type { ObservabilityCallbacks } from '@rcrsr/rill';
import { AgentHostError } from './errors.js';
import { SessionManager } from './session.js';
import {
  getMetricsText,
  sessionsTotal,
  sessionsActive,
  executionDurationSeconds,
  hostCallsTotal,
  stepsTotal,
} from './metrics.js';
import { registerSignalHandlers } from './signals.js';
import { registerRoutes } from './routes.js';
import type { SseEvent, SseStore } from './routes.js';
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

export interface AgentCapability {
  readonly namespace: string;
  readonly functions: readonly string[];
}

export interface AgentCard {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly AgentCapability[];
  readonly port?: number | undefined;
  readonly healthPath?: string | undefined;
}

export interface ComposedAgent {
  ast: import('@rcrsr/rill').ScriptNode;
  context: import('@rcrsr/rill').RuntimeContext;
  card: AgentCard;
  dispose(): Promise<void>;
}

// ============================================================
// AgentHost INTERFACE
// ============================================================

export interface AgentHost {
  readonly phase: LifecyclePhase;
  run(input: RunRequest): Promise<RunResponse>;
  stop(): Promise<void>;
  health(): HealthStatus;
  metrics(): Promise<string>;
  sessions(): SessionRecord[];
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  // RouteHost extensions
  abortSession(id: string): boolean;
  getSession(id: string): SessionRecord | undefined;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create an AgentHost ready to listen().
 * Accepts a pre-composed agent; no init() step required.
 *
 * EC-1: agent null/undefined → TypeError('agent is required')
 */
export function createAgentHost(
  agent: ComposedAgent,
  options?: AgentHostOptions
): AgentHost {
  if (agent == null) {
    throw new TypeError('agent is required');
  }

  const cfg = {
    port: options?.port ?? agent.card.port ?? DEFAULTS.port,
    healthPath: options?.healthPath ?? DEFAULTS.healthPath,
    readyPath: options?.readyPath ?? DEFAULTS.readyPath,
    metricsPath: options?.metricsPath ?? DEFAULTS.metricsPath,
    drainTimeout: options?.drainTimeout ?? DEFAULTS.drainTimeout,
    sessionTtl: options?.sessionTtl ?? DEFAULTS.sessionTtl,
    maxConcurrentSessions:
      options?.maxConcurrentSessions ?? DEFAULTS.maxConcurrentSessions,
    responseTimeout: options?.responseTimeout ?? DEFAULTS.responseTimeout,
    logLevel: options?.logLevel ?? DEFAULTS.logLevel,
  };

  const sessionManager = new SessionManager({
    maxConcurrentSessions: cfg.maxConcurrentSessions,
    sessionTtl: cfg.sessionTtl,
  });

  const startTime = Date.now();

  let phase: LifecyclePhase = 'ready';
  const composedAgent = agent;
  let httpServer: ServerType | undefined;

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
  // AgentHost IMPLEMENTATION
  // ============================================================

  const host: AgentHost = {
    get phase(): LifecyclePhase {
      return phase;
    },

    // ----------------------------------------------------------
    // IR-3: run()
    // ----------------------------------------------------------
    async run(input: RunRequest): Promise<RunResponse> {
      if (phase === 'stopped') {
        throw new AgentHostError('host stopped', 'lifecycle');
      }

      // EC-6: capacity check — SessionManager.create() also checks but we
      // validate phase first and delegate the capacity error to SessionManager.
      sessionManager.prune();

      const correlationId = randomUUID();
      // SessionManager.create() throws AgentHostError('session limit reached', 'capacity')
      const record = sessionManager.create(input, correlationId);
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

      sessionsActive.inc();

      // Build per-session AbortController
      const sessionController = sessionManager.getController(sessionId);
      // sessionController is always defined for a newly created session.
      // Use non-null assertion after verifying this invariant from session.ts.
      const controller = sessionController!;

      // Build observability callbacks wired to metrics + SSE
      const observability: ObservabilityCallbacks = {
        onStepEnd(event) {
          stepsTotal.inc();
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
          hostCallsTotal.labels({ function: event.name }).inc();
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
      const baseContext = composedAgent!.context;
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
            const msg =
              typeof value === 'string' ? value : JSON.stringify(value);
            log('info', `[rill] ${msg}`, cfg.logLevel);
          },
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

      const executePromise = execute(composedAgent!.ast, sessionContext).then(
        (result) => {
          const durationMs = Date.now() - executionStart;
          executionDurationSeconds.observe(durationMs / 1000);

          record.state = 'completed';
          record.durationMs = durationMs;
          record.value = result.value;
          record.variables = result.variables;

          sessionsActive.dec();
          sessionsTotal
            .labels({ state: 'completed', trigger: input.trigger ?? 'api' })
            .inc();

          pushSseEvent(sessionId, 'done', {
            sessionId,
            state: 'completed',
            value: result.value,
            durationMs,
          });

          // Deliver callback if specified
          if (input.callback !== undefined) {
            const response: RunResponse = {
              sessionId,
              correlationId,
              state: 'completed',
              value: result.value,
              durationMs,
            };
            void deliverCallback(input.callback, response, record);
          }

          return {
            sessionId,
            correlationId,
            state: 'completed' as const,
            value: result.value,
            durationMs,
          };
        },
        (err: unknown) => {
          const durationMs = Date.now() - executionStart;
          executionDurationSeconds.observe(durationMs / 1000);

          record.state = 'failed';
          record.durationMs = durationMs;
          record.error = err instanceof Error ? err.message : String(err);

          sessionsActive.dec();
          sessionsTotal
            .labels({ state: 'failed', trigger: input.trigger ?? 'api' })
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
    },

    // ----------------------------------------------------------
    // IR-4: stop()
    // ----------------------------------------------------------
    async stop(): Promise<void> {
      if (phase === 'stopped') {
        // Idempotent — no-op
        return;
      }

      log('info', `[host] ${composedAgent.card.name} stopping`, cfg.logLevel);

      phase = 'stopped';

      // Drain: wait for active sessions up to drainTimeout
      const drainEnd = Date.now() + cfg.drainTimeout;
      while (sessionManager.activeCount > 0 && Date.now() < drainEnd) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }

      if (composedAgent !== undefined) {
        try {
          await composedAgent.dispose();
        } catch {
          // Best-effort dispose
        }
      }

      log('info', `[host] ${composedAgent.card.name} stopped`, cfg.logLevel);
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
      return getMetricsText();
    },

    // ----------------------------------------------------------
    // IR-7: sessions()
    // ----------------------------------------------------------
    sessions(): SessionRecord[] {
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

      registerRoutes(app, host, composedAgent!.card, sseStore);
      registerSignalHandlers(host, cfg.drainTimeout);

      await new Promise<void>((resolve, reject) => {
        httpServer = serve({ fetch: app.fetch, port: listenPort }, () => {
          resolve();
        });
        httpServer.once('error', (err: Error) => {
          httpServer = undefined;
          reject(err);
        });
      });

      log(
        'info',
        `[host] ${composedAgent.card.name} listening on http://localhost:${listenPort}`,
        cfg.logLevel
      );
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

    getSession(id: string): SessionRecord | undefined {
      return sessionManager.get(id);
    },
  };

  return host;
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
    console.error(`[rill-host] callback delivery failed: ${msg}`);
    record.error = `callback delivery failed: ${msg}`;
  }
}
