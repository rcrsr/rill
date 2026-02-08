# @rcrsr/rill-ext-claude-code

rill extension for executing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) operations from rill scripts. Provides `prompt`, `skill`, and `command` host functions with streaming output parsing, token tracking, and process lifecycle management.

> **Experimental.** Breaking changes will occur until v1.0.

## Install

```bash
npm install @rcrsr/rill-ext-claude-code
```

**Peer dependencies:** `@rcrsr/rill`, `node-pty`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createClaudeCodeExtension } from '@rcrsr/rill-ext-claude-code';

const ext = createClaudeCodeExtension();
const prefixed = prefixFunctions('claude_code', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `claude_code::prompt("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All functions return a dict with `result`, `tokens`, `cost`, `exitCode`, and `duration`.

### claude_code::prompt(text, options?)

Execute a Claude Code prompt.

```rill
claude_code::prompt("Analyze this code for security issues") => $response
$response.result -> log
$response.tokens.output -> log
```

### claude_code::skill(name, args?)

Execute a Claude Code skill (slash command).

```rill
claude_code::skill("commit", [message: "fix: resolve login bug"])
```

### claude_code::command(name, args?)

Execute a Claude Code command.

```rill
claude_code::command("review-pr", [pr: "123"]) => $review
$review.result -> log
```

## Configuration

```typescript
const ext = createClaudeCodeExtension({
  binaryPath: '/usr/local/bin/claude',     // default: 'claude'
  defaultTimeout: 60000,                   // default: 1800000 (30 min)
  dangerouslySkipPermissions: true,        // default: true
  settingSources: '',                      // default: '' (no plugins)
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `binaryPath` | string | `'claude'` | Path to Claude Code CLI binary |
| `defaultTimeout` | number | `1800000` | Default timeout in ms (max: 3600000) |
| `dangerouslySkipPermissions` | boolean | `true` | Bypass permission checks |
| `settingSources` | string | `''` | Setting sources to load (see below) |

### settingSources

Controls which Claude Code settings load at startup. Maps to `--setting-sources`.

| Value | Effect |
|-------|--------|
| `''` (default) | No settings loaded. Disables plugins, MCP servers, slash commands. |
| `'user'` | Load user settings (~/.claude/settings.json) including plugins. |
| `'project'` | Load project settings (.claude/settings.json). |
| `'user,project'` | Load both user and project settings. |

The factory validates the binary path and timeout eagerly. It throws if the binary is not found in `$PATH` or the timeout is out of range.

## Result Shape

```typescript
interface ClaudeCodeResult {
  result: string;      // combined text from assistant messages
  tokens: TokenCounts; // prompt, cacheWrite5m, cacheWrite1h, cacheRead, output
  cost: number;        // total cost in USD
  exitCode: number;    // CLI process exit code (0 = success)
  duration: number;    // execution duration in ms
}
```

## Lifecycle

Call `dispose()` on the extension to clean up active processes:

```typescript
const ext = createClaudeCodeExtension();
// ... use extension ...
await ext.dispose?.();
```

## Test Host

A runnable example at `examples/test-host.ts` wires up the extension with the rill runtime:

```bash
# Built-in demo
pnpm exec tsx examples/test-host.ts

# Inline expression
pnpm exec tsx examples/test-host.ts -e 'claude_code::prompt("Tell me a joke") -> log'

# Script file
pnpm exec tsx examples/test-host.ts script.rill
```

Requires `node-pty` native module built for your platform and `claude` in `$PATH`.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |

## License

MIT
