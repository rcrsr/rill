import Database from 'better-sqlite3';
import type {
  CheckpointData,
  CheckpointSummary,
  PersistedSessionState,
  StateBackend,
} from '@rcrsr/rill-host';

export interface SqliteBackendConfig {
  readonly filePath: string;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  agent_name: string;
  timestamp: number;
  step_index: number;
  total_steps: number;
  data: string;
}

interface CheckpointSummaryRow {
  id: string;
  session_id: string;
  agent_name: string;
  timestamp: number;
  step_index: number;
  total_steps: number;
}

interface SessionRow {
  session_id: string;
  agent_name: string;
  state: string;
  start_time: number;
  last_activity: number;
  metadata: string;
}

interface CheckpointDataJson {
  pipeValue: CheckpointData['pipeValue'];
  variables: CheckpointData['variables'];
  variableTypes: CheckpointData['variableTypes'];
  extensionState: CheckpointData['extensionState'];
}

export function createSqliteBackend(config: SqliteBackendConfig): StateBackend {
  let db: Database.Database | null = null;

  function getDb(): Database.Database {
    if (db === null) {
      throw new Error('SQLite backend is not connected. Call connect() first.');
    }
    return db;
  }

  return {
    connect(): Promise<void> {
      if (db !== null) {
        return Promise.resolve();
      }

      const instance = new Database(config.filePath);

      instance.pragma('journal_mode = WAL');

      const version = instance.pragma('user_version', {
        simple: true,
      }) as number;

      if (version === 0) {
        instance.exec(`
          CREATE TABLE IF NOT EXISTS checkpoints (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            step_index INTEGER NOT NULL,
            total_steps INTEGER NOT NULL,
            data TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_cp_session ON checkpoints(session_id);
          CREATE INDEX IF NOT EXISTS idx_cp_agent_ts ON checkpoints(agent_name, timestamp DESC);

          CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            agent_name TEXT NOT NULL,
            state TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            last_activity INTEGER NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}'
          );
          CREATE INDEX IF NOT EXISTS idx_sess_agent ON sessions(agent_name);
        `);

        instance.pragma('user_version = 1');
      }

      db = instance;
      return Promise.resolve();
    },

    close(): Promise<void> {
      if (db === null) {
        return Promise.resolve();
      }
      db.close();
      db = null;
      return Promise.resolve();
    },

    saveCheckpoint(checkpoint: CheckpointData): Promise<void> {
      const instance = getDb();

      const data: CheckpointDataJson = {
        pipeValue: checkpoint.pipeValue,
        variables: checkpoint.variables,
        variableTypes: checkpoint.variableTypes,
        extensionState: checkpoint.extensionState,
      };

      const insert = instance.prepare(`
        INSERT OR REPLACE INTO checkpoints
          (id, session_id, agent_name, timestamp, step_index, total_steps, data)
        VALUES
          (@id, @sessionId, @agentName, @timestamp, @stepIndex, @totalSteps, @data)
      `);

      const tx = instance.transaction(() => {
        insert.run({
          id: checkpoint.id,
          sessionId: checkpoint.sessionId,
          agentName: checkpoint.agentName,
          timestamp: checkpoint.timestamp,
          stepIndex: checkpoint.stepIndex,
          totalSteps: checkpoint.totalSteps,
          data: JSON.stringify(data),
        });
      });

      tx();
      return Promise.resolve();
    },

    loadCheckpoint(sessionId: string): Promise<CheckpointData | null> {
      const instance = getDb();

      const row = instance
        .prepare('SELECT * FROM checkpoints WHERE session_id = ?')
        .get(sessionId) as CheckpointRow | undefined;

      if (row === undefined) {
        return Promise.resolve(null);
      }

      const data = JSON.parse(row.data) as CheckpointDataJson;

      const checkpoint: CheckpointData = {
        id: row.id,
        sessionId: row.session_id,
        agentName: row.agent_name,
        timestamp: row.timestamp,
        stepIndex: row.step_index,
        totalSteps: row.total_steps,
        pipeValue: data.pipeValue,
        variables: data.variables,
        variableTypes: data.variableTypes,
        extensionState: data.extensionState,
      };

      return Promise.resolve(checkpoint);
    },

    listCheckpoints(
      agentName: string,
      options?: { limit?: number }
    ): Promise<CheckpointSummary[]> {
      const instance = getDb();

      let sql =
        'SELECT id, session_id, agent_name, timestamp, step_index, total_steps ' +
        'FROM checkpoints WHERE agent_name = ? ORDER BY timestamp DESC';

      if (options?.limit !== undefined) {
        sql += ` LIMIT ${options.limit}`;
      }

      const rows = instance
        .prepare(sql)
        .all(agentName) as CheckpointSummaryRow[];

      const summaries: CheckpointSummary[] = rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        agentName: row.agent_name,
        timestamp: row.timestamp,
        stepIndex: row.step_index,
        totalSteps: row.total_steps,
      }));

      return Promise.resolve(summaries);
    },

    deleteCheckpoint(id: string): Promise<void> {
      const instance = getDb();
      instance.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
      return Promise.resolve();
    },

    getSession(sessionId: string): Promise<PersistedSessionState | null> {
      const instance = getDb();

      const row = instance
        .prepare('SELECT * FROM sessions WHERE session_id = ?')
        .get(sessionId) as SessionRow | undefined;

      if (row === undefined) {
        return Promise.resolve(null);
      }

      const session: PersistedSessionState = {
        sessionId: row.session_id,
        agentName: row.agent_name,
        state: row.state as PersistedSessionState['state'],
        startTime: row.start_time,
        lastActivity: row.last_activity,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      };

      return Promise.resolve(session);
    },

    putSession(
      _sessionId: string,
      state: PersistedSessionState
    ): Promise<void> {
      const instance = getDb();

      const insert = instance.prepare(`
        INSERT OR REPLACE INTO sessions
          (session_id, agent_name, state, start_time, last_activity, metadata)
        VALUES
          (@sessionId, @agentName, @state, @startTime, @lastActivity, @metadata)
      `);

      const tx = instance.transaction(() => {
        insert.run({
          sessionId: state.sessionId,
          agentName: state.agentName,
          state: state.state,
          startTime: state.startTime,
          lastActivity: state.lastActivity,
          metadata: JSON.stringify(state.metadata),
        });
      });

      tx();
      return Promise.resolve();
    },
  };
}
