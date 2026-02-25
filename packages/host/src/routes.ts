/**
 * HTTP route definitions for rill-host.
 *
 * Registers all endpoints on a Hono app instance.
 * Exports sseEventBuffers so host.ts can push buffered events
 * for late-connecting SSE clients (AC-33).
 */

import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentCard } from '@rcrsr/rill-compose';
import type {
  LifecyclePhase,
  RunRequest,
  RunResponse,
  HealthStatus,
  SessionRecord,
} from './types.js';

// ============================================================
// SSE EVENT TYPES
// ============================================================

/**
 * A single buffered SSE event for replay to late-connecting clients.
 */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

// ============================================================
// SSE STORES (module-level, exported for host.ts to push to)
// ============================================================

/**
 * Completed event buffers keyed by sessionId.
 * host.ts appends events here during execution so late-connecting
 * SSE clients can receive the full stream (AC-33).
 */
export const sseEventBuffers = new Map<string, SseEvent[]>();

/**
 * Active SSE subscriber callbacks keyed by sessionId.
 * Set when a client connects before execution completes.
 * host.ts calls the callback to push live events.
 */
export const sseSubscribers = new Map<string, (event: SseEvent) => void>();

// ============================================================
// ROUTE HOST INTERFACE
// ============================================================

/**
 * Minimal host surface needed by route handlers.
 * Defined locally to avoid circular imports with host.ts.
 * The full AgentHost satisfies this structurally.
 */
export interface RouteHost {
  readonly phase: LifecyclePhase;
  run(input: RunRequest): Promise<RunResponse>;
  stop(): Promise<void>;
  health(): HealthStatus;
  metrics(): Promise<string>;
  sessions(): SessionRecord[];
  /** Delegates to SessionManager.abort(). Returns false if not found or already terminal. */
  abortSession(id: string): boolean;
  /** Delegates to SessionManager.get(). Returns undefined if not found or TTL elapsed. */
  getSession(id: string): SessionRecord | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns true when the host is in a phase that accepts requests.
 */
function isServiceAvailable(phase: LifecyclePhase): boolean {
  return phase === 'ready' || phase === 'running';
}

/**
 * Extract or generate a correlation ID from the request.
 */
function resolveCorrelationId(headerValue: string | undefined): string {
  return headerValue ?? randomUUID();
}

// ============================================================
// REGISTER ROUTES
// ============================================================

/**
 * Register all HTTP routes on the Hono app.
 *
 * @param app - Hono application instance
 * @param host - Minimal host interface
 * @param card - AgentCard for /.well-known/agent-card.json
 */
export function registerRoutes(
  app: Hono,
  host: RouteHost,
  card: AgentCard
): void {
  // ----------------------------------------------------------
  // POST /run
  // AC-8: returns RunResponse with X-Correlation-ID
  // AC-18: 429 when at capacity
  // ----------------------------------------------------------
  app.post('/run', async (c) => {
    const correlationId = resolveCorrelationId(
      c.req.header('X-Correlation-ID')
    );

    if (!isServiceAvailable(host.phase)) {
      c.header('X-Correlation-ID', correlationId);
      return c.json({ error: 'service unavailable' }, 503);
    }

    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      c.header('X-Correlation-ID', correlationId);
      return c.json({ error: 'invalid request' }, 400);
    }

    // Validate that body is a plain object
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      c.header('X-Correlation-ID', correlationId);
      return c.json({ error: 'invalid request' }, 400);
    }

    const raw = body as Record<string, unknown>;

    // Validate trigger
    const validTriggers = new Set([
      'http',
      'queue',
      'cron',
      'agent',
      'api',
      'manual',
    ]);
    if (
      raw['trigger'] !== undefined &&
      (typeof raw['trigger'] !== 'string' || !validTriggers.has(raw['trigger']))
    ) {
      c.header('X-Correlation-ID', correlationId);
      return c.json({ error: 'invalid request' }, 400);
    }

    // Validate timeout
    if (
      raw['timeout'] !== undefined &&
      (typeof raw['timeout'] !== 'number' || raw['timeout'] <= 0)
    ) {
      c.header('X-Correlation-ID', correlationId);
      return c.json({ error: 'invalid request' }, 400);
    }

    // Validate callback scheme
    if (raw['callback'] !== undefined) {
      if (typeof raw['callback'] !== 'string') {
        c.header('X-Correlation-ID', correlationId);
        return c.json({ error: 'invalid request' }, 400);
      }
      const scheme = raw['callback'].slice(0, raw['callback'].indexOf(':'));
      if (scheme !== 'http' && scheme !== 'https') {
        c.header('X-Correlation-ID', correlationId);
        return c.json({ error: 'invalid request' }, 400);
      }
    }

    const input: RunRequest = raw as RunRequest;

    let response: RunResponse;
    try {
      response = await host.run(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      c.header('X-Correlation-ID', correlationId);
      if (message === 'session limit reached') {
        return c.json({ error: 'session limit reached' }, 429);
      }
      return c.json({ error: 'internal error' }, 500);
    }

    c.header('X-Correlation-ID', correlationId);
    return c.json(response, 200);
  });

