/**
 * Error types for rill-host.
 * Shared by all modules in the package.
 */

import type { HostErrorPhase } from './types.js';

// ============================================================
// BASE ERROR
// ============================================================

/**
 * Base error for all AgentHost failures.
 * Extends Error with structured phase context and optional cause.
 */
export class AgentHostError extends Error {
  /** Lifecycle phase where the error occurred. */
  readonly phase: HostErrorPhase;

  constructor(message: string, phase: HostErrorPhase, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AgentHostError';
    this.phase = phase;
  }
}
