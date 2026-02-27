/**
 * SessionManager — tracks active script execution sessions.
 * Enforces concurrency limits and TTL-based pruning.
 */
import { randomUUID } from 'node:crypto';
import { AgentHostError } from './errors.js';
// ============================================================
// SESSION MANAGER
// ============================================================
/**
 * Manages session lifecycle: creation, retrieval, abort, listing, and pruning.
 * Internal to rill-host — not exported from index.ts.
 */
export class SessionManager {
    sessions = new Map();
    config;
    constructor(config) {
        this.config = config;
    }
    // ============================================================
    // ACTIVE COUNT
    // ============================================================
    /** Number of sessions with state === 'running'. */
    get activeCount() {
        let count = 0;
        for (const entry of this.sessions.values()) {
            if (entry.record.state === 'running')
                count++;
        }
        return count;
    }
    /**
     * Number of running sessions owned by the given agent.
     * Returns 0 for unknown agent names. Never throws [EC-10].
     */
    activeCountFor(agentName) {
        let count = 0;
        for (const entry of this.sessions.values()) {
            if (entry.record.state === 'running' &&
                entry.record.agentName === agentName) {
                count++;
            }
        }
        return count;
    }
    // ============================================================
    // CREATE
    // ============================================================
    /**
     * Creates and stores a new session.
     * Throws AgentHostError('capacity') if the global concurrency limit is
     * reached [EC-8] or the per-agent cap is exceeded [EC-9].
     */
    create(request, correlationId, agentName = '') {
        if (this.activeCount >= this.config.maxConcurrentSessions) {
            throw new AgentHostError('session limit reached', 'capacity');
        }
        const agentCap = this.config.agentCaps?.get(agentName);
        if (agentCap !== undefined && this.activeCountFor(agentName) >= agentCap) {
            throw new AgentHostError('session limit reached', 'capacity');
        }
        const id = randomUUID();
        const record = {
            id,
            agentName,
            state: 'running',
            startTime: Date.now(),
            durationMs: undefined,
            stepCount: 0,
            variables: {},
            trigger: request.trigger,
            correlationId,
        };
        const controller = new AbortController();
        this.sessions.set(id, { record, controller });
        return record;
    }
    // ============================================================
    // GET
    // ============================================================
    /** Returns the session record for the given ID, or undefined if not found. */
    get(id) {
        return this.sessions.get(id)?.record;
    }
    // ============================================================
    // GET CONTROLLER
    // ============================================================
    /**
     * Returns the AbortController for a session.
     * Used by host.ts to signal cancellation during execution.
     */
    getController(id) {
        return this.sessions.get(id)?.controller;
    }
    // ============================================================
    // ABORT
    // ============================================================
    /**
     * Signals abort for a running session.
     * Returns false if the session is not found [EC-13].
     * Returns false if the session is already completed or failed [EC-14].
     */
    abort(id) {
        const entry = this.sessions.get(id);
        if (entry === undefined)
            return false;
        const { record, controller } = entry;
        if (record.state === 'completed' || record.state === 'failed')
            return false;
        record.state = 'failed';
        record.durationMs = Date.now() - record.startTime;
        controller.abort();
        return true;
    }
    // ============================================================
    // LIST
    // ============================================================
    /** Returns a snapshot array of all session records. */
    list() {
        return Array.from(this.sessions.values(), (e) => e.record);
    }
    // ============================================================
    // PRUNE
    // ============================================================
    /**
     * Removes sessions whose age exceeds sessionTtl.
     * Age is measured from startTime regardless of state.
     */
    prune() {
        const cutoff = Date.now() - this.config.sessionTtl;
        for (const [id, entry] of this.sessions) {
            if (entry.record.startTime <= cutoff) {
                this.sessions.delete(id);
            }
        }
    }
}
//# sourceMappingURL=session.js.map