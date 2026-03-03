/**
 * HTTP harness factory for rill agents.
 *
 * Accepts a ComposedHandlerMap and provides HTTP transport with
 * route layout per IC-8: /:agentName/run, /healthz, /readyz, /metrics, /stop.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type {
  AgentCard,
  ComposedHandler,
  ComposedHandlerMap,
  RunRequest,
  RunResponse,
  HandlerContext,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// PUBLIC INTERFACES
// ============================================================

/**
 * Options for createHttpHarness.
 *
 * All fields optional; sensible defaults apply.
 */
export interface HttpHarnessOptions {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly maxConcurrentSessions?: number | undefined;
  readonly sessionTtl?: number | undefined;
  readonly registryUrl?: string | undefined;
  readonly logLevel?: 'silent' | 'info' | 'debug' | undefined;
  readonly cards?: Map<string, AgentCard> | undefined;
}

/**
 * Handle returned by createHttpHarness.
 * IC-9: minimal listen/close interface.
 */
export interface HttpHarness {
  listen(): Promise<void>;
  close(): Promise<void>;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Parses the request body and builds RunRequest + HandlerContext,
 * then invokes the handler and returns a JSON Response.
 */
async function invokeHandler(
  agentName: string,
  handler: ComposedHandler,
  rawBody: Record<string, unknown>
): Promise<
  | { ok: true; response: RunResponse }
  | { ok: false; status: number; error: string }
> {
  const params =
    typeof rawBody['params'] === 'object' &&
    rawBody['params'] !== null &&
    !Array.isArray(rawBody['params'])
      ? (rawBody['params'] as Record<string, unknown>)
      : undefined;

  const config =
    typeof rawBody['config'] === 'object' &&
    rawBody['config'] !== null &&
    !Array.isArray(rawBody['config'])
      ? (rawBody['config'] as Record<string, Record<string, unknown>>)
      : {};

  const timeout =
    typeof rawBody['timeout'] === 'number' ? rawBody['timeout'] : undefined;

  const correlationId =
    typeof rawBody['correlationId'] === 'string'
      ? rawBody['correlationId']
      : randomUUID();

  const request: RunRequest = {
    params,
    timeout,
    correlationId,
    trigger: 'http' as const,
  };

  const context: HandlerContext = {
    agentName,
    correlationId,
    config,
  };

  try {
    const response = await handler(request, context);
    return { ok: true, response };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'session limit reached') {
      return { ok: false, status: 429, error: 'session limit reached' };
    }
    return { ok: false, status: 500, error: 'internal error' };
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates an HTTP harness that mounts ComposedHandler functions
 * at named agent routes and serves standard infrastructure endpoints.
 *
 * AC-2: Multi-agent — each handler mounted at /:agentName/run
 * AC-3: Single-agent — also mounted at /run root route
 * AC-15: POST /stop returns 202
 * AC-53: GET /healthz returns { status: 'ok' }
 * AC-54: GET /readyz returns { ready: true }
 */
export function createHttpHarness(
  handlers: ComposedHandlerMap,
  options?: HttpHarnessOptions | undefined
): HttpHarness {
  const port = options?.port ?? DEFAULT_PORT;
  const hostname = options?.host ?? DEFAULT_HOST;
  const cards = options?.cards;

  const app = new Hono();

  let server: ServerType | undefined;
  let ready = true;
  let sigtermListener: (() => void) | undefined;
  let sigintListener: (() => void) | undefined;

  // ----------------------------------------------------------
  // AGENT RUN ROUTES
  // IC-8: /:agentName/run POST
  // AC-2: multi-agent — mounted per name
  // ----------------------------------------------------------
  for (const [agentName, handler] of handlers) {
    // Capture agentName and handler in closure per iteration
    const name = agentName;
    const fn = handler;

    app.post(`/:agentName/run`, async (c) => {
      const routeName = c.req.param('agentName');
      if (routeName !== name) {
        return c.json({ error: 'not found' }, 404);
      }

      let body: unknown;
      try {
        body = await c.req.json<unknown>();
      } catch {
        return c.json({ error: 'invalid request' }, 400);
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return c.json({ error: 'invalid request' }, 400);
      }

      const result = await invokeHandler(
        name,
        fn,
        body as Record<string, unknown>
      );
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 429 | 500);
      }
      return c.json(result.response, 200);
    });

    app.get(`/:agentName/card`, (c) => {
      const routeName = c.req.param('agentName');
      if (routeName !== name) {
        return c.json({ error: 'not found' }, 404);
      }

      const card = cards?.get(name);
      if (card === undefined) {
        return c.json({ error: 'not found' }, 404);
      }

      return c.json(card, 200);
    });
  }

