/**
 * HTTP route definitions for rill-host.
 *
 * Registers all endpoints on a Hono app instance.
 */

import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { InputSchema } from '@rcrsr/rill-agent-shared';
import type { AgentCard } from './host.js';
import type {
  LifecyclePhase,
  RunRequest,
  RunResponse,
  HealthStatus,
  SessionRecord,
} from './types.js';

// ============================================================
// INPUT VALIDATION TYPES
// ============================================================

/**
 * A single field-level issue found by validateInputParams().
 */
export interface InputValidationIssue {
  readonly param: string;
  readonly message: string;
}

/**
 * Response body shape for a 400 returned when input params fail validation.
 */
export interface InputValidationErrorBody {
  readonly error: 'invalid params';
  readonly fields: readonly InputValidationIssue[];
}

// ============================================================
// INPUT VALIDATION HELPERS
// ============================================================

/**
 * Maps a JavaScript runtime value to its Rill type name.
 * Returns the same set of names used in InputParamDescriptor.type,
 * except booleans map to "boolean" (the JS name) for error messages.
 */
function jsTypeLabel(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object' && value !== null) return 'dict';
  return typeof value;
}

/**
 * Returns true when the provided value satisfies the Rill type declared in
 * the schema descriptor.
 */
function matchesRillType(
  value: unknown,
  rillType: 'string' | 'number' | 'bool' | 'list' | 'dict'
): boolean {
  switch (rillType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'bool':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'dict':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
  }
}

/**
 * Converts a Rill type name to the label used in error messages.
 * bool → "boolean"; all others are unchanged.
 */
function rillTypeLabel(
  rillType: 'string' | 'number' | 'bool' | 'list' | 'dict'
): string {
  return rillType === 'bool' ? 'boolean' : rillType;
}

/**
 * Validates params against an InputSchema.
 *
 * - Returns [] when all required params are present and all types match.
 * - Returns ALL failures in a single call — does NOT short-circuit.
 * - Checks required params first, then type mismatches (both can appear).
 * - Issues appear in manifest declaration order (key order of inputSchema).
 * - Missing optional params produce NO issue.
 * - Extra params not in inputSchema produce NO issue (permissive mode).
 * - undefined params is treated as {} — all required params missing.
 * - null for a required param fails the required check.
 */
export function validateInputParams(
  params: Record<string, unknown> | undefined,
  inputSchema: InputSchema
): InputValidationIssue[] {
  const resolved: Record<string, unknown> = params ?? {};
  const issues: InputValidationIssue[] = [];

  for (const [param, descriptor] of Object.entries(inputSchema)) {
    const provided = Object.prototype.hasOwnProperty.call(resolved, param);
    const value = resolved[param];

    // Required check: param absent, or present with null value
    if (descriptor.required === true) {
      if (!provided || value === null) {
        issues.push({ param, message: 'required' });
        continue; // type check is meaningless without a value
      }
    }

    // Type check: only when param is actually present and not null
    if (provided && value !== null && value !== undefined) {
      if (!matchesRillType(value, descriptor.type)) {
        const expected = rillTypeLabel(descriptor.type);
        const got = jsTypeLabel(value);
        issues.push({ param, message: `expected ${expected}, got ${got}` });
      }
    }
  }

  return issues;
}

/**
 * Returns a new params object with defaults from inputSchema injected for
 * absent keys. Never mutates the original params object.
 *
 * - Caller-provided values always take precedence.
 * - Params not in inputSchema pass through unchanged.
 * - null is a valid default and will be injected.
 */
export function injectDefaults(
  params: Record<string, unknown>,
  inputSchema: InputSchema
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };

  for (const [param, descriptor] of Object.entries(inputSchema)) {
    if (
      descriptor.default !== undefined &&
      !Object.prototype.hasOwnProperty.call(result, param)
    ) {
      result[param] = descriptor.default;
    }
  }

  return result;
}

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
// SSE STORE INTERFACE
// ============================================================

