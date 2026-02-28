# rill Agent Harness

*Production HTTP server harness for rill agents*

## Overview

`@rcrsr/rill-agent-harness` provides a lifecycle-managed HTTP server for running rill agents as persistent services. It handles session management, SSE streaming, Prometheus metrics, and graceful shutdown. For embedding rill directly in application code without the HTTP layer, see [Host Integration](integration-host.md).

## Installation

```bash
npm install @rcrsr/rill-agent-harness
```

## Quick Start

```typescript
import { readFileSync } from 'node:fs';
import { validateManifest } from '@rcrsr/rill-agent-shared';
import { composeAgent, createAgentHost } from '@rcrsr/rill-agent-harness';

const json = JSON.parse(readFileSync('./agent.json', 'utf-8'));
const manifest = validateManifest(json);
const agent = await composeAgent(manifest, { basePath: import.meta.dirname });
const host = createAgentHost(agent);

await host.listen(3000);
```

## Multi-Agent Mode

`createAgentHost` accepts a `Map<string, ComposedAgent>` to run multiple agents in a single process.

```typescript
import { validateManifest } from '@rcrsr/rill-agent-shared';
import { composeAgent, createAgentHost } from '@rcrsr/rill-agent-harness';

const agentA = await composeAgent(validateManifest(manifestA), { basePath: import.meta.dirname });
const agentB = await composeAgent(validateManifest(manifestB), { basePath: import.meta.dirname });

const agents = new Map([
  ['agent-a', agentA],
  ['agent-b', agentB],
]);

const host = createAgentHost(agents, { maxConcurrentSessions: 20 });
await host.listen(3000);
```

`createAgentHost` uses `instanceof Map` to detect the multi-agent overload. Single-agent mode wraps the single `ComposedAgent` in a `Map` keyed by `agent.card.name` and delegates to the same multi-agent path internally.

```typescript
// Single-agent overload
export function createAgentHost(agent: ComposedAgent, options?: AgentHostOptions): AgentHost;

// Multi-agent overload
export function createAgentHost(agents: Map<string, ComposedAgent>, options?: AgentHostOptions): AgentHost;
```

In multi-agent mode, each agent's routes mount under `/:agentName/`. Process-level endpoints (`/healthz`, `/readyz`, `/metrics`, `/stop`) remain flat with no prefix.

`GET /readyz` returns HTTP 503 until all agents have finished composing. After all agents are ready, it returns HTTP 200.

## Lifecycle

The host transitions through phases in order.

| Phase | Description |
|-------|-------------|
| `READY` | Host created. Accepts requests. No sessions running yet. |
| `RUNNING` | First session started. Transitions automatically on first `run()`. |
| `STOPPED` | `stop()` called. Drains active sessions, then closes. |

## HTTP Endpoints

### Single-Agent Routes

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `POST` | `/run` | Start a script session | 200 `RunResponse` | 400, 429, 503 |
| `POST` | `/sessions/{id}/abort` | Abort a running session | 200 | 404 |
| `GET` | `/sessions` | All session records | 200 `SessionRecord[]` | — |
| `GET` | `/sessions/{id}` | Single session record | 200 `SessionRecord` | 404 |
| `GET` | `/sessions/{id}/stream` | SSE event stream | 200 text/event-stream | 404 |
| `GET` | `/.well-known/agent-card.json` | Agent capability card | 200 `AgentCard` | — |

### Multi-Agent Routes

Multi-agent mode mounts each agent's routes under a `/:agentName/` prefix.

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `POST` | `/:agentName/run` | Start a session for a named agent | 200 `RunResponse` | 400, 404, 429 |
| `POST` | `/:agentName/sessions/:id/abort` | Abort a session for a named agent | 200 | 404 |
| `GET` | `/:agentName/sessions` | All sessions for a named agent | 200 `SessionRecord[]` | 404 |
| `GET` | `/:agentName/sessions/:id` | Single session for a named agent | 200 `SessionRecord` | 404 |
| `GET` | `/:agentName/sessions/:id/stream` | SSE stream for a named agent | 200 text/event-stream | 404 |
| `GET` | `/.well-known/:agentName/agent-card.json` | Named agent capability card | 200 `AgentCard` | 404 |

