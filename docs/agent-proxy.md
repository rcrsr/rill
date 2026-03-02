# rill Agent Proxy

*Multi-agent routing proxy that spawns agent bundles as child processes*

## Overview

`@rcrsr/rill-agent-proxy` routes HTTP requests to rill agent bundles by spawning each agent as a child process per request. It enforces concurrency limits, mediates agent-to-agent (AHI) calls, and exposes Prometheus metrics. For running a single agent with an in-process HTTP server, see [Agent Harness](agent-harness.md).

## Installation

```bash
npm install @rcrsr/rill-agent-proxy
```

## Quick Start

```bash
rill-agent-proxy --bundles ./bundles --port 3000
```

The proxy scans `./bundles` at startup, registers each bundle as a catalog entry, and starts accepting requests.

## CLI Reference

```
rill-agent-proxy --bundles <dir> [options]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--bundles <dir>` | Yes | — | Path to bundles directory |
| `--port <number>` | No | `3000` | HTTP listen port |
| `--config <path>` | No | — | Proxy config JSON file path |
| `--max-concurrent <n>` | No | `10` | Global concurrency limit across all agents |
| `--max-per-agent <n>` | No | `5` | Per-agent concurrency limit |
| `--timeout <ms>` | No | `60000` | Default request timeout in milliseconds |
| `--log-level <level>` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

CLI flags override values from the config file. `--bundles` must be provided even when `--config` is used.

## Configuration File

Pass `--config <path>` to load a JSON file with the same shape as `ProxyConfig`. CLI flags take precedence over file values.

```json
{
  "bundlesDir": "./bundles",
  "port": 3000,
  "host": "0.0.0.0",
  "logLevel": "info",
  "drainTimeoutMs": 30000,
  "concurrency": {
    "maxConcurrent": 10,
    "maxConcurrentPerAgent": 5,
    "queueSize": 0,
    "requestTimeoutMs": 60000
  },
  "agentConfig": {
    "feedback-analyzer": {
      "llm": { "model": "claude-3-5-sonnet-20241022" }
    }
  }
}
```

### ProxyConfig Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bundlesDir` | `string` | — | Required. Path to bundles directory |
| `port` | `number` | `3000` | HTTP listen port |
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `'info'` | Minimum log level |
| `drainTimeoutMs` | `number` | `30000` | Milliseconds to wait for in-flight requests during shutdown |
| `registryUrl` | `string` | — | Optional service registry URL for agent discovery |
| `concurrency` | `ConcurrencyConfig` | See below | Concurrency and timeout tuning |
| `agentConfig` | `Record<string, Record<string, Record<string, unknown>>>` | `{}` | Per-agent config injected into each run message |

### ConcurrencyConfig Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxConcurrent` | `number` | `10` | Maximum total concurrent child processes across all agents |
| `maxConcurrentPerAgent` | `number` | `5` | Maximum concurrent child processes per agent |
| `queueSize` | `number` | `0` | Maximum queued requests; `0` rejects immediately when at limit |
| `requestTimeoutMs` | `number` | `60000` | Milliseconds before a child process is killed |

## Bundle Directory Layout

The proxy scans each subdirectory under `--bundles` for a `bundle.json` and `harness.js`. Directories missing either file are skipped with a warning.

```
bundles/
├── feedback-analyzer/
│   ├── bundle.json
│   ├── harness.js
│   └── agents/feedback-analyzer/...
├── content-pipeline/
│   ├── bundle.json
│   ├── harness.js
│   └── agents/content-pipeline/...
```

Each `bundle.json` declares one or more agents. The proxy registers each declared agent as a separate catalog entry, all backed by the same `harness.js`.

## HTTP API

### POST /agents/:name/run

Execute an agent. The proxy spawns a child process, writes the run message to stdin, collects the result from stdout, and returns it.

Request:

```json
{
  "params": { "text": "Great product, fast shipping" },
  "timeout": 30000
}
```

`params` is an optional object of input parameters. `timeout` overrides the default `requestTimeoutMs` for this request.

Success response (HTTP 200):

```json
{
  "sessionId": "sess_abc123",
  "state": "completed",
  "result": { "sentiment": "positive", "score": 0.92 },
  "durationMs": 1247
}
```

`state` is `"completed"` on success or `"failed"` when the child exits with an error result.

### GET /agents/:name/card

Return the agent card from the catalog entry.

Success response (HTTP 200):

```json
{
  "name": "feedback-analyzer",
  "description": "Analyzes customer feedback sentiment",
  "version": "1.2.0",
  "url": "http://localhost:3000",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "skills": [],
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"]
}
```

