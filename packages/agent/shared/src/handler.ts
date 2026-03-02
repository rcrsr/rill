import type { RillValue } from '@rcrsr/rill';

// ============================================================
// RUN REQUEST / RESPONSE
// ============================================================

/**
 * Payload for triggering an in-process agent run.
 */
export interface RunRequest {
  readonly params?: Record<string, unknown> | undefined;
  /** Caller-provided correlation ID forwarded for in-process AHI chains. */
  readonly correlationId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly trigger?:
    | string
    | {
        readonly type: 'agent';
        readonly agentName: string;
        readonly sessionId: string;
      };
}

/**
 * Response from an in-process agent run.
 */
export interface RunResponse {
  readonly state: 'running' | 'completed' | 'failed';
  readonly result?: RillValue | undefined;
}

// ============================================================
// HANDLER CONTEXT
// ============================================================

/**
 * Execution context passed to a ComposedHandler invocation.
 */
export interface HandlerContext {
  /** Agent name this handler belongs to. */
  readonly agentName: string;
  /** Caller-provided correlation ID for request tracing. */
  readonly correlationId?: string | undefined;
  /** Caller-provided session ID. */
  readonly sessionId?: string | undefined;
  /** Agent configuration keyed by section name. */
  readonly config: Record<string, Record<string, unknown>>;
  /** Optional log callback. Receives the value passed to `log` in scripts. */
  readonly onLog?: ((value: RillValue) => void) | undefined;
}

// ============================================================
// COMPOSED HANDLER
// ============================================================

/**
 * A function that executes a single agent run given a request and context.
 */
export type ComposedHandler = (
  request: RunRequest,
  context: HandlerContext
) => Promise<RunResponse>;

// ============================================================
// COMPOSED HANDLER MAP
// ============================================================

/**
 * Maps agent names to their handler functions.
 */
export type ComposedHandlerMap = Map<string, ComposedHandler>;
