/**
 * SessionManager — tracks active script execution sessions.
 * Enforces concurrency limits and TTL-based pruning.
 */

import { randomUUID } from 'node:crypto';
import { AgentHostError } from './errors.js';
import type { RunRequest, SessionRecord } from './types.js';

// ============================================================
// INTERNAL STATE
// ============================================================

interface SessionEntry {
  record: SessionRecord;
  controller: AbortController;
}

// ============================================================
// SESSION MANAGER CONFIG
// ============================================================

export interface SessionManagerConfig {
  readonly maxConcurrentSessions: number;
  readonly sessionTtl: number;
}

// ============================================================
// SESSION MANAGER
// ============================================================

/**
 * Manages session lifecycle: creation, retrieval, abort, listing, and pruning.
 * Internal to rill-host — not exported from index.ts.
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly config: SessionManagerConfig;

  constructor(config: SessionManagerConfig) {
    this.config = config;
  }

  // ============================================================
  // ACTIVE COUNT
  // ============================================================

  /** Number of sessions with state === 'running'. */
  get activeCount(): number {
    let count = 0;
    for (const entry of this.sessions.values()) {
      if (entry.record.state === 'running') count++;
    }
    return count;
  }

  // ============================================================
  // CREATE
  // ============================================================

  /**
   * Creates and stores a new session.
   * Throws AgentHostError('capacity') if the concurrency limit is reached.
   */
  create(request: RunRequest, correlationId: string): SessionRecord {
    if (this.activeCount >= this.config.maxConcurrentSessions) {
      throw new AgentHostError('session limit reached', 'capacity');
    }

    const id = randomUUID();
    const record: SessionRecord = {
      id,
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
  get(id: string): SessionRecord | undefined {
    return this.sessions.get(id)?.record;
  }

  // ============================================================
  // GET CONTROLLER
  // ============================================================

  /**
   * Returns the AbortController for a session.
   * Used by host.ts to signal cancellation during execution.
   */
  getController(id: string): AbortController | undefined {
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
  abort(id: string): boolean {
    const entry = this.sessions.get(id);
    if (entry === undefined) return false;

    const { record, controller } = entry;
    if (record.state === 'completed' || record.state === 'failed') return false;

    record.state = 'failed';
    record.durationMs = Date.now() - record.startTime;
    controller.abort();
    return true;
  }

  // ============================================================
  // LIST
  // ============================================================

  /** Returns a snapshot array of all session records. */
  list(): SessionRecord[] {
    return Array.from(this.sessions.values(), (e) => e.record);
  }

  // ============================================================
  // PRUNE
  // ============================================================

  /**
   * Removes sessions whose age exceeds sessionTtl.
   * Age is measured from startTime regardless of state.
   */
  prune(): void {
    const cutoff = Date.now() - this.config.sessionTtl;
    for (const [id, entry] of this.sessions) {
      if (entry.record.startTime <= cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}
