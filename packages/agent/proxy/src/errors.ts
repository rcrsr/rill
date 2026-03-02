/**
 * Error types for rill-agent-proxy.
 * Shared by all modules in the package.
 */

// ============================================================
// ERROR CODES
// ============================================================

export const PROXY_CONCURRENCY_LIMIT = 'PROXY_CONCURRENCY_LIMIT';
export const PROXY_CHILD_CRASH = 'PROXY_CHILD_CRASH';
export const PROXY_TIMEOUT = 'PROXY_TIMEOUT';
export const PROXY_AHI_TARGET_MISSING = 'PROXY_AHI_TARGET_MISSING';
export const PROXY_SPAWN_ERROR = 'PROXY_SPAWN_ERROR';
export const PROXY_PROTOCOL_ERROR = 'PROXY_PROTOCOL_ERROR';

// ============================================================
// BASE ERROR
// ============================================================

/**
 * Base error for all rill-agent-proxy failures.
 * Extends Error with a structured error code, optional agent name, and detail.
 */
export class ProxyError extends Error {
  /** Machine-readable error code (one of the PROXY_* constants). */
  readonly code: string;
  /** Agent name involved in the error, if applicable. */
  readonly agentName?: string | undefined;
  /** Additional detail about the failure. */
  readonly detail?: string | undefined;

  constructor(
    message: string,
    code: string,
    agentName?: string | undefined,
    detail?: string | undefined
  ) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    this.agentName = agentName;
    this.detail = detail;
  }
}
