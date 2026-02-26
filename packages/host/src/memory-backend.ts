import type {
  CheckpointData,
  CheckpointSummary,
  PersistedSessionState,
  StateBackend,
} from './types.js';

/**
 * In-memory StateBackend implementation.
 *
 * Data is stored in Map instances and does not survive process restart.
 * connect() and close() are no-ops. All other operations are synchronous
 * under the hood but wrapped in Promise.resolve() to satisfy the interface.
 */
export function createMemoryBackend(): StateBackend {
  const checkpoints = new Map<string, CheckpointData>();
  const sessions = new Map<string, PersistedSessionState>();

  return {
    connect(): Promise<void> {
      return Promise.resolve();
    },

    close(): Promise<void> {
      return Promise.resolve();
    },

    saveCheckpoint(checkpoint: CheckpointData): Promise<void> {
      checkpoints.set(checkpoint.id, checkpoint);
      return Promise.resolve();
    },

    loadCheckpoint(sessionId: string): Promise<CheckpointData | null> {
      for (const checkpoint of checkpoints.values()) {
        if (checkpoint.sessionId === sessionId) {
          return Promise.resolve(checkpoint);
        }
      }
      return Promise.resolve(null);
    },

    listCheckpoints(
      agentName: string,
      options?: { limit?: number }
    ): Promise<CheckpointSummary[]> {
      const results: CheckpointSummary[] = [];

      for (const checkpoint of checkpoints.values()) {
        if (checkpoint.agentName === agentName) {
          results.push({
            id: checkpoint.id,
            sessionId: checkpoint.sessionId,
            agentName: checkpoint.agentName,
            timestamp: checkpoint.timestamp,
            stepIndex: checkpoint.stepIndex,
            totalSteps: checkpoint.totalSteps,
          });
        }
      }

      results.sort((a, b) => b.timestamp - a.timestamp);

      if (options?.limit !== undefined) {
        return Promise.resolve(results.slice(0, options.limit));
      }

      return Promise.resolve(results);
    },

    deleteCheckpoint(id: string): Promise<void> {
      checkpoints.delete(id);
      return Promise.resolve();
    },

    getSession(sessionId: string): Promise<PersistedSessionState | null> {
      return Promise.resolve(sessions.get(sessionId) ?? null);
    },

    putSession(sessionId: string, state: PersistedSessionState): Promise<void> {
      sessions.set(sessionId, state);
      return Promise.resolve();
    },
  };
}
