import { Redis } from 'ioredis';
import type {
  CheckpointData,
  CheckpointSummary,
  PersistedSessionState,
  StateBackend,
} from '@rcrsr/rill-host';

// ============================================================
// CONFIG
// ============================================================

export interface RedisBackendConfig {
  readonly url?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly password?: string | undefined;
  readonly keyPrefix?: string | undefined;
  readonly ttl?: number | undefined;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function checkpointKey(id: string): string {
  return `checkpoint:${id}`;
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function agentIndexKey(agentName: string): string {
  return `agent:${agentName}:checkpoints`;
}

function sessionCheckpointIndexKey(sessionId: string): string {
  return `session:${sessionId}:checkpoint-id`;
}

function throwFirstPipelineError(
  results: [error: Error | null, result: unknown][] | null
): void {
  if (results === null) return;
  for (const [err] of results) {
    if (err !== null) throw err;
  }
}

// ============================================================
// FACTORY
// ============================================================

function buildRedisClient(config: RedisBackendConfig): Redis {
  const redis =
    config.url !== undefined
      ? new Redis(config.url, {
          lazyConnect: true,
          ...(config.keyPrefix !== undefined && {
            keyPrefix: config.keyPrefix,
          }),
        })
      : new Redis({
          ...(config.host !== undefined && { host: config.host }),
          ...(config.port !== undefined && { port: config.port }),
          ...(config.password !== undefined && { password: config.password }),
          ...(config.keyPrefix !== undefined && {
            keyPrefix: config.keyPrefix,
          }),
          lazyConnect: true,
        });
  if (typeof redis.setMaxListeners === 'function') redis.setMaxListeners(20);
  return redis;
}

export function createRedisBackend(config: RedisBackendConfig): StateBackend {
  const redis = buildRedisClient(config);

  let connected = false;

  return {
    async connect(): Promise<void> {
      if (connected) return;
      await redis.connect();
      await redis.ping();
      connected = true;
    },

    async close(): Promise<void> {
      if (!connected) return;
      await redis.quit();
      connected = false;
    },

    async saveCheckpoint(checkpoint: CheckpointData): Promise<void> {
      const json = JSON.stringify(checkpoint);
      const key = checkpointKey(checkpoint.id);
      const indexKey = agentIndexKey(checkpoint.agentName);
      const sessionIndexKey = sessionCheckpointIndexKey(checkpoint.sessionId);

      const pipeline = redis.pipeline();

      if (config.ttl !== undefined) {
        pipeline.set(key, json, 'EX', config.ttl);
        pipeline.set(sessionIndexKey, checkpoint.id, 'EX', config.ttl);
      } else {
        pipeline.set(key, json);
        pipeline.set(sessionIndexKey, checkpoint.id);
      }

      pipeline.zadd(indexKey, checkpoint.timestamp, checkpoint.id);

      throwFirstPipelineError(await pipeline.exec());
    },

    async loadCheckpoint(sessionId: string): Promise<CheckpointData | null> {
      const sessionIndexKey = sessionCheckpointIndexKey(sessionId);
      const checkpointId = await redis.get(sessionIndexKey);

      if (checkpointId === null) return null;

      const raw = await redis.get(checkpointKey(checkpointId));

      if (raw === null) return null;

      return JSON.parse(raw) as CheckpointData;
    },

    async listCheckpoints(
      agentName: string,
      options?: { limit?: number }
    ): Promise<CheckpointSummary[]> {
      const indexKey = agentIndexKey(agentName);

      const stop = options?.limit !== undefined ? options.limit - 1 : -1;
      const ids = await redis.zrevrange(indexKey, 0, stop);

      if (ids.length === 0) return [];

      const pipeline = redis.pipeline();
      for (const id of ids) {
        pipeline.get(checkpointKey(id));
      }

      const results = await pipeline.exec();

      if (results === null) return [];

      const summaries: CheckpointSummary[] = [];

      for (let i = 0; i < results.length; i++) {
        const [err, raw] = results[i]!;

        if (err !== null) throw err;
        if (typeof raw !== 'string') continue;

        const data = JSON.parse(raw) as CheckpointData;

        summaries.push({
          id: data.id,
          sessionId: data.sessionId,
          agentName: data.agentName,
          timestamp: data.timestamp,
          stepIndex: data.stepIndex,
          totalSteps: data.totalSteps,
        });
      }

      return summaries;
    },

    async deleteCheckpoint(id: string): Promise<void> {
      const key = checkpointKey(id);
      const raw = await redis.get(key);

      if (raw === null) return;

      const data = JSON.parse(raw) as CheckpointData;

      const pipeline = redis.pipeline();
      pipeline.del(key);
      pipeline.zrem(agentIndexKey(data.agentName), id);
      pipeline.del(sessionCheckpointIndexKey(data.sessionId));

      throwFirstPipelineError(await pipeline.exec());
    },

    async getSession(sessionId: string): Promise<PersistedSessionState | null> {
      const raw = await redis.get(sessionKey(sessionId));

      if (raw === null) return null;

      return JSON.parse(raw) as PersistedSessionState;
    },

    async putSession(
      sessionId: string,
      state: PersistedSessionState
    ): Promise<void> {
      const key = sessionKey(sessionId);
      const json = JSON.stringify(state);

      if (config.ttl !== undefined) {
        await redis.set(key, json, 'EX', config.ttl);
      } else {
        await redis.set(key, json);
      }
    },
  };
}
