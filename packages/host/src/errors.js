/**
 * Error types for rill-host.
 * Shared by all modules in the package.
 */
// ============================================================
// BASE ERROR
// ============================================================
/**
 * Base error for all AgentHost failures.
 * Extends Error with structured phase context and optional cause.
 */
export class AgentHostError extends Error {
    /** Lifecycle phase where the error occurred. */
    phase;
    constructor(message, phase, cause) {
        super(message, cause !== undefined ? { cause } : undefined);
        this.name = 'AgentHostError';
        this.phase = phase;
    }
}
//# sourceMappingURL=errors.js.map