Unknown `:agentName` values return HTTP 404 with body `{"error":"not_found"}`. The response does not leak registered agent names.

### Process-Level Endpoints

These endpoints are always flat (no agent prefix) in both single-agent and multi-agent modes.

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `GET` | `/healthz` | Health snapshot | 200 `HealthStatus` | — |
| `GET` | `/readyz` | Readiness probe | 200 or 503 | — |
| `GET` | `/metrics` | Prometheus metrics text | 200 text/plain | — |
| `POST` | `/stop` | Initiate graceful shutdown | 202 | 503 |

`GET /readyz` returns HTTP 200 when the host is ready to accept requests. In multi-agent mode, it returns HTTP 503 with body `{"status":"not_ready"}` until all agents have finished composing. In single-agent mode, it returns HTTP 200 as before.

### Discovery Endpoint

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `GET` | `/.well-known/agent-card.json` | Agent capability card (single-agent) | 200 `AgentCard` | — |

`GET /.well-known/agent-card.json` returns an A2A-compliant `AgentCard` JSON object describing the agent's identity and capabilities. In multi-agent mode, use `GET /.well-known/:agentName/agent-card.json` instead.

```typescript
interface AgentCapabilities {
  readonly streaming: boolean;
  readonly pushNotifications: boolean;
}

interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly inputModes?: readonly string[] | undefined;
  readonly outputModes?: readonly string[] | undefined;
}

interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly url: string;
  readonly capabilities: AgentCapabilities;
  readonly skills: readonly AgentSkill[];
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Agent display name |
| `description` | `string` | Agent purpose |
| `version` | `string` | Agent version string |
| `url` | `string` | Base URL of the running agent |
| `capabilities` | `AgentCapabilities` | Flags for `streaming` and `pushNotifications` support |
| `skills` | `AgentSkill[]` | List of named capabilities the agent exposes |
| `defaultInputModes` | `string[]` | MIME types accepted by default (e.g. `"application/json"`) |
| `defaultOutputModes` | `string[]` | MIME types returned by default (e.g. `"application/json"`) |

Example response:

```json
{
  "name": "my-agent",
  "description": "...",
  "version": "1.0.0",
  "url": "http://localhost:3000",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "skills": [],
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"]
}
```

### Error Contracts

#### Single-Agent

| Endpoint | Error Condition | HTTP Status | Response Shape |
|----------|----------------|-------------|----------------|
| `POST /run` | Host not READY or RUNNING | 503 | `{"error": string}` |
| `POST /run` | `maxConcurrentSessions` reached | 429 | `{"error": string}` |
| `POST /run` | Invalid request body | 400 | `{"error": string}` |
| `POST /sessions/{id}/abort` | Session not found | 404 | `{"error": string}` |
| `GET /sessions/{id}` | TTL elapsed | 404 | `{"error": string}` |
| `GET /sessions/{id}/stream` | Session not found | 404 | `{"error": string}` |

#### Multi-Agent

| Endpoint | Error Condition | HTTP Status | Response Body |
|----------|----------------|-------------|---------------|
| `POST /:agentName/run` | Unknown agent name | 404 | `{"error": "not_found"}` |
| `POST /:agentName/run` | Per-agent capacity exceeded | 429 | `{"error": "capacity_exceeded", "agent": string}` |
| `POST /:agentName/run` | Global capacity exceeded | 429 | `{"error": "capacity_exceeded"}` |
| `POST /:agentName/run` | Invalid request body | 400 | `{"error": "validation_error", "detail": string}` |
| `GET /:agentName/sessions/:id` | Session not found | 404 | `{"error": "not_found"}` |
| `POST /:agentName/sessions/:id/abort` | Session not found | 404 | `{"error": "not_found"}` |
| `GET /readyz` | Not all agents composed | 503 | `{"status": "not_ready"}` |

Unknown `:agentName` responses use `{"error":"not_found"}` regardless of whether the name is close to a registered agent. This prevents leaking registered agent names through error messages.

### POST /run Param Validation

The host validates `params` against the manifest `input` schema before creating a session.

| Condition | HTTP Status | Behavior |
|-----------|-------------|----------|
| Missing required param | 400 | Returns error body with `fields` listing the param |
| Type mismatch | 400 | Returns error body with `fields` listing the param |
| Missing optional param with default | 200 | Default value injected before execution |
| Extra undeclared param | 200 | Param passes through to the script unchanged |
| No `input` declared in manifest | 200 | No validation performed |

Validation error response body:

```json
{
  "error": "invalid params",
  "fields": [
    { "param": "feedback", "message": "required" },
    { "param": "score", "message": "expected number, got string" }
  ]
}
```

Behavioral constraints: validation runs before session creation; `fields` lists params in manifest declaration order; defaults inject before execution; extra params pass through.

## Invocation Model

```typescript
interface RunRequest {
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly trigger?: 'http' | 'queue' | 'cron' | 'agent' | 'api' | 'manual' | {
    type: 'agent';
    agentName: string;
    sessionId: string;
  };
  readonly callback?: string | undefined;
}

