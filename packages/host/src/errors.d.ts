/**
 * Error types for rill-host.
 * Shared by all modules in the package.
 */
import type { HostErrorPhase } from './types.js';
/**
 * Base error for all AgentHost failures.
 * Extends Error with structured phase context and optional cause.
 */
export declare class AgentHostError extends Error {
    /** Lifecycle phase where the error occurred. */
    readonly phase: HostErrorPhase;
    constructor(message: string, phase: HostErrorPhase, cause?: unknown);
}
//# sourceMappingURL=errors.d.ts.map