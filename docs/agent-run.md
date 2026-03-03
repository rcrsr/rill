# rill-agent-run

*Execute bundled rill agents from the command line*

## Overview

`@rcrsr/rill-agent-run` executes bundled rill agents produced by `rill-agent-bundle build`. It accepts parameters via CLI flags or piped JSON on stdin, writes the result to stdout, and exits with code 0 on success or 1 on failure.

## Installation

```bash
npm install @rcrsr/rill-agent-run
```

## CLI

```bash
rill-agent-run <bundle-dir> [agent-name] [--param key=value]... [--timeout <ms>] [--config <file-or-json>] [--log-level silent|info|debug]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `bundle-dir` | Path to the bundle directory produced by `rill-agent-bundle build` |
| `agent-name` | Name of the agent to execute within the bundle |

### Options

| Option | Description |
|--------|-------------|
| `--param key=value` | Pass a named input parameter. Repeat for multiple parameters. |
| `--timeout <ms>` | Abort execution after the given number of milliseconds. |
| `--config <file-or-json>` | Path to config JSON file, or inline JSON string. Supports `${VAR}` interpolation. |
| `--log-level silent\|info\|debug` | Control log verbosity. Reads `LOG_LEVEL` env var when absent. Default: `info`. |

### Examples

```bash
rill-agent-run dist/ classifier --param text="hello world"
rill-agent-run dist/ summarizer --param url=https://example.com --timeout 5000
rill-agent-run dist/ my-agent --config config.json
rill-agent-run dist/ my-agent --config '{"llm":{"api_key":"${GROQ_API_KEY}","model":"llama-4"}}'
```

## Input Sources

Parameters reach the agent from two sources: `--param` flags and piped JSON on stdin.

### --param Flags

Each `--param key=value` flag sets one named input. Values are always strings unless the manifest declares a non-string type, in which case the harness coerces the value.

```bash
rill-agent-run dist/ my-agent --param question="What is the refund policy?" --param lang=en
```

### Piped stdin

When stdin is not a terminal, `rill-agent-run` reads it as a JSON object and treats each top-level key as a named input parameter.

```bash
echo '{"question": "What is the refund policy?", "lang": "en"}' | rill-agent-run dist/ my-agent
```

### Precedence

When both `--param` flags and piped JSON provide a value for the same parameter, the `--param` flag takes precedence.

```bash
echo '{"lang": "fr"}' | rill-agent-run dist/ my-agent --param lang=en
# lang resolves to "en"
```

## Output

| Stream | Content |
|--------|---------|
| stdout | Result value serialized as JSON |
| stderr | Script `log` output, extension events, error messages, and diagnostics |

On success, the agent's return value is written to stdout as a JSON-serialized rill value. On failure, the error message is written to stderr and nothing is written to stdout.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Agent executed successfully |
| `1` | Execution failed (runtime error, timeout, or invalid input) |

## API Reference

Use the programmatic API to invoke agents from TypeScript without the CLI.

### runAgent(bundleDir, agentName, options?)

```typescript
async function runAgent(
  bundleDir: string,
  agentName: string,
  options?: RunOptions
): Promise<RunResult>
```

Loads the bundle, composes the named agent, injects parameters, and executes the entry script. Returns a `RunResult` on success. Throws if the bundle cannot be loaded or the agent name is not found.

### RunOptions

| Option | Type | Description |
|--------|------|-------------|
| `params` | `Record<string, unknown>` | Named input parameters passed to the agent |
| `timeout` | `number` | Abort execution after this many milliseconds |
| `config` | `Record<string, Record<string, unknown>>` | Extension config keyed by alias. When omitted, treated as `{}`. |

### RunResult

| Field | Type | Description |
|-------|------|-------------|
| `result` | `RillValue` | The value returned by the agent's entry script |
| `exitCode` | `0 \| 1` | Exit code reflecting success or failure |
| `durationMs` | `number` | Elapsed execution time in milliseconds |

### Example

```typescript
import { runAgent } from '@rcrsr/rill-agent-run';

const result = await runAgent('./dist', 'classifier', {
  params: { text: 'hello world' },
  timeout: 5000,
  config: {
    llm: { api_key: process.env.GROQ_API_KEY, model: 'llama-4' }
  },
});

console.log(result.result);
console.log(`Completed in ${result.durationMs}ms`);
```

## Config

The `--config` flag accepts a file path or inline JSON string.

```bash
# Config file
rill-agent-run dist/ my-agent --config config.json
rill-agent-run dist/ my-agent --config ./prod.json

# Inline JSON
rill-agent-run dist/ my-agent --config '{"llm": {"api_key": "${GROQ_API_KEY}"}}'
```

Config is keyed by extension alias. Each value is the config object passed to that extension.

`${VAR}` patterns in config values are interpolated against `process.env` after JSON parsing. Unset variables are retained as-is — they are not replaced with empty strings.

When `--config` is omitted, config defaults to `{}`.

## See Also

| Document | Description |
|----------|-------------|
| [Agent Bundle](agent-bundle.md) | Build bundle directories from agent.json manifests |
| [Agent Harness](agent-harness.md) | Production HTTP server for long-running rill agents |