interface RunResponse {
  readonly sessionId: string;
  readonly correlationId: string;
  readonly state: 'running' | 'completed' | 'failed';
  readonly result?: RillValue | undefined;
  readonly durationMs?: number | undefined;
}
```

`POST /run` returns `state: "running"` when execution exceeds `responseTimeout`. The session continues in the background. Use `GET /sessions/{id}/stream` to receive completion events.

### RunRequest Trigger Field

The `trigger` field accepts a string or an object:

```typescript
// String form (all trigger types)
type TriggerString = 'http' | 'queue' | 'cron' | 'agent' | 'api' | 'manual';

// Object form (agent-to-agent invocation only)
type TriggerObject = {
  type: 'agent';
  agentName: string;
  sessionId: string;
};

type Trigger = TriggerString | TriggerObject;
```

The string `'agent'` remains valid for backward compatibility. Use the object form when the calling agent's name and session ID must propagate for tracing:

```typescript
const response = await fetch('http://agent-b:3000/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    trigger: {
      type: 'agent',
      agentName: 'agent-a',
      sessionId: currentSessionId,
    },
    input: { query: 'summarize this' },
  }),
});
```

The receiving agent's host functions can read `ctx.metadata.correlationId` to link the two sessions in traces.

## Session Management

| State | Description |
|-------|-------------|
| `running` | Execution in progress |
| `completed` | Script finished successfully |
| `failed` | Script threw an error or was aborted |

`maxConcurrentSessions` caps the number of sessions in `running` state. Requests that exceed the cap return 429. `sessionTtl` controls how long completed or failed session records remain queryable. After the TTL elapses, `GET /sessions/{id}` returns 404.

### SessionRecord

Every session record carries an `agentName` field identifying which agent owns the session.

```typescript
interface SessionRecord {
  readonly sessionId: string;
  readonly agentName: string;  // agent card.name; equals host agent name in single-agent mode
  readonly state: 'running' | 'completed' | 'failed';
  readonly trigger: string;
  readonly correlationId: string;
  readonly startedAt: number;
  readonly durationMs?: number | undefined;
  readonly result?: RillValue | undefined;
  readonly error?: string | undefined;
}
```

### Per-Agent Concurrency Caps

`SessionManager.create()` enforces two capacity checks in order:

1. **Global cap** — checks `maxConcurrentSessions` across all agents. Exceeded → `AgentHostError` code `'capacity'` → HTTP 429 with `{"error":"capacity_exceeded"}`.
2. **Per-agent cap** — checks the cap for the specific agent. Exceeded → `AgentHostError` code `'capacity'` → HTTP 429 with `{"error":"capacity_exceeded","agent":string}`.

Configure per-agent caps via `agents[].maxConcurrency` in the multi-agent options. When absent, the default is `Math.floor(host.maxConcurrency / agents.size)`. In single-agent mode, `agentName` equals the agent's `card.name` and only the global cap applies.

## SSE Streaming

Connect to `GET /sessions/{id}/stream` to receive real-time execution events. Late-connecting clients receive all buffered events immediately.

| Event | Payload Fields | Description |
|-------|---------------|-------------|
| `step` | `sessionId`, `index`, `total`, `value`, `durationMs` | One script statement completed |
| `capture` | `sessionId`, `name`, `value` | Variable captured with `=>` |
| `error` | `sessionId`, `error` | Execution error occurred |
| `done` | `sessionId`, `state`, `result?`, `error?`, `durationMs` | Session terminal state reached |

## Programmatic API

```typescript
interface AgentHost {
  readonly phase: LifecyclePhase;
  run(input: RunRequest): Promise<RunResponse>;
  stop(): Promise<void>;
  health(): HealthStatus;
  metrics(): Promise<string>;
  sessions(): SessionRecord[];
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
}
```

Call `run()` or `listen()` after creating the host. Call `close()` to stop the HTTP server without draining sessions.

## Configuration

Pass options as the second argument to `createAgentHost(agent, options)` or `createAgentHost(agents, options)`.

### AgentHostOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | HTTP listen port |
| `healthPath` | `string` | `'/healthz'` | Path for the health endpoint |
| `readyPath` | `string` | `'/readyz'` | Path for the readiness probe |
| `metricsPath` | `string` | `'/metrics'` | Path for the Prometheus metrics endpoint |
| `drainTimeout` | `number` | `30000` ms | Max time to wait for sessions during shutdown |
| `sessionTtl` | `number` | `3600000` ms | Retention time for completed session records |
| `maxConcurrentSessions` | `number` | `10` | Maximum simultaneous running sessions (global cap) |
| `responseTimeout` | `number` | `30000` ms | Time before `POST /run` returns `state: "running"` |

### Per-Agent Concurrency (Multi-Agent)

Set `maxConcurrency` per agent entry when creating a multi-agent host:

```typescript
const host = createAgentHost(agents, {
  maxConcurrentSessions: 20,
  agents: {
    'agent-a': { maxConcurrency: 12 },
    'agent-b': { maxConcurrency: 8 },
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agents[name].maxConcurrency` | `number` | `Math.floor(maxConcurrentSessions / agents.size)` | Per-agent running session cap |

When `agents[name].maxConcurrency` is absent, the cap is distributed evenly across all agents. The global cap from `maxConcurrentSessions` still applies after the per-agent check passes.

## Observability

Each `AgentHost` instance uses its own `prom-client` `Registry` instance. Two `AgentHost` instances running in the same process do not share a registry, so metric registration does not collide. Scrape `GET /metrics` for the text/plain exposition format.

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `rill_sessions_total` | Counter | `state`, `trigger`, `agent` | Total sessions created |
| `rill_sessions_active` | Gauge | `agent` | Sessions currently running |
| `rill_execution_duration_seconds` | Histogram | `agent` | Script execution duration |
| `rill_host_calls_total` | Counter | `function` | Host function invocations |
| `rill_host_call_errors_total` | Counter | `function` | Failed host function calls |
| `rill_steps_total` | Counter | — | Total steps executed across all sessions |

The `agent` label value equals `card.name` for that agent. In single-agent mode, it equals the single agent's `card.name`. Existing Prometheus queries that omit the `agent` label continue to aggregate correctly across all agents.

## Signal Handling

Signal handlers register automatically when `listen()` is called.

| Signal | Behavior | Exit Code |
|--------|----------|-----------|
| `SIGTERM` | Stop accepting sessions, drain up to `drainTimeout` ms, then exit | 0 (clean) or 1 (timeout) |
| `SIGINT` | Abort all sessions immediately, exit without draining | 1 |

## Correlation IDs

Every request propagates the `X-Correlation-ID` header value into the session record when present. When the header is absent, the host generates a UUID and returns it in the response `X-Correlation-ID` header.

## See Also

| Document | Description |
|----------|-------------|
| [Host Integration](integration-host.md) | Embedding rill directly in applications without an HTTP layer |
| [Host API Reference](ref-host-api.md) | Complete TypeScript API exports for `@rcrsr/rill` |
| [Developing Extensions](integration-extensions.md) | Writing reusable host function packages |
| [Bundle](agent-bundle.md) | Manifest format, validateManifest, and composeAgent API |
| [Creating Rill Apps](guide-make.md) | Bootstrap new rill projects with `rill-agent-bundle init` |
