import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CheckpointData,
  CheckpointSummary,
  PersistedSessionState,
  StateBackend,
} from '@rcrsr/rill-host';

// ============================================================
// CONFIG
// ============================================================

export interface FileBackendConfig {
  readonly dir: string;
}

// ============================================================
// FACTORY
// ============================================================

export function createFileBackend(config: FileBackendConfig): StateBackend {
  const { dir } = config;
  const checkpointsDir = path.join(dir, 'checkpoints');
  const sessionsDir = path.join(dir, 'sessions');
  let connected = false;

  function checkpointPath(id: string): string {
    return path.join(checkpointsDir, `${id}.json`);
  }

  function sessionPath(sessionId: string): string {
    return path.join(sessionsDir, `${sessionId}.json`);
  }

  function writeAtomic(finalPath: string, data: string): void {
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, finalPath);
  }

  return {
    async connect(): Promise<void> {
      if (connected) return;
      fs.mkdirSync(checkpointsDir, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      connected = true;
    },

    async close(): Promise<void> {
      connected = false;
    },

    async saveCheckpoint(checkpoint: CheckpointData): Promise<void> {
      const filePath = checkpointPath(checkpoint.id);
      writeAtomic(filePath, JSON.stringify(checkpoint));
    },

    async loadCheckpoint(sessionId: string): Promise<CheckpointData | null> {
      const files = fs.readdirSync(checkpointsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const raw = fs.readFileSync(path.join(checkpointsDir, file), 'utf-8');
        const data = JSON.parse(raw) as CheckpointData;
        if (data.sessionId === sessionId) {
          return data;
        }
      }
      return null;
    },

    async listCheckpoints(
      agentName: string,
      options?: { limit?: number }
    ): Promise<CheckpointSummary[]> {
      const files = fs.readdirSync(checkpointsDir);
      const results: CheckpointSummary[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const raw = fs.readFileSync(path.join(checkpointsDir, file), 'utf-8');
        const data = JSON.parse(raw) as CheckpointData;
        if (data.agentName === agentName) {
          results.push({
            id: data.id,
            sessionId: data.sessionId,
            agentName: data.agentName,
            timestamp: data.timestamp,
            stepIndex: data.stepIndex,
            totalSteps: data.totalSteps,
          });
        }
      }

      results.sort((a, b) => b.timestamp - a.timestamp);

      if (options?.limit !== undefined) {
        return results.slice(0, options.limit);
      }

      return results;
    },

    async deleteCheckpoint(id: string): Promise<void> {
      try {
        fs.unlinkSync(checkpointPath(id));
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') throw err;
      }
    },

    async getSession(sessionId: string): Promise<PersistedSessionState | null> {
      const filePath = sessionPath(sessionId);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as PersistedSessionState;
    },

    async putSession(
      sessionId: string,
      state: PersistedSessionState
    ): Promise<void> {
      writeAtomic(sessionPath(sessionId), JSON.stringify(state));
    },
  };
}