Returns HTTP 404 when the agent name is not in the catalog.

### GET /catalog

Return all catalog entries.

Success response (HTTP 200):

```json
[
  { "name": "feedback-analyzer", "version": "1.2.0", "checksum": "sha256:abc123...", "dependencies": [] },
  { "name": "content-pipeline", "version": "0.5.0", "checksum": "sha256:def456...", "dependencies": ["feedback-analyzer"] }
]
```

`checksum` is a SHA-256 hash of `bundle.json` content, formatted as `sha256:<hex>`. `dependencies` lists AHI agent names this bundle calls.

### POST /catalog/refresh

Re-scan the bundles directory. Adds new agents, removes deleted ones, and updates changed entries.

Success response (HTTP 200):

```json
{
  "refreshed": true,
  "agents": [
    { "name": "feedback-analyzer", "version": "1.2.0", "checksum": "sha256:abc123..." }
  ]
}
```

Returns HTTP 500 on scan failure.

### GET /healthz

Proxy liveness check. Returns HTTP 200 while the process is running.

Success response (HTTP 200):

```json
{ "status": "ok", "uptime": 123.4 }
```

`uptime` is seconds since the proxy started.

### GET /readyz

Readiness probe. Returns HTTP 200 when the catalog contains at least one agent. Returns HTTP 503 before any valid bundles are loaded.

Success response (HTTP 200):

```json
{ "ready": true }
```

Not-ready response (HTTP 503):

```json
{ "ready": false }
```

### GET /metrics

