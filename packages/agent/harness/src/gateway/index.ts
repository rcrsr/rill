/**
 * createGatewayHarness — Lambda API Gateway adapter for ComposedHandlerMap.
 * Resolves agent name from path parameters or path segments, then delegates
 * to the matching ComposedHandler.
 */

import { randomUUID } from 'node:crypto';
import type {
  ComposedHandlerMap,
  RunRequest,
  HandlerContext,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// GATEWAY INTERFACES
// ============================================================

export interface GatewayEvent {
  readonly body: string | null;
  readonly headers: Record<string, string | undefined>;
  readonly httpMethod: string;
  readonly path: string;
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: unknown;
}

export interface GatewayContext {
  readonly functionName?: string | undefined;
  readonly requestId?: string | undefined;
  getRemainingTimeInMillis?(): number;
}

export interface GatewayResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export type GatewayHandler = (
  event: GatewayEvent,
  context: GatewayContext
) => Promise<GatewayResponse>;

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve agent name from event using three strategies:
 * 1. event.pathParameters.agentName
 * 2. First path segment after leading slash
 * 3. Single-agent mode: sole key in handlers map
 * Returns undefined if none of the above succeed.
 */
function resolveAgentName(
  event: GatewayEvent,
  handlers: ComposedHandlerMap
): string | undefined {
  // Strategy 1: explicit path parameter
  const fromPathParam = event.pathParameters?.['agentName'];
  if (fromPathParam !== undefined && fromPathParam !== '') {
    return fromPathParam;
  }

  // Strategy 2: parse first segment from event.path
  const segments = event.path.split('/').filter((s) => s.length > 0);
  if (segments.length > 0 && segments[0] !== undefined) {
    return segments[0];
  }

  // Strategy 3: single-agent auto-detect
  if (handlers.size === 1) {
    return handlers.keys().next().value as string;
  }

  return undefined;
}

/**
 * Parse event.body as JSON. Extracts params, config, timeout, correlationId.
 * Returns defaults for absent or malformed body.
 */
function parseBody(body: string | null): {
  params: Record<string, unknown> | undefined;
  config: Record<string, Record<string, unknown>> | undefined;
  timeout: number | undefined;
  correlationId: string | undefined;
} {
  if (body === null || body === '') {
    return {
      params: undefined,
      config: undefined,
      timeout: undefined,
      correlationId: undefined,
    };
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        params: undefined,
        config: undefined,
        timeout: undefined,
        correlationId: undefined,
      };
    }

    const obj = parsed as Record<string, unknown>;

    const params =
      obj['params'] !== undefined &&
      obj['params'] !== null &&
      typeof obj['params'] === 'object' &&
      !Array.isArray(obj['params'])
        ? (obj['params'] as Record<string, unknown>)
        : undefined;

    const config =
      obj['config'] !== undefined &&
      obj['config'] !== null &&
      typeof obj['config'] === 'object' &&
      !Array.isArray(obj['config'])
        ? (obj['config'] as Record<string, Record<string, unknown>>)
        : undefined;

    const timeout =
      typeof obj['timeout'] === 'number' ? obj['timeout'] : undefined;

    const correlationId =
      typeof obj['correlationId'] === 'string'
        ? obj['correlationId']
        : undefined;

    return { params, config, timeout, correlationId };
  } catch {
    return {
      params: undefined,
      config: undefined,
      timeout: undefined,
      correlationId: undefined,
    };
  }
}

/**
 * Build a JSON error GatewayResponse with the given status code.
 */
function errorResponse(statusCode: number, message: string): GatewayResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Returns a GatewayHandler that dispatches Lambda API Gateway events
 * to the appropriate ComposedHandler by agent name.
 *
 * AC-7: Dispatches to correct agent by name.
 * AC-56: Single-agent mode auto-detects from sole handler.
 * AC-13: Subpath export resolves.
 */
export function createGatewayHarness(
  handlers: ComposedHandlerMap
): GatewayHandler {
  return async function gatewayHandler(
    event: GatewayEvent,
    context: GatewayContext
  ): Promise<GatewayResponse> {
    // Step 1: Resolve agent name
    const agentName = resolveAgentName(event, handlers);
    if (agentName === undefined) {
      return errorResponse(
        400,
        'Agent name could not be determined from request'
      );
    }

    // Step 2: Get handler from map
    const handler = handlers.get(agentName);
    if (handler === undefined) {
      return errorResponse(404, `Agent not found: ${agentName}`);
    }

    // Step 3: Parse body
    const {
      params,
      config,
      timeout: bodyTimeout,
      correlationId: bodyCorrelationId,
    } = parseBody(event.body);

    // Step 4: Resolve correlation ID
    const correlationId =
      event.headers['X-Correlation-ID'] ??
      event.headers['x-correlation-id'] ??
      bodyCorrelationId ??
      randomUUID();

    // Step 5: Resolve timeout (body takes precedence over Lambda remaining time)
    const resolvedTimeout = bodyTimeout ?? context.getRemainingTimeInMillis?.();

    // Step 6: Build RunRequest
    const request: RunRequest = {
      params,
      correlationId,
      ...(resolvedTimeout !== undefined ? { timeout: resolvedTimeout } : {}),
    };

    // Step 7: Build HandlerContext
    const handlerContext: HandlerContext = {
      agentName,
      correlationId,
      config: config ?? {},
    };

    // Step 8: Call handler and translate response
    try {
      const response = await handler(request, handlerContext);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(500, message);
    }
  };
}