/**
 * Holds the two Maps that host.ts populates during execution
 * and route handlers read from to serve SSE clients.
 */
export interface SseStore {
  readonly eventBuffers: Map<string, SseEvent[]>;
  readonly subscribers: Map<string, (event: SseEvent) => void>;
}

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
  sessions(): Promise<SessionRecord[]>;
  /** Delegates to SessionManager.abort(). Returns false if not found or already terminal. */
  abortSession(id: string): boolean;
  /** Delegates to SessionManager.get(). Returns undefined if not found or TTL elapsed. */
  getSession(id: string): Promise<SessionRecord | undefined>;
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
 * @param sseStore - Shared SSE event buffers and subscriber callbacks
 * @param inputSchema - Optional input parameter schema for POST /run validation
 */
export function registerRoutes(
  app: Hono,
  host: RouteHost,
  card: AgentCard,
  sseStore: SseStore,
  inputSchema?: InputSchema | undefined
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
    if (raw['trigger'] !== undefined) {
      const t = raw['trigger'];
      const isValidString = typeof t === 'string' && validTriggers.has(t);
      const isValidObject =
        typeof t === 'object' &&
        t !== null &&
        !Array.isArray(t) &&
        (t as Record<string, unknown>)['type'] === 'agent' &&
        typeof (t as Record<string, unknown>)['agentName'] === 'string' &&
        typeof (t as Record<string, unknown>)['sessionId'] === 'string';
      if (!isValidString && !isValidObject) {
        c.header('X-Correlation-ID', correlationId);
        return c.json({ error: 'invalid request' }, 400);
      }
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

    // Validate and inject defaults when inputSchema has keys (IR-5, EC-11, EC-12, EC-13, AC-6)
    if (inputSchema !== undefined && Object.keys(inputSchema).length > 0) {
      const issues = validateInputParams(
        raw['params'] as Record<string, unknown> | undefined,
        inputSchema
      );
      if (issues.length > 0) {
        const body: InputValidationErrorBody = {
          error: 'invalid params',
          fields: issues,
        };
        c.header('X-Correlation-ID', correlationId);
        return c.json(body, 400);
      }
      raw['params'] = injectDefaults(
        (raw['params'] as Record<string, unknown>) ?? {},
        inputSchema
      );
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
  app.post('/sessions/:id/abort', async (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    let session: SessionRecord | undefined;
    try {
      session = await host.getSession(id);
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }

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
  app.get('/sessions', async (c) => {
    let records: SessionRecord[];
    try {
      records = await host.sessions();
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }
    return c.json(records, 200);
  });

  // ----------------------------------------------------------
  // GET /sessions/:id
  // AC-20: 404 for unknown ID
  // ----------------------------------------------------------
  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    let session: SessionRecord | undefined;
    try {
      session = await host.getSession(id);
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }

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
  app.get('/sessions/:id/stream', async (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ error: 'session not found' }, 404);
    }

    let session: SessionRecord | undefined;
    try {
      session = await host.getSession(id);
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }

    if (session === undefined) {
      return c.json({ error: 'session not found' }, 404);
    }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return streamSSE(c, async (stream) => {
      const buffered = sseStore.eventBuffers.get(id);

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
          ...(session.result !== undefined && { result: session.result }),
          ...(session.error !== undefined && { error: session.error }),
        });
        await stream.writeSSE({ event: 'done', data: doneData });
        await stream.close();
        return;
      }

      // Live connect: register subscriber and wait for events
      await new Promise<void>((resolve) => {
        sseStore.subscribers.set(id, async (evt: SseEvent) => {
          try {
            await stream.writeSSE({ event: evt.event, data: evt.data });
          } catch {
            // Client disconnected; ignore write errors
          }

          if (evt.event === 'done') {
            sseStore.subscribers.delete(id);
            resolve();
          }
        });

        stream.onAbort(() => {
          sseStore.subscribers.delete(id);
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
