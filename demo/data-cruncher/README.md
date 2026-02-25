# Data Cruncher Demo

A rill agent that computes statistics on a list of numbers using pipe-based operators (`map`, `filter`, `fold`) and persists a run counter with the `kv` extension.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm run -r build
```

## Build and start

```bash
cd demo/data-cruncher
pnpm build   # rill-compose agent.json --target local --output dist/
pnpm start   # tsx dist/host.ts
```

The server starts on `http://localhost:3000`.

## Endpoints

### Run the agent

```bash
curl -X POST http://localhost:3000/run \
  -H 'Content-Type: application/json' \
  -d '{"params": {"numbers": [4, 7, 2, 9, 1, 8, 3]}}'
```

Returns computed statistics: count, sum, mean, min, max, variance, above_mean, squared, and a persistent run counter.

### Health check

```bash
curl http://localhost:3000/healthz
```

### List sessions

```bash
curl http://localhost:3000/sessions
```

### SSE stream for a session

```bash
curl -N http://localhost:3000/sessions/{id}/stream
```

Replace `{id}` with a session ID from the `/run` or `/sessions` response.

### Agent card

```bash
curl http://localhost:3000/.well-known/agent-card.json
```

## What it demonstrates

- **Manifest-driven composition**: `rill-compose` builds the agent from `agent.json` into `dist/`
- **Generated host entry**: `dist/host.ts` is generated — no hand-written server code
- **Builtin extension loading**: The `kv` extension loads through the named-export pipeline
- **Pipe-based data processing**: `fold`, `map`, `filter` operators in `main.rill`
- **SSE observability**: `log` calls emit real-time events on `/sessions/{id}/stream`
- **Session management**: Each `/run` request creates a tracked session with lifecycle state

## Build output

```
dist/
  host.ts                      # Generated server entry (run with tsx)
  agent.json                   # Resolved manifest
  scripts/main.rill            # Copied entry script
  .well-known/agent-card.json  # Agent discovery card
```
