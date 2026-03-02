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
pnpm build   # rill-agent-bundle build agent.json
pnpm start   # pipes JSON params to rill-agent-run
```

Or run directly:

```bash
echo '{"numbers":[4,7,2,9,1,8,3]}' | rill-agent-run dist/ demo-agent
```

Returns computed statistics: count, sum, mean, min, max, variance, above_mean, squared, and a persistent run counter.

## Verify bundle

```bash
pnpm check   # rill-agent-bundle check --platform node dist/
```

## What it demonstrates

- **Manifest-driven composition**: `rill-agent-bundle` builds the agent from `agent.json` into `dist/`
- **CLI execution**: `rill-agent-run` executes the bundle as a one-shot CLI command
- **Builtin extension loading**: The `kv` extension loads through the named-export pipeline
- **Pipe-based data processing**: `fold`, `map`, `filter` operators in `main.rill`

## Build output

```
dist/
  bundle.json                  # Bundle manifest
  handlers.js                  # Compiled handler entry
  agents/
    demo-agent/
      scripts/main.rill        # Copied entry script
  .well-known/agent-card.json  # Agent discovery card
```
