/**
 * dispatch() — pure "execute one run" function for rill agents.
 *
 * Encapsulates: session creation, timeout enforcement, handler invocation,
 * metrics recording, and session finalization.
 *
 * Every transport calls dispatch — transports differ only in how they receive
 * requests and send responses.
 */

import { randomUUID } from 'node:crypto';
import type { RillValue } from '@rcrsr/rill';
import type {
  ComposedHandler,
  HandlerContext,
  RunRequest,
} from '@rcrsr/rill-agent-shared';
import type { SessionManager } from './session.js';
import type { MetricsBundle } from './metrics.js';
import type { RunRequest as LocalRunRequest, SessionState } from './types.js';

// ============================================================
// DISPATCH OPTIONS
// ============================================================

export interface DispatchOptions {
  readonly handler: ComposedHandler;
  readonly request: RunRequest;
  readonly context: HandlerContext;
  readonly sessionManager: SessionManager;
  readonly metrics?: MetricsBundle | undefined;
  readonly signal?: AbortSignal | undefined;
}

// ============================================================
// DISPATCH RESULT
// ============================================================

export interface DispatchResult {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly result?: RillValue | undefined;
  readonly error?: { code: string; message: string } | undefined;
  readonly durationMs: number;
}

// ============================================================
// DISPATCH FUNCTION
// ============================================================

/**
 * Executes a single agent run synchronously to completion.
 * Creates a session, invokes the handler, records metrics, and
 * finalizes the session before resolving.
 *
 * Does NOT implement SSE, responseTimeout, or callback delivery.
 */
export async function dispatch(
  options: DispatchOptions
): Promise<DispatchResult> {
  const { handler, request, context, sessionManager, metrics } = options;

  const agentName = context.agentName;
  const correlationId = request.correlationId ?? randomUUID();

  // Create session — throws AgentHostError('session limit reached') at capacity
  const record = sessionManager.create(
    request as unknown as LocalRunRequest,
    correlationId,
    agentName
  );
  const sessionId = record.id;

  metrics?.sessionsActive.labels({ agent: agentName }).inc();

  const executionStart = Date.now();

  try {
    const response = await handler(request, context);
    const durationMs = Date.now() - executionStart;

    metrics?.executionDurationSeconds
      .labels({ agent: agentName })
      .observe(durationMs / 1000);
    metrics?.sessionsActive.labels({ agent: agentName }).dec();
    metrics?.sessionsTotal
      .labels({
        state: 'completed',
        trigger:
          typeof request.trigger === 'object'
            ? request.trigger.type
            : (request.trigger ?? 'api'),
        agent: agentName,
      })
      .inc();

    record.state = 'completed';
    record.durationMs = durationMs;
    if (response.result !== undefined) {
      record.result = response.result;
    }

    return {
      sessionId,
      state: response.state,
      result: response.result,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - executionStart;
    const errorMessage = err instanceof Error ? err.message : String(err);

    metrics?.executionDurationSeconds
      .labels({ agent: agentName })
      .observe(durationMs / 1000);
    metrics?.sessionsActive.labels({ agent: agentName }).dec();
    metrics?.sessionsTotal
      .labels({
        state: 'failed',
        trigger:
          typeof request.trigger === 'object'
            ? request.trigger.type
            : (request.trigger ?? 'api'),
        agent: agentName,
      })
      .inc();

    record.state = 'failed';
    record.durationMs = durationMs;
    record.error = errorMessage;

    return {
      sessionId,
      state: 'failed',
      error: { code: 'EXECUTION_ERROR', message: errorMessage },
      durationMs,
    };
  }
}
