# rill Agent Host

*Production HTTP server harness for rill agents*

## Overview

`@rcrsr/rill-host` provides a lifecycle-managed HTTP server for running rill agents as persistent services. It handles session management, SSE streaming, Prometheus metrics, and graceful shutdown. For embedding rill directly in application code without the HTTP layer, see [Host Integration](integration-host.md).

## Installation

```bash
npm install @rcrsr/rill-host
```

## Quick Start

```typescript
import { readFileSync } from 'node:fs';
import { validateManifest, composeAgent } from '@rcrsr/rill-compose';
import { createAgentHost } from '@rcrsr/rill-host';

const json = JSON.parse(readFileSync('./agent.json', 'utf-8'));
const manifest = validateManifest(json);
const agent = await composeAgent(manifest, { basePath: import.meta.dirname });
const host = createAgentHost(agent);

await host.listen(3000);
```

## Lifecycle

The host transitions through phases in order.

| Phase | Description |
|-------|-------------|
| `READY` | Host created. Accepts requests. No sessions running yet. |
| `RUNNING` | First session started. Transitions automatically on first `run()`. |
| `STOPPED` | `stop()` called. Drains active sessions, then closes. |

## HTTP Endpoints

### Lifecycle Endpoints

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `POST` | `/run` | Start a script session | 200 `RunResponse` | 400, 429, 503 |
| `POST` | `/stop` | Initiate graceful shutdown | 202 | 503 |
| `POST` | `/sessions/{id}/abort` | Abort a running session | 200 | 404, 409 |

### Observability Endpoints

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| `GET` | `/healthz` | Health snapshot | 200 `HealthStatus` |
| `GET` | `/readyz` | Readiness probe | 200 `{"ready":true}` |
| `GET` | `/metrics` | Prometheus metrics text | 200 text/plain |
| `GET` | `/sessions` | All session records | 200 `SessionRecord[]` |
| `GET` | `/sessions/{id}` | Single session record | 200 `SessionRecord` |
| `GET` | `/sessions/{id}/stream` | SSE event stream | 200 text/event-stream |

### Discovery Endpoint

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| `GET` | `/.well-known/agent-card.json` | Agent capability card | 200 `AgentCard` |

`GET /.well-known/agent-card.json` returns an A2A-compliant `AgentCard` JSON object describing the agent's identity and capabilities.

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

```typescript
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

| Endpoint | Error Condition | HTTP Status | Response Shape |
|----------|----------------|-------------|----------------|
| `POST /run` | Host not READY or RUNNING | 503 | `{"error": string}` |
| `POST /run` | `maxConcurrentSessions` reached | 429 | `{"error": string}` |
| `POST /run` | Invalid request body | 400 | `{"error": string}` |
| `POST /sessions/{id}/abort` | Session not found | 404 | `{"error": string}` |
| `GET /sessions/{id}` | TTL elapsed | 404 | `{"error": string}` |
| `GET /sessions/{id}/stream` | Session not found | 404 | `{"error": string}` |

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

Pass options as the second argument to `createAgentHost(agent, options)`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | HTTP listen port |
| `healthPath` | `string` | `'/healthz'` | Path for the health endpoint |
| `readyPath` | `string` | `'/readyz'` | Path for the readiness probe |
| `metricsPath` | `string` | `'/metrics'` | Path for the Prometheus metrics endpoint |
| `drainTimeout` | `number` | `30000` ms | Max time to wait for sessions during shutdown |
| `sessionTtl` | `number` | `3600000` ms | Retention time for completed session records |
| `maxConcurrentSessions` | `number` | `10` | Maximum simultaneous running sessions |
| `responseTimeout` | `number` | `30000` ms | Time before `POST /run` returns `state: "running"` |

## Observability

All metrics use a dedicated Prometheus registry. Scrape `GET /metrics` for the text/plain exposition format.

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `rill_sessions_total` | Counter | `state`, `trigger` | Total sessions created |
| `rill_sessions_active` | Gauge | — | Sessions currently running |
| `rill_execution_duration_seconds` | Histogram | — | Script execution duration |
| `rill_host_calls_total` | Counter | `function` | Host function invocations |
| `rill_host_call_errors_total` | Counter | `function` | Failed host function calls |
| `rill_steps_total` | Counter | — | Total steps executed across all sessions |

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
| [Creating Rill Apps](guide-make.md) | Bootstrap new rill projects with `rill-compose init` |
| [Compose](integration-compose.md) | Manifest format, validateManifest, and composeAgent API |
