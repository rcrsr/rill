# @rcrsr/rill-host

Production HTTP server harness for rill agents.

## Install

```bash
npm install @rcrsr/rill-host @rcrsr/rill-compose
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
// POST /run               — start a session
// GET  /sessions/:id/stream — SSE events
// GET  /healthz           — health status
// GET  /metrics           — Prometheus metrics
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /run | Start an agent session |
| POST | /stop | Initiate graceful shutdown |
| POST | /sessions/:id/abort | Abort a running session |
| GET | /sessions | List all session records |
| GET | /sessions/:id | Get a single session record |
| GET | /sessions/:id/stream | SSE event stream |
| GET | /healthz | Health snapshot |
| GET | /readyz | Readiness probe |
| GET | /metrics | Prometheus metrics |
| GET | /.well-known/agent-card.json | Agent capability card |

## Configuration

```typescript
createAgentHost(agent, {
  port: 3000,
  healthPath: '/healthz',
  readyPath: '/readyz',
  metricsPath: '/metrics',
  maxConcurrentSessions: 10,
  responseTimeout: 30000,   // ms before returning state: "running"
  sessionTtl: 3600000,      // ms to retain completed sessions
  drainTimeout: 30000,      // ms to wait during graceful shutdown
  logLevel: 'info',         // 'silent' | 'error' | 'warn' | 'info' | 'debug'
})
```

## What It Does

- Manages agent session lifecycle (running → completed/failed)
- Streams execution events over SSE to late-connecting clients
- Exposes Prometheus metrics for session counts, duration, and host calls
- Handles SIGTERM gracefully (drain sessions) and SIGINT immediately (abort all)

## See Also

Full documentation: https://rill.run/docs/integration/agent-host/
