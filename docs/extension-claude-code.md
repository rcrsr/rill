# claude_code Extension

*Claude Code CLI integration for AI-powered rill scripts*

This extension spawns the Claude Code CLI as a subprocess and exposes it to rill scripts. Scripts send prompts, invoke skills like `/commit`, and run named commands. The extension handles process lifecycle, timeout enforcement, and NDJSON stream parsing.

Each call returns a dict with the response text, token usage breakdown, cost in USD, exit code, and duration in ms. Typical uses: automated code review, commit generation, and PR workflows.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createClaudeCodeExtension } from '@rcrsr/rill-ext-claude-code';

const ext = createClaudeCodeExtension({ defaultTimeout: 60000 });
const functions = prefixFunctions('claude_code', ext);
const ctx = createRuntimeContext({ functions });

// Script: claude_code::prompt("Explain TCP handshakes")
```

## Prerequisites

The extension requires two external dependencies:

- **node-pty** (peer dependency) — Requires native compilation during install
- **claude binary** — Must be in `$PATH` before factory call

The factory validates both requirements eagerly and throws on missing dependencies.

## Configuration

```typescript
import { createClaudeCodeExtension } from '@rcrsr/rill-ext-claude-code';

const ext = createClaudeCodeExtension({
  binaryPath: '/usr/local/bin/claude',  // default: 'claude'
  defaultTimeout: 60000,                // default: 1800000 (30 min)
  dangerouslySkipPermissions: true,     // default: true
  settingSources: '',                   // default: ''
});
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `binaryPath` | string | `'claude'` | Path to Claude CLI binary |
| `defaultTimeout` | number | `1800000` | Timeout in ms (max: 3600000) |
| `dangerouslySkipPermissions` | boolean | `true` | Skip permission checks |
| `settingSources` | string | `''` | Settings to load at startup |

### settingSources Values

Controls which Claude Code settings load before execution.

| Value | Effect |
|-------|--------|
| `''` (default) | No settings. Disables plugins, MCP servers, slash commands. |
| `'user'` | Load user settings (~/.claude/settings.json) including plugins. |
| `'project'` | Load project settings (.claude/settings.json). |
| `'user,project'` | Load both user and project settings. |

## Functions

**prompt(text, options?)** — Execute a Claude Code prompt:

```rill
claude_code::prompt("Explain TCP handshakes") => $result
$result.result       # Response text
$result.tokens       # Token usage breakdown
$result.cost         # Cost in USD
$result.duration     # Execution time in ms
```

**skill(name, args?)** — Execute a Claude Code skill:

```rill
claude_code::skill("commit", [message: "fix: resolve timeout bug"]) => $result
$result.result
```

**command(name, args?)** — Execute a Claude Code command:

```rill
claude_code::command("review-pr", [pr: "123"]) => $result
$result.result
```

All functions accept an `options` dict as the second parameter.

### PromptOptions

Override timeout per call via `options` dict:

```text
claude_code::prompt("Long task", [timeout: 300000]) => $result
```

| Option | Type | Description |
|--------|------|-------------|
| `timeout` | number | Override defaultTimeout for this call |

## Result Dict

All 3 functions return the same structure:

| Field | Type | Description |
|-------|------|-------------|
| `result` | string | Combined text output |
| `tokens` | dict | Token usage breakdown |
| `tokens.prompt` | number | Non-cached prompt tokens |
| `tokens.cacheWrite5m` | number | 5-minute cache write tokens |
| `tokens.cacheWrite1h` | number | 1-hour cache write tokens |
| `tokens.cacheRead` | number | Cache read tokens |
| `tokens.output` | number | Output tokens |
| `cost` | number | Total cost in USD |
| `exitCode` | number | CLI exit code (0 = success) |
| `duration` | number | Execution time in ms |

## Error Behavior

The extension validates inputs and process state at runtime.

**Validation errors** (empty input):

- Empty prompt text throws `RuntimeError RILL-R004: prompt text cannot be empty`
- Empty skill name throws `RuntimeError RILL-R004: skill name cannot be empty`
- Empty command name throws `RuntimeError RILL-R004: command name cannot be empty`

**Process errors**:

- Binary not found throws `RuntimeError RILL-R004: claude binary not found`
- Timeout throws `RuntimeError RILL-R004: Claude CLI timeout after Xms`
- Non-zero exit throws `RuntimeError RILL-R004: Claude CLI exited with code X`

## Events

| Event | Emitted When |
|-------|-------------|
| `claude-code:prompt` | Prompt completes |
| `claude-code:skill` | Skill completes |
| `claude-code:command` | Command completes |
| `claude-code:error` | Any operation fails |

## Test Host

A runnable example at `packages/ext/claude-code/examples/test-host.ts` demonstrates integration:

```bash
# Built-in demo
pnpm exec tsx examples/test-host.ts

# Inline expression
pnpm exec tsx examples/test-host.ts -e 'claude_code::prompt("Tell me a joke") -> log'

# Script file
pnpm exec tsx examples/test-host.ts script.rill
```

The test host wires the extension to the rill runtime with logging callbacks.

## Low-Level Exports

Advanced use cases can import low-level utilities:

- `createStreamParser()` — Parse NDJSON stream from Claude CLI
- `spawnClaudeCli()` — Spawn process with timeout enforcement
- `extractResult()` — Aggregate messages into result dict

See package source for implementation details.

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
