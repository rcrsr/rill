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
} from '@rcrsr/rill-compose';
export type { AgentCard, AgentCapabilities, AgentSkill };
import { AgentHostError } from './errors.js';
import { createMemoryBackend } from './memory-backend.js';
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
  PersistedSessionState,
  RunRequest,
  RunResponse,
  HealthStatus,
  SessionRecord,
  StateBackend,
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
  stop(): Promise<void>;
  health(): HealthStatus;
  metrics(): Promise<string>;
  sessions(): Promise<SessionRecord[]>;
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  // RouteHost extensions
  abortSession(id: string): boolean;
  getSession(id: string): Promise<SessionRecord | undefined>;
  // Checkpoint extension lifecycle
  collectExtensionState(): Promise<Record<string, unknown>>;
  applyExtensionState(state: Record<string, unknown>): Promise<void>;
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
  };

  const sessionManager = new SessionManager({
    maxConcurrentSessions: cfg.maxConcurrentSessions,
    sessionTtl: cfg.sessionTtl,
  });

  const backend: StateBackend = options?.stateBackend ?? createMemoryBackend();

  // Tracks all session IDs ever written to the backend, so sessions() can
  // fetch persisted sessions that are no longer in the in-process SessionManager.
  const persistedSessionIds = new Set<string>();

  // ----------------------------------------------------------
  // Persist a session record to the backend (fire-and-forget).
  // ----------------------------------------------------------
  async function persistSession(record: SessionRecord): Promise<void> {
    persistedSessionIds.add(record.id);
    const persisted: PersistedSessionState = {
      sessionId: record.id,
      agentName: composedAgent.card.name,
      state: record.state,
      startTime: record.startTime,
      lastActivity: Date.now(),
      metadata: {},
    };
    await backend.putSession(record.id, persisted);
  }

  // ----------------------------------------------------------
  // Map a PersistedSessionState back to a SessionRecord.
  // In-process-only fields are set to zero/empty values.
  // ----------------------------------------------------------
  function mapToSessionRecord(p: PersistedSessionState): SessionRecord {
    return {
      id: p.sessionId,
      state: p.state,
      startTime: p.startTime,
      durationMs: undefined,
      stepCount: 0,
      variables: {},
      trigger: undefined,
      correlationId: '',
    };
  }

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
  // EXTENSION SUSPEND / RESTORE HELPERS (AC-33 – AC-37, EC-21 – EC-23)
  // ============================================================

  /**
   * Collect extension state by calling suspend() on each implementing extension.
   * Extensions without suspend are skipped (AC-35).
   * Throws if suspend() returns a non-JSON-serializable value (AC-37 / EC-21).
   * Throws if suspend() itself throws (EC-22).
   */
  async function collectExtensionState(): Promise<Record<string, unknown>> {
    const state: Record<string, unknown> = {};
    for (const [alias, ext] of Object.entries(composedAgent.extensions)) {
      if (typeof ext.suspend !== 'function') continue;
      const value = await Promise.resolve(ext.suspend());
      try {
        JSON.stringify(value);
      } catch {
        throw new Error(
          `Extension "${alias}": suspend() returned non-JSON-serializable value`
        );
      }
      state[alias] = value;
    }
    return state;
  }

  /**
   * Apply saved extension state by calling restore(state) on each implementing extension.
   * Extensions without restore are skipped (AC-36).
   * Throws if restore() throws (EC-23).
   */
  async function applyExtensionState(
    state: Record<string, unknown>
  ): Promise<void> {
    for (const [alias, ext] of Object.entries(composedAgent.extensions)) {
      if (typeof ext.restore !== 'function') continue;
      const savedState = state[alias];
      await Promise.resolve(ext.restore(savedState));
    }
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

      // Persist initial 'running' state (AC-29, AC-30)
      void persistSession(record);

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

          void persistSession(record);

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

          void persistSession(record);

          console.error(`[host] session ${sessionId} failed: ${record.error}`);

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

      try {
        await backend.close();
      } catch {
        // Best-effort close
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
    // AC-29: reads from configured backend
    // AC-31: restored sessions appear in list after host restart
    // ----------------------------------------------------------
    async sessions(): Promise<SessionRecord[]> {
      const inMemory = sessionManager.list();
      const inMemoryIds = new Set(inMemory.map((s) => s.id));

      const extra: SessionRecord[] = [];
      for (const id of persistedSessionIds) {
        if (!inMemoryIds.has(id)) {
          const p = await backend.getSession(id);
          if (p !== null) {
            extra.push(mapToSessionRecord(p));
          }
        }
      }
      return [...inMemory, ...extra];
    },

    // ----------------------------------------------------------
    // IR-8: listen()
    // ----------------------------------------------------------
    async listen(port?: number): Promise<void> {
      if (httpServer !== undefined) {
        throw new AgentHostError('server already listening', 'lifecycle');
      }

      const listenPort = port ?? cfg.port;

      try {
        await backend.connect();
      } catch {
        throw new AgentHostError('state backend connection failed', 'init');
      }

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

    async getSession(id: string): Promise<SessionRecord | undefined> {
      const inMemory = sessionManager.get(id);
      if (inMemory !== undefined) return inMemory;
      const p = await backend.getSession(id);
      if (p !== null) return mapToSessionRecord(p);
      return undefined;
    },

    // ----------------------------------------------------------
    // Extension suspend / restore (AC-33 – AC-37, EC-21 – EC-23)
    // ----------------------------------------------------------
    collectExtensionState(): Promise<Record<string, unknown>> {
      return collectExtensionState();
    },

    applyExtensionState(state: Record<string, unknown>): Promise<void> {
      return applyExtensionState(state);
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
    console.error(`[host] callback delivery failed: ${msg}`);
    record.error = `callback delivery failed: ${msg}`;
  }
}
