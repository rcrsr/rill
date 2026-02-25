# Data Cruncher Demo

A rill agent that computes statistics on a list of numbers using pipe-based operators (`map`, `filter`, `fold`) and persists a run counter with the `kv` extension.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm run -r build
```

## Start the server

```bash
pnpm --filter rill-demo start
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

- **Manifest-driven composition**: `agent.json` declares the agent's entry script, extensions, and host options
- **Builtin extension loading**: The `kv` extension (`@rcrsr/rill/ext/kv`) loads through the `extractFactory` named-export pipeline (DEBT-4)
- **Pipe-based data processing**: `fold`, `map`, `filter` operators in `main.rill`
- **SSE observability**: `log` calls in the script emit real-time events on the `/sessions/{id}/stream` endpoint
- **Session management**: Each `/run` request creates a tracked session with lifecycle state
