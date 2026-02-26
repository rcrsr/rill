# rill State Backends

*Persistent storage backends for checkpoints and session state*

## Overview

`@rcrsr/rill-host` supports pluggable `StateBackend` implementations for persisting checkpoint and session state. The default backend is in-memory with no persistence. Configure a backend via `createAgentHost(agent, { stateBackend })`.

## Installation

In-memory is included in `@rcrsr/rill-host`. Install external backends separately:

```bash
# File backend
npm install @rcrsr/rill-state-fs

# SQLite backend
npm install @rcrsr/rill-state-sqlite

# Redis backend
npm install @rcrsr/rill-state-redis
```

## Backend Selection Guide

| Backend | Package | Use When |
|---------|---------|----------|
| In-memory | `@rcrsr/rill-host` | Development, testing, single-process with no restart requirement |
| File | `@rcrsr/rill-state-fs` | Single-instance deployments needing persistence across restarts |
| SQLite | `@rcrsr/rill-state-sqlite` | Single-instance with high-volume reads and concurrent access |
| Redis | `@rcrsr/rill-state-redis` | Multi-instance deployments sharing state across pods |

## Configuration

### In-Memory Backend

```typescript
import { createAgentHost, createMemoryBackend } from '@rcrsr/rill-host';

const host = createAgentHost(agent, {
  stateBackend: createMemoryBackend(),
});
```

`createMemoryBackend()` is the default. Omitting `stateBackend` uses it automatically. Data does not survive process restart.

### File Backend

```typescript
import { createAgentHost } from '@rcrsr/rill-host';
import { createFileBackend } from '@rcrsr/rill-state-fs';

const host = createAgentHost(agent, {
  stateBackend: createFileBackend({ dir: './agent-state' }),
});
```

| Option | Type | Description |
|--------|------|-------------|
| `dir` | `string` | Directory for state files. Created automatically on `connect()`. |

Writes use atomic rename (`write → .tmp → rename`) to prevent partial state on crash.

### SQLite Backend

```typescript
import { createAgentHost } from '@rcrsr/rill-host';
import { createSqliteBackend } from '@rcrsr/rill-state-sqlite';

const host = createAgentHost(agent, {
  stateBackend: createSqliteBackend({ filePath: './agent-state.db' }),
});
```

| Option | Type | Description |
|--------|------|-------------|
| `filePath` | `string` | Path to the SQLite database file. Created automatically on `connect()`. |

WAL (Write-Ahead Logging) mode enables concurrent reads. Schema migrates automatically via the `user_version` pragma on first `connect()`.

### Redis Backend

```typescript
import { createAgentHost } from '@rcrsr/rill-host';
import { createRedisBackend } from '@rcrsr/rill-state-redis';

const host = createAgentHost(agent, {
  stateBackend: createRedisBackend({
    url: 'redis://localhost:6379',
    keyPrefix: 'myagent:',
    ttl: 86400, // 24 hours in seconds
  }),
});
```

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | Redis connection URL. Mutually exclusive with `host`/`port`. |
| `host` | `string` | Redis hostname. |
| `port` | `number` | Redis port. |
| `password` | `string` | Redis AUTH password. |
| `keyPrefix` | `string` | Prefix prepended to all Redis keys. |
| `ttl` | `number` | Key TTL in seconds. Keys absent after expiry return `null` on load. |

Auto-reconnect is enabled via ioredis defaults. `url` and `host`/`port` are mutually exclusive.

## StateBackend Interface

```typescript
interface StateBackend {
  connect(): Promise<void>;
  close(): Promise<void>;

  saveCheckpoint(checkpoint: CheckpointData): Promise<void>;
  loadCheckpoint(sessionId: string): Promise<CheckpointData | null>;
  listCheckpoints(
    agentName: string,
    options?: { limit?: number }
  ): Promise<CheckpointSummary[]>;
  deleteCheckpoint(id: string): Promise<void>;

  getSession(sessionId: string): Promise<PersistedSessionState | null>;
  putSession(sessionId: string, state: PersistedSessionState): Promise<void>;
}
```

| Method | Description |
|--------|-------------|
| `connect()` | Initialize the backend. Called automatically by the host before accepting requests. |
| `close()` | Release resources. Called automatically by the host during `stop()`. |
| `saveCheckpoint(checkpoint)` | Persist a checkpoint. Overwrites an existing checkpoint with the same `id`. |
| `loadCheckpoint(sessionId)` | Load the most recent checkpoint for `sessionId`. Returns `null` if not found. |
| `listCheckpoints(agentName, options?)` | List checkpoint summaries ordered by `timestamp` descending. |
| `deleteCheckpoint(id)` | Remove a checkpoint. No-op if the `id` does not exist. |
| `getSession(sessionId)` | Load persisted session state. Returns `null` if not found. |
| `putSession(sessionId, state)` | Persist session state. Overwrites an existing entry with the same `sessionId`. |

## Data Model

### CheckpointData

```typescript
interface CheckpointData {
  readonly id: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly timestamp: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly pipeValue: RillValue;
  readonly variables: Record<string, RillValue>;
  readonly variableTypes: Record<string, RillTypeName>;
  readonly extensionState: Record<string, unknown>;
}
```

### CheckpointSummary

```typescript
interface CheckpointSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly timestamp: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
}
```

### PersistedSessionState

```typescript
interface PersistedSessionState {
  readonly sessionId: string;
  readonly agentName: string;
  readonly state: SessionState;
  readonly startTime: number;
  readonly lastActivity: number;
  readonly metadata: Record<string, unknown>;
}
```

## Error Contracts

| Method | Condition | Result |
|--------|-----------|--------|
| `connect()` | Connection failure | Native error propagates (`ENOENT`, `ECONNREFUSED`) |
| `saveCheckpoint()` | Write failure | Native error propagates |
| `loadCheckpoint()` | Not found | Returns `null` |
| `loadCheckpoint()` | Read failure | Native error propagates |
| `listCheckpoints()` | No results | Returns `[]` |
| `deleteCheckpoint()` | Not found | No-op, resolves |
| `deleteCheckpoint()` | Write failure | Native error propagates |
| `getSession()` | Not found | Returns `null` |
| `putSession()` | Write failure | Native error propagates |
| `close()` | Already closed | No-op, resolves |

The host maps backend errors to HTTP 500 on `GET /sessions` and `GET /sessions/{id}`. See [Agent Host](integration-agent-host.md) for HTTP error contracts.

## Performance Targets

| Backend | p99 target | Alert threshold |
|---------|-----------|-----------------|
| In-memory | < 1 ms | > 5 ms |
| SQLite | < 5 ms | > 20 ms |
| Redis | < 10 ms | > 50 ms |

## See Also

| Document | Description |
|----------|-------------|
| [Agent Host](integration-agent-host.md) | Production HTTP server with lifecycle and sessions |
| [Developing Extensions](integration-extensions.md) | Writing extensions with checkpoint lifecycle support |
| [Compose](integration-compose.md) | Manifest-based wiring of state backends |

