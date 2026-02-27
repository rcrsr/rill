/**
 * SessionManager — tracks active script execution sessions.
 * Enforces concurrency limits and TTL-based pruning.
 */
import type { RunRequest, SessionRecord } from './types.js';
export interface SessionManagerConfig {
    readonly maxConcurrentSessions: number;
    readonly sessionTtl: number;
    readonly agentCaps?: Map<string, number> | undefined;
}
/**
 * Manages session lifecycle: creation, retrieval, abort, listing, and pruning.
 * Internal to rill-host — not exported from index.ts.
 */
export declare class SessionManager {
    private readonly sessions;
    private readonly config;
    constructor(config: SessionManagerConfig);
    /** Number of sessions with state === 'running'. */
    get activeCount(): number;
    /**
     * Number of running sessions owned by the given agent.
     * Returns 0 for unknown agent names. Never throws [EC-10].
     */
    activeCountFor(agentName: string): number;
    /**
     * Creates and stores a new session.
     * Throws AgentHostError('capacity') if the global concurrency limit is
     * reached [EC-8] or the per-agent cap is exceeded [EC-9].
     */
    create(request: RunRequest, correlationId: string, agentName?: string): SessionRecord;
    /** Returns the session record for the given ID, or undefined if not found. */
    get(id: string): SessionRecord | undefined;
    /**
     * Returns the AbortController for a session.
     * Used by host.ts to signal cancellation during execution.
     */
    getController(id: string): AbortController | undefined;
    /**
     * Signals abort for a running session.
     * Returns false if the session is not found [EC-13].
     * Returns false if the session is already completed or failed [EC-14].
     */
    abort(id: string): boolean;
    /** Returns a snapshot array of all session records. */
    list(): SessionRecord[];
    /**
     * Removes sessions whose age exceeds sessionTtl.
     * Age is measured from startTime regardless of state.
     */
    prune(): void;
}
//# sourceMappingURL=session.d.ts.map