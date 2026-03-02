/**
 * createWorkerHarness — Cloudflare Workers fetch handler.
 * Wraps a ComposedHandlerMap in the Workers ExportedHandler fetch interface.
 * No TCP server is started; Cloudflare invokes fetch() directly.
 */

import { randomUUID } from 'node:crypto';
import type {
  ComposedHandlerMap,
  RunRequest,
  HandlerContext,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// WEB API GLOBALS (Cloudflare Workers provides these natively)
// ============================================================

// TypeScript does not include Request/Response in ES2022 lib.
// Workers runtime supplies them as globals. We declare minimal
// local type aliases and augment globalThis so the file compiles
// without adding "dom" to the shared base lib.

/** Minimal Workers Request shape used by this module. */
type WorkerRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
};

/** Minimal Workers Response shape — opaque; returned as-is to the runtime. */
type WorkerResponse = { readonly _brand: 'WorkerResponse' };

declare global {
  // Augment globalThis so `new globalThis.Response(...)` resolves correctly.
  var Response: {
    new (
      body: string,
      init?: { status?: number; headers?: Record<string, string> }
    ): WorkerResponse;
  };
}

// ============================================================
// PUBLIC INTERFACES
// ============================================================

/**
 * Cloudflare Workers ExportedHandler-compatible fetch interface.
 * IC-15: Implements the Workers fetch interface for agent dispatch.
 */
export interface WorkerHarness {
  fetch(
    request: WorkerRequest,
    env: Record<string, unknown>,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<WorkerResponse>;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Returns a Cloudflare Workers-compatible fetch handler.
 * AC-9: Dispatches to the correct agent by name from the URL path.
 * AC-14: Exported as the worker subpath entry point.
 *
 * Agent name resolution:
 * - URL path `/<agentName>/run` or `/<agentName>` → first path segment
 * - If handlers.size === 1, auto-detect (single-agent mode)
 *
 * Config from env:
 * - env bindings are passed as `{ env }` under HandlerContext.config
 */
export function createWorkerHarness(
  handlers: ComposedHandlerMap
): WorkerHarness {
  return {
    async fetch(
      request: WorkerRequest,
      env: Record<string, unknown>,
      _ctx: { waitUntil(p: Promise<unknown>): void }
    ): Promise<WorkerResponse> {
      // 1. Extract agentName from URL path
      const url = new URL(request.url);
      const segments = url.pathname.split('/').filter((s) => s.length > 0);
      const pathAgentName = segments[0];

      let agentName: string;

      if (handlers.size === 1) {
        // Single-agent mode: auto-detect the only registered agent
        agentName = handlers.keys().next().value as string;
      } else if (pathAgentName !== undefined && handlers.has(pathAgentName)) {
        agentName = pathAgentName;
      } else {
        return new globalThis.Response(
          JSON.stringify({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const handler = handlers.get(agentName);
      if (handler === undefined) {
        return new globalThis.Response(
          JSON.stringify({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 2. Correlation ID from header or generate
      const correlationId =
        request.headers.get('X-Correlation-ID') ?? randomUUID();

      // 3. Parse JSON body as RunRequest fields
      let runRequest: RunRequest = {};
      if (request.method === 'POST') {
        try {
          const bodyText = await request.text();
          if (bodyText.length > 0) {
            const parsed: unknown = JSON.parse(bodyText);
            if (
              parsed !== null &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed)
            ) {
              const body = parsed as Record<string, unknown>;
              runRequest = buildRunRequest(body, correlationId);
            }
          }
        } catch {
          // Malformed JSON — proceed with empty request
        }
      }

      // Override correlationId with header value (or generated) unless body provided one
      if (runRequest.correlationId === undefined) {
        (runRequest as { correlationId?: string }).correlationId =
          correlationId;
      }

      // 4. Build HandlerContext — env bindings passed as config.env section
      const config: Record<string, Record<string, unknown>> = typeof env ===
        'object' && env !== null
        ? { env: env as Record<string, unknown> }
        : {};

      const context: HandlerContext = {
        agentName,
        correlationId: runRequest.correlationId,
        config,
      };

      // 5. Dispatch to handler
      try {
        const response = await handler(runRequest, context);

        return new globalThis.Response(
          JSON.stringify({
            correlationId: runRequest.correlationId,
            state: response.state,
            result: response.result,
          }),
          {
            status: response.state === 'failed' ? 500 : 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Correlation-ID': runRequest.correlationId ?? correlationId,
            },
          }
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCode =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof (err as { code: unknown }).code === 'string'
            ? (err as { code: string }).code
            : 'RUNTIME_ERROR';

        return new globalThis.Response(
          JSON.stringify({ error: errorMessage, code: errorCode }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    },
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Extracts RunRequest fields from a parsed JSON body object.
 * Unknown keys are silently ignored.
 */
function buildRunRequest(
  body: Record<string, unknown>,
  correlationId: string
): RunRequest {
  const request: RunRequest = { correlationId };

  if (
    body['params'] !== undefined &&
    body['params'] !== null &&
    typeof body['params'] === 'object' &&
    !Array.isArray(body['params'])
  ) {
    (request as { params?: Record<string, unknown> }).params = body[
      'params'
    ] as Record<string, unknown>;
  }

  if (typeof body['timeout'] === 'number') {
    (request as { timeout?: number }).timeout = body['timeout'];
  }

  if (typeof body['correlationId'] === 'string') {
    (request as { correlationId?: string }).correlationId =
      body['correlationId'];
  }

  return request;
}
