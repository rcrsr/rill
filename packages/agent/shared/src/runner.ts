import type { RillValue } from '@rcrsr/rill';

// ============================================================
// IN-PROCESS RUN REQUEST / RESPONSE
// ============================================================

/**
 * Minimal run request for in-process agent invocation.
 * Mirrors the subset of @rcrsr/rill-host RunRequest used by bindHost.
 */
export interface InProcessRunRequest {
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
 * Minimal run response for in-process agent invocation.
 * Mirrors the subset of @rcrsr/rill-host RunResponse used by bindHost.
 */
export interface InProcessRunResponse {
  readonly state: 'running' | 'completed' | 'failed';
  readonly result?: RillValue | undefined;
}

// ============================================================
// AGENT RUNNER
// ============================================================

/**
 * Minimal interface for per-agent in-process routing.
 * Implemented by AgentHost from @rcrsr/rill-host.
 * Defined here to avoid a circular package dependency.
 */
export interface AgentRunner {
  runForAgent(
    agentName: string,
    input: InProcessRunRequest
  ): Promise<InProcessRunResponse>;
}