  // ----------------------------------------------------------
  // POST /stop
  // AC-11: returns 202; host drains and transitions to 'stopped'
  // ----------------------------------------------------------
  app.post('/stop', (c) => {
    if (!isServiceAvailable(host.phase)) {
      return c.json({ error: 'service unavailable' }, 503);
    }

    // Fire-and-forget: drain happens asynchronously
    void host.stop();

    return c.json({ message: 'shutdown initiated' }, 202);
  });

  // ----------------------------------------------------------
  // POST /sessions/:id/abort
  // AC-21: 409 when session is already completed/failed
  // AC-20: 404 when session not found
  // ----------------------------------------------------------
  app.post('/sessions/:id/abort', (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    const session = host.getSession(id);
    if (session === undefined) {
      return c.json({ error: 'session not found' }, 404);
    }

    if (session.state === 'completed' || session.state === 'failed') {
      return c.json({ error: 'session not active' }, 409);
    }

    const aborted = host.abortSession(id);
    if (!aborted) {
      // Race condition: session completed between getSession and abortSession
      return c.json({ error: 'session not active' }, 409);
    }

    return c.json({ sessionId: id, state: 'failed' as const }, 200);
  });

  // ----------------------------------------------------------
  // POST /sessions/:id/pause  — blocked (AC-22)
  // POST /sessions/:id/resume — blocked
  // ----------------------------------------------------------
  app.post('/sessions/:id/pause', (c) => {
    return c.json(
      {
        error: 'not implemented',
        reason: 'awaiting core stepper serialization',
      },
      501
    );
  });

  app.post('/sessions/:id/resume', (c) => {
    return c.json(
      {
        error: 'not implemented',
        reason: 'awaiting core stepper serialization',
      },
      501
    );
  });

  // ----------------------------------------------------------
  // GET /healthz
  // AC-7: returns 200 with HealthStatus
  // AC-24: 503 during shutdown
  // ----------------------------------------------------------
  app.get('/healthz', (c) => {
    const status: HealthStatus = host.health();

    if (status.phase === 'stopped') {
      return c.json({ error: 'service unavailable' }, 503);
    }

    return c.json(status, 200);
  });

  // ----------------------------------------------------------
  // GET /readyz
  // AC-23: 503 when phase is 'init'
  // ----------------------------------------------------------
  app.get('/readyz', (c) => {
    if (!isServiceAvailable(host.phase)) {
      return c.json({ error: 'service unavailable' }, 503);
    }

    return c.json({ ready: true }, 200);
  });

  // ----------------------------------------------------------
  // GET /metrics
  // ----------------------------------------------------------
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

  // ----------------------------------------------------------
  // GET /sessions
  // ----------------------------------------------------------
  app.get('/sessions', (c) => {
    return c.json(host.sessions(), 200);
  });

  // ----------------------------------------------------------
  // GET /sessions/:id
  // AC-20: 404 for unknown ID
  // ----------------------------------------------------------
  app.get('/sessions/:id', (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    const session = host.getSession(id);
    if (session === undefined) {
      return c.json({ error: 'session not found' }, 404);
    }

    return c.json(session, 200);
  });

  // ----------------------------------------------------------
  // GET /sessions/:id/stream  — SSE
  // AC-9: emits step, capture, done events
  // AC-33: late connect receives buffered done event
  // ----------------------------------------------------------
  app.get('/sessions/:id/stream', (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    const session = host.getSession(id);
    if (session === undefined) {
      return c.json({ error: 'session not found' }, 404);
    }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return streamSSE(c, async (stream) => {
      const buffered = sseEventBuffers.get(id);

      // Late connect: session already has buffered events — replay and close
      if (buffered !== undefined && buffered.length > 0) {
        for (const evt of buffered) {
          await stream.writeSSE({ event: evt.event, data: evt.data });
        }
        await stream.close();
        return;
      }

      // Check if session is already terminal but buffer is empty/absent
      if (session.state === 'completed' || session.state === 'failed') {
        // Build a synthetic done event from the session record
        const doneData = JSON.stringify({
          sessionId: id,
          state: session.state,
          ...(session.value !== undefined && { value: session.value }),
          ...(session.error !== undefined && { error: session.error }),
        });
        await stream.writeSSE({ event: 'done', data: doneData });
        await stream.close();
        return;
      }

      // Live connect: register subscriber and wait for events
      await new Promise<void>((resolve) => {
        sseSubscribers.set(id, async (evt: SseEvent) => {
          try {
            await stream.writeSSE({ event: evt.event, data: evt.data });
          } catch {
            // Client disconnected; ignore write errors
          }

          if (evt.event === 'done') {
            sseSubscribers.delete(id);
            resolve();
          }
        });

        stream.onAbort(() => {
          sseSubscribers.delete(id);
          resolve();
        });
      });

      await stream.close();
    });
  });

  // ----------------------------------------------------------
  // GET /.well-known/agent-card.json
  // AC-10: returns AgentCard
  // ----------------------------------------------------------
  app.get('/.well-known/agent-card.json', (c) => {
    if (!isServiceAvailable(host.phase)) {
      return c.json({ error: 'service unavailable' }, 503);
    }

    return c.json(card, 200);
  });
}
