/**
 * createAgentHandler — serverless handler for Lambda deployment.
 * Translates API Gateway events to RunRequest and returns HandlerResponse.
 * No TCP server is started.
 */

import { randomUUID } from 'node:crypto';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import type { ObservabilityCallbacks } from '@rcrsr/rill';
import { SessionManager } from './session.js';
import {
  sessionsTotal,
  sessionsActive,
  executionDurationSeconds,
  hostCallsTotal,
  stepsTotal,
} from './metrics.js';
import type { ComposedAgent } from './host.js';
import type { RunRequest } from './types.js';

// ============================================================
// SERVERLESS INTERFACES
// ============================================================

export interface APIGatewayEvent {
  readonly httpMethod: string;
  readonly path: string;
  readonly headers: Record<string, string | undefined>;
  readonly body: string | null;
}

export interface LambdaContext {
  readonly functionName: string;
  readonly awsRequestId: string;
  getRemainingTimeInMillis(): number;
}

export interface HandlerResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface AgentHandler {
  (event: APIGatewayEvent, context: LambdaContext): Promise<HandlerResponse>;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULTS = {
  maxConcurrentSessions: 10,
  sessionTtl: 3600000,
} as const;

// ============================================================
// FACTORY
// ============================================================

/**
 * Returns a serverless handler function for Lambda deployment.
 * EC-4: agent null/undefined → TypeError('agent is required') thrown synchronously.
 * EC-5: Unhandled runtime error → 500 HandlerResponse (not thrown).
 * AC-8: No TCP server created.
 */
export function createAgentHandler(agent: ComposedAgent): AgentHandler {
  if (agent == null) {
    throw new TypeError('agent is required');
  }

  const sessionManager = new SessionManager({
    maxConcurrentSessions: DEFAULTS.maxConcurrentSessions,
    sessionTtl: DEFAULTS.sessionTtl,
  });

  return async function handler(
    event: APIGatewayEvent,
    _context: LambdaContext
  ): Promise<HandlerResponse> {
    // Translate API Gateway event to RunRequest
    const input: RunRequest = buildRunRequest(event);

    // Prune expired sessions before creating a new one
    sessionManager.prune();

    const correlationId = randomUUID();

    try {
      const record = sessionManager.create(input, correlationId);
      const sessionId = record.id;

      sessionsActive.inc();

      const sessionController = sessionManager.getController(sessionId);
      const controller = sessionController!;

      const observability: ObservabilityCallbacks = {
        onStepEnd() {
          stepsTotal.inc();
          record.stepCount++;
        },
        onHostCall(event) {
          hostCallsTotal.labels({ function: event.name }).inc();
        },
      };

      const baseContext = agent.context;
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
      });

      for (const [name, fn] of baseContext.functions) {
        sessionContext.functions.set(name, fn);
      }

      const executionStart = Date.now();

      try {
        const result = await execute(agent.ast, sessionContext);
        const durationMs = Date.now() - executionStart;

        executionDurationSeconds.observe(durationMs / 1000);
        record.state = 'completed';
        record.durationMs = durationMs;
        record.result = result.result;
        record.variables = result.variables;

        sessionsActive.dec();
        sessionsTotal
          .labels({ state: 'completed', trigger: input.trigger ?? 'api' })
          .inc();

        const responseBody = JSON.stringify({
          sessionId,
          correlationId,
          state: 'completed',
          result: result.result,
          durationMs,
        });

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: responseBody,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - executionStart;

        executionDurationSeconds.observe(durationMs / 1000);
        record.state = 'failed';
        record.durationMs = durationMs;
        record.error = err instanceof Error ? err.message : String(err);

        console.error(
          `[rill-host] session ${sessionId} failed: ${record.error}`
        );

        sessionsActive.dec();
        sessionsTotal
          .labels({ state: 'failed', trigger: input.trigger ?? 'api' })
          .inc();

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCode =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof (err as { code: unknown }).code === 'string'
            ? (err as { code: string }).code
            : 'RUNTIME_ERROR';

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: errorMessage, code: errorCode }),
        };
      }
    } catch (err: unknown) {
      // Errors from sessionManager.create() (capacity) or other setup errors
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode =
        err != null &&
        typeof err === 'object' &&
        'code' in err &&
        typeof (err as { code: unknown }).code === 'string'
          ? (err as { code: string }).code
          : 'SETUP_ERROR';

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorMessage, code: errorCode }),
      };
    }
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Translates an API Gateway event body into a RunRequest.
 * Body is expected to be JSON. Invalid or absent body yields empty params.
 */
function buildRunRequest(event: APIGatewayEvent): RunRequest {
  if (event.body === null || event.body === '') {
    return { trigger: 'http' };
  }

  try {
    const parsed: unknown = JSON.parse(event.body);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const body = parsed as Record<string, unknown>;
      const request: RunRequest = { trigger: 'http' };
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
      if (typeof body['callback'] === 'string') {
        (request as { callback?: string }).callback = body['callback'];
      }
      return request;
    }
  } catch {
    // Malformed JSON — return trigger only
  }

  return { trigger: 'http' };
}