  // ----------------------------------------------------------
  // AC-3: Single-agent — also mounted at /run root route
  // ----------------------------------------------------------
  if (handlers.size === 1) {
    const entry = Array.from(handlers.entries())[0];
    if (entry !== undefined) {
      const [singleName, singleHandler] = entry;

      app.post('/run', async (c) => {
        let body: unknown;
        try {
          body = await c.req.json<unknown>();
        } catch {
          return c.json({ error: 'invalid request' }, 400);
        }

        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return c.json({ error: 'invalid request' }, 400);
        }

        const result = await invokeHandler(
          singleName,
          singleHandler,
          body as Record<string, unknown>
        );
        if (!result.ok) {
          return c.json({ error: result.error }, result.status as 429 | 500);
        }
        return c.json(result.response, 200);
      });
    }
  }

  // ----------------------------------------------------------
  // GET /healthz — AC-53
  // ----------------------------------------------------------
  app.get('/healthz', (c) => {
    return c.json({ status: 'ok', phase: 'ready' }, 200);
  });

  // ----------------------------------------------------------
  // GET /readyz — AC-54
  // ----------------------------------------------------------
  app.get('/readyz', (c) => {
    if (!ready) {
      return c.json({ ready: false }, 503);
    }
    return c.json({ ready: true }, 200);
  });

  // ----------------------------------------------------------
  // GET /metrics
  // ----------------------------------------------------------
  app.get('/metrics', (c) => {
    return c.text('', 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
  });

  // ----------------------------------------------------------
  // POST /stop — AC-15
  // ----------------------------------------------------------
  app.post('/stop', (c) => {
    ready = false;
    // Close server asynchronously after response is sent
    setTimeout(() => {
      if (server !== undefined) {
        server.close();
      }
    }, 0);
    return c.json({ message: 'shutdown initiated' }, 202);
  });

  // ----------------------------------------------------------
  // IC-8: GET /:agentName/sessions
  // ----------------------------------------------------------
  app.get('/:agentName/sessions', (c) => {
    return c.json([], 200);
  });

  // ----------------------------------------------------------
  // HARNESS INTERFACE
  // ----------------------------------------------------------

  return {
    listen(): Promise<void> {
      return new Promise<void>((resolve) => {
        server = serve({ fetch: app.fetch, port, hostname }, () => {
          resolve();
        });

        sigtermListener = () => {
          ready = false;
          if (server !== undefined) {
            server.close(() => {
              process.exit(0);
            });
          } else {
            process.exit(0);
          }
        };

        sigintListener = () => {
          ready = false;
          if (server !== undefined) {
            server.close();
          }
          process.exit(1);
        };

        process.on('SIGTERM', sigtermListener);
        process.on('SIGINT', sigintListener);
      });
    },

    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        ready = false;
        if (sigtermListener !== undefined) {
          process.off('SIGTERM', sigtermListener);
          sigtermListener = undefined;
        }
        if (sigintListener !== undefined) {
          process.off('SIGINT', sigintListener);
          sigintListener = undefined;
        }
        if (server === undefined) {
          resolve();
          return;
        }
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
