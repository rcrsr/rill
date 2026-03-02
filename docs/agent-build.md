# rill Agent Build CLI

*Generate harness entry points for rill agent bundles*

## Overview

`@rcrsr/rill-agent-build` generates a `harness.js` entry point from a built agent bundle. It reads the bundle's `handlers.js` and `bundle.json`, then writes a typed ESM module wired to the target runtime. The package ships as both a Node.js API and the `rill-agent-build` CLI.

## Installation

```bash
npm install @rcrsr/rill-agent-build
```

## Quick Start

```bash
rill-agent-build --harness http dist/
```

This writes `dist/harness.js` wired to the HTTP harness. Run `node dist/harness.js` to start the agent server.

## CLI

```bash
rill-agent-build --harness <type> [--output <path>] <bundle-dir>
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--harness <type>` | Yes | Harness type: `http`, `stdio`, `gateway`, or `worker` |
| `--output <path>` | No | Output file path. Default: `<bundle-dir>/harness.js` |
| `<bundle-dir>` | Yes | Path to bundle `dist/` directory |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | `harness.js` generated successfully |
| `1` | Error: missing bundle, invalid harness type, or write failure |

### Examples

```bash
# HTTP server on PORT env var (default: 3000)
rill-agent-build --harness http dist/

# Stdio transport for CLI or pipe-based invocation
rill-agent-build --harness stdio dist/

# Serverless gateway export (AWS Lambda, Vercel, etc.)
rill-agent-build --harness gateway dist/

# Cloudflare Worker export
rill-agent-build --harness worker dist/

# Custom output path
rill-agent-build --harness http --output deploy/index.js dist/
```

## Harness Types

| Type | Use Case | Entry Point |
|------|----------|-------------|
| `http` | Long-running HTTP server | `await harness.listen()` |
| `stdio` | CLI tools, pipe-based invocation | `await harness.start()` |
| `gateway` | Serverless functions (AWS Lambda, Vercel) | `export const handler` |
| `worker` | Cloudflare Workers | `export default` |

## Generated Output

Each harness type produces a distinct ESM module. The generated file imports from the bundle's local `handlers.js` and the appropriate sub-path of `@rcrsr/rill-agent-harness`.

### http

```javascript
import { handlers } from './handlers.js';
import { createHttpHarness } from '@rcrsr/rill-agent-harness/http';
const harness = createHttpHarness(handlers, { port: parseInt(process.env.PORT ?? '3000', 10) });
await harness.listen();
```

The `PORT` environment variable controls the listen port. It defaults to `3000` when absent.

### stdio

```javascript
import { handlers } from './handlers.js';
import { createStdioHarness } from '@rcrsr/rill-agent-harness/stdio';
const harness = createStdioHarness(handlers);
await harness.start();
```

Use this type when invoking agents from a shell, another process, or a pipe.

### gateway

```javascript
import { handlers } from './handlers.js';
import { createGatewayHarness } from '@rcrsr/rill-agent-harness/gateway';
export const handler = createGatewayHarness(handlers);
```

The named `handler` export matches the serverless function signature expected by AWS Lambda and Vercel.

### worker

```javascript
import { handlers } from './handlers.js';
import { createWorkerHarness } from '@rcrsr/rill-agent-harness/worker';
export default createWorkerHarness(handlers);
```

The default export satisfies the Cloudflare Workers module interface.

## Error Conditions

| Condition | Error Message |
|-----------|---------------|
| `bundle-dir` path does not exist | `Bundle directory not found: <path>` |
| `bundle.json` not found in bundle dir | `bundle.json not found: <path>` |
| `handlers.js` not found in bundle dir | `handlers.js not found: <path>` |
| Invalid `--harness` value | `Invalid harness type: <type>. Valid types: http, stdio, gateway, worker` |
| Output path not writable | `Cannot write harness to <path>: <os-error>` |

All errors exit with code `1` and write the message to stderr.

## Programmatic API

### generateHarness(bundleDir, harnessType, options?)

```typescript
export declare function generateHarness(
  bundleDir: string,
  harnessType: HarnessType,
  options?: GenerateHarnessOptions
): Promise<GenerateHarnessResult>;
```

Reads `bundle.json` and `handlers.js` from `bundleDir`, then writes the ESM harness to the output path.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bundleDir` | `string` | Path to the bundle `dist/` directory |
| `harnessType` | `HarnessType` | One of `'http' \| 'stdio' \| 'gateway' \| 'worker'` |
| `options` | `GenerateHarnessOptions` | Optional. Override the output file path. |

**GenerateHarnessOptions:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `outputPath` | `string` | `<bundleDir>/harness.js` | Absolute or relative path for the generated file |

**GenerateHarnessResult:**

| Field | Type | Description |
|-------|------|-------------|
| `outputPath` | `string` | Absolute path of the written file |
| `harnessType` | `HarnessType` | The harness type that was generated |
| `agentCount` | `number` | Number of agents found in `bundle.json` |

**Example:**

```typescript
import { generateHarness } from '@rcrsr/rill-agent-build';

const result = await generateHarness('./dist', 'http');
console.log(`Wrote ${result.harnessType} harness for ${result.agentCount} agent(s): ${result.outputPath}`);
```

**Example with custom output path:**

```typescript
import { generateHarness } from '@rcrsr/rill-agent-build';

const result = await generateHarness('./dist', 'gateway', {
  outputPath: './deploy/index.js',
});
console.log(result.outputPath);
```

`generateHarness` throws `Error` for all failure conditions. See [Error Conditions](#error-conditions) for the full list with message formats.

### Types

```typescript
export type HarnessType = 'http' | 'stdio' | 'gateway' | 'worker';

export interface GenerateHarnessOptions {
  readonly outputPath?: string;
}

export interface GenerateHarnessResult {
  readonly outputPath: string;
  readonly harnessType: HarnessType;
  readonly agentCount: number;
}
```

## See Also

| Document | Description |
|----------|-------------|
| [Agent Bundle](agent-bundle.md) | Build bundle directories from `agent.json` manifests |
| [Agent Run](agent-run.md) | Execute bundled rill agents from the command line |
| [Agent Harness](agent-harness.md) | Production HTTP server for long-running rill agents |
| [Agent Shared](agent-shared.md) | Shared agent types, validation, and card generation |