Prometheus text format metrics. See [Metrics](#metrics) for the full list.

### GET /status

Active child processes and concurrency counters.

Success response (HTTP 200):

```json
{
  "activeCount": 3,
  "active": [
    {
      "pid": 12345,
      "agentName": "feedback-analyzer",
      "correlationId": "corr_xyz",
      "spawnedAt": 1709400000000,
      "timeoutAt": 1709400060000
    }
  ],
  "concurrency": {
    "active": 3,
    "activeByAgent": { "feedback-analyzer": 2, "content-pipeline": 1 },
    "queued": 0,
    "rejected": 0
  }
}
```

### Endpoint Summary

| Method | Path | Description | Success | Error |
|--------|------|-------------|---------|-------|
| `POST` | `/agents/:name/run` | Execute agent as child process | 200 | 400, 404, 429, 500, 504 |
| `GET` | `/agents/:name/card` | Agent card from catalog | 200 | 404 |
| `GET` | `/catalog` | All catalog entries | 200 | — |
| `POST` | `/catalog/refresh` | Re-scan bundles directory | 200 | 500 |
| `GET` | `/healthz` | Proxy liveness: `{ status: "ok", uptime }` | 200 | — |
| `GET` | `/readyz` | Catalog loaded and agents available | 200 | 503 |
| `GET` | `/metrics` | Prometheus text format | 200 | — |
| `GET` | `/status` | Active processes and concurrency stats | 200 | — |

## Error Codes

All error responses use the shape `{ "error": { "code": "...", "message": "...", "detail?": "..." } }`.

| HTTP Status | Code | Trigger |
|-------------|------|---------|
| 400 | `PROXY_INVALID_REQUEST` | Invalid JSON body or non-object body |
| 404 | `PROXY_NOT_FOUND` | Agent name not in catalog |
| 429 | `PROXY_CONCURRENCY_LIMIT` | Global or per-agent concurrency limit reached |
| 500 | `PROXY_CHILD_CRASH` | Child exits non-zero with no result message |
| 500 | `PROXY_PROTOCOL_ERROR` | Child writes invalid NDJSON to stdout |
| 500 | `PROXY_SPAWN_ERROR` | Child process fork fails (e.g., ENOENT) |
| 504 | `PROXY_TIMEOUT` | Child exceeds `requestTimeoutMs` |

Error response example:

```json
{
  "error": {
    "code": "PROXY_CONCURRENCY_LIMIT",
    "message": "Global concurrency limit of 10 reached"
  }
}
```

`detail` is included when the child process provides additional context.

### Child Behavior to HTTP Mapping

| Child Behavior | HTTP Status | Error Code |
|----------------|-------------|------------|
| Exits 0, `run.result` received | 200 | — |
| Exits non-zero, no `run.result` | 500 | `PROXY_CHILD_CRASH` |
| Timeout, no `run.result` | 504 | `PROXY_TIMEOUT` |
| Invalid NDJSON on stdout | 500 | `PROXY_PROTOCOL_ERROR` |
| Spawn fails (ENOENT) | 500 | `PROXY_SPAWN_ERROR` |

## AHI Mediation

AHI (Agent-to-Agent Host Invocation) lets a running agent call another agent through the proxy. When a child process sends an `ahi` NDJSON message on stdout, the proxy spawns the target agent as a second child process, collects its result, and writes an `ahi.result` message back to the original child's stdin.

AHI message format (child stdout):

```json
{ "method": "ahi", "id": "req_1", "target": "content-pipeline", "params": { "text": "..." }, "timeout": 10000 }
```

AHI result format (written to child stdin):

```json
{ "method": "ahi.result", "id": "req_1", "result": { "summary": "..." } }
```

When the target agent fails, the proxy writes an error result:

```json
{ "method": "ahi.result", "id": "req_1", "error": { "code": "PROXY_CHILD_CRASH", "message": "..." } }
```

When the target agent is not in the catalog, the proxy writes:

```json
{ "method": "ahi.result", "id": "req_1", "error": { "code": "PROXY_AHI_TARGET_MISSING", "message": "AHI target \"content-pipeline\" not found in catalog" } }
```

**Concurrency:** Each AHI child process counts against the global `maxConcurrent` limit. A chain A→B→C consumes 3 concurrent slots simultaneously.

**Correlation:** The root request's `correlationId` propagates to all AHI child processes.

## Metrics

Each proxy instance registers its own Prometheus metrics. Two proxy instances in the same process do not share a registry. Scrape `GET /metrics` for the text/plain exposition format.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `rill_proxy_requests_total` | Counter | `agent`, `status` | Total requests received |
| `rill_proxy_active_processes` | Gauge | `agent` | Currently running child processes |
| `rill_proxy_request_duration_seconds` | Histogram | `agent` | End-to-end request duration |
| `rill_proxy_spawn_duration_seconds` | Histogram | `agent` | Child process spawn and execution time |
| `rill_proxy_ahi_calls_total` | Counter | `source`, `target` | AHI mediation calls |
| `rill_proxy_concurrency_rejections_total` | Counter | `agent` | Requests rejected at 429 |
| `rill_proxy_child_errors_total` | Counter | `agent`, `code` | Child process errors by error code |

`status` label on `rill_proxy_requests_total` is `"200"` for completed requests and `"500"` for failed requests. `"error"` is used for requests that throw before a result is collected.

## Programmatic API

```typescript
import { createProxy } from '@rcrsr/rill-agent-proxy';
import type { ProxyConfig, AgentProxy } from '@rcrsr/rill-agent-proxy';

const config: ProxyConfig = {
  bundlesDir: './bundles',
  port: 3000,
};

const proxy: AgentProxy = await createProxy(config);
await proxy.listen();
```

`createProxy` throws when `bundlesDir` does not exist or contains no valid bundles.

### AgentProxy Interface

```typescript
export interface AgentProxy {
  listen(): Promise<void>;
  close(): Promise<void>;
  run(agentName: string, request: RunRequest): Promise<RunResponse>;
  catalog(): CatalogEntry[];
  active(): ActiveProcess[];
  refreshCatalog(): Promise<void>;
}
```

| Method | Description |
|--------|-------------|
| `listen()` | Start the HTTP server on `config.port`. Resolves when the server is accepting connections. |
| `close()` | Drain in-flight requests up to `drainTimeoutMs`, then close the HTTP server. |
| `run(name, request)` | Execute an agent directly without HTTP. Throws `ProxyError` on failure. |
| `catalog()` | Return the current catalog entries as an array. |
| `active()` | Return currently running child processes. |
| `refreshCatalog()` | Re-scan the bundles directory and update the catalog. |

### ProxyError

```typescript
export class ProxyError extends Error {
  readonly code: string;
  readonly agentName?: string;
  readonly detail?: string;
}
```

`code` is one of the `PROXY_*` constants listed in [Error Codes](#error-codes). `agentName` identifies which agent was involved when applicable.

## Signal Handling

| Signal | Behavior |
|--------|----------|
| `SIGTERM` | Drain in-flight requests up to `drainTimeoutMs` ms, then exit with code 0 |

`SIGINT` is not handled by default. Send `SIGTERM` for graceful shutdown in production environments.

## See Also

| Document | Description |
|----------|-------------|
| [Agent Harness](agent-harness.md) | In-process HTTP server for single or multi-agent deployments |
| [Bundle CLI](agent-bundle.md) | Build agent bundles from manifests for use with the proxy |
| [Run CLI](agent-run.md) | Execute a single bundled agent from the command line |
| [Shared Types](agent-shared.md) | RunRequest, RunResponse, and AgentCard type definitions |
| [Developing Extensions](integration-extensions.md) | Write extensions including the AHI extension for agent-to-agent calls |
