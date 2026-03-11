# Developing Extensions

*Writing reusable host function packages distributed as npm modules*

## Quick Start

Create a simple extension with a factory function:

```typescript
import { createRuntimeContext, hoistExtension } from '@rcrsr/rill';
import type { ExtensionResult } from '@rcrsr/rill';

function createGreetExtension(config: { prefix: string }): ExtensionResult {
  return {
    greet: {
      params: [{ name: 'name', type: 'string' }],
      fn: (args) => `${config.prefix} ${args[0]}!`,
      description: 'Generate greeting',
      returnType: 'string',
    },
  };
}

const ext = createGreetExtension({ prefix: 'Hello' });
const { functions, dispose } = hoistExtension('app', ext);
const ctx = createRuntimeContext({ functions });

// Script: app::greet("World")
```

## Extension Contract

Every extension exports a factory function returning `ExtensionResult`:

```typescript
import type { ExtensionResult, RillFunction } from '@rcrsr/rill';

function createMyExtension(config: MyConfig): ExtensionResult {
  // Validate config eagerly (throw on invalid)
  // Return host function definitions + optional dispose
  return {
    greet: {
      params: [{ name: 'name', type: 'string' }],
      fn: (args) => `Hello, ${args[0]}!`,
      description: 'Generate greeting',
      returnType: 'string',
    },
    dispose: () => {
      // Cleanup resources (connections, processes, etc.)
    },
  };
}
```

### ExtensionResult Type

```typescript
type ExtensionResult = Record<string, RillFunction> & {
  dispose?: () => void | Promise<void>;
  suspend?: () => unknown;
  restore?: (state: unknown) => void;
};
```

Each key (except `dispose`, `suspend`, and `restore`) maps a function name to a `RillFunction`. The runtime registers these as callable host functions.

### ExtensionFactory Type

```typescript
type ExtensionFactory<TConfig> = (config: TConfig) => ExtensionResult;
```

Factory functions accept typed configuration and return an isolated extension instance.

## Extension Manifest

An extension manifest is the top-level export that `rill-run` and config-driven hosts consume. It packages the factory, optional config schema, and version into a single object.

```typescript
import type { ExtensionManifest } from '@rcrsr/rill';
import { createGreetExtension } from './factory.js';

export const extensionManifest: ExtensionManifest = {
  factory: createGreetExtension,
  configSchema: {
    prefix: { type: 'string', required: true },
    loud: { type: 'boolean', required: false },
  },
  version: '1.0.0',
};
```

### ExtensionManifest Interface

```typescript
interface ExtensionManifest {
  factory: ExtensionFactory<any>;             // creates the extension instance
  configSchema?: ExtensionConfigSchema;       // optional field declarations
  version?: string;                           // optional semver version string
}
```

### Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `factory` | `ExtensionFactory<any>` | Yes | Called with config object; must return `ExtensionResult` |
| `configSchema` | `ExtensionConfigSchema` | No | Maps field names to `ConfigFieldDescriptor` entries |
| `version` | `string` | No | Semver string (e.g., `"1.2.0"`); informational only |

`ExtensionConfigSchema` is `Record<string, ConfigFieldDescriptor>`. Each `ConfigFieldDescriptor` has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'boolean'` | Yes | Expected type for the config value |
| `required` | `boolean` | No | Whether the field must appear in config |
| `secret` | `boolean` | No | Advisory flag — tooling may mask or omit the value |

### Manifest Contract

To publish a conforming manifest:

1. Export a named `extensionManifest` from the package's main entry point.
2. If the factory accepts config, declare all fields in `configSchema` with their types and `required` flags.
3. The factory receives only the config object — it must not call rill runtime APIs during construction.
4. Validation errors must throw synchronously from the factory, not during function execution.

### Relationship to ExtensionResult and ExtensionFactory

`ExtensionManifest` wraps the existing `ExtensionFactory` type. The `factory` field is the same function you write for manual integration. The manifest adds `configSchema` and `version` so that `rill-run` can mount the extension without host-side wiring code. The mount path in `rill-config.json` determines the namespace prefix scripts use to call extension functions.

See [rill-run Config](ref-config.md) for how `extensions.mounts` entries reference manifest packages.

## Namespace Prefixing

Use `prefixFunctions()` to add a namespace prefix to all functions in an extension:

```typescript
import { prefixFunctions } from '@rcrsr/rill';

const ext = createMyExtension({ apiKey: 'sk-...' });
const prefixed = prefixFunctions('ai', ext);
// { "ai::greet": ..., dispose: ... }
```

Scripts call prefixed functions with `::` syntax:

```rill
ai::greet("World")    # "Hello, World!"
```

### Namespace Rules

- Non-empty string
- Alphanumeric characters, underscores, and hyphens only (`/^[a-zA-Z0-9_-]+$/`)
- Invalid namespaces throw `RuntimeError` with code `RUNTIME_TYPE_ERROR`

### Behavior

- Prefixes every key except `dispose` with `namespace::`
- Preserves the `dispose` method on the returned object
- Returns a new `ExtensionResult` (does not mutate the original)

## Extension Events

Extensions emit structured diagnostic events through `emitExtensionEvent()`:

```typescript
import { emitExtensionEvent, type RuntimeContextLike } from '@rcrsr/rill';

function myFunction(args: RillValue[], ctx: RuntimeContextLike) {
  const start = Date.now();
  const result = doWork(args[0]);

  emitExtensionEvent(ctx, {
    event: 'my-ext:operation',
    subsystem: 'extension:my-ext',
    duration: Date.now() - start,
  });

  return result;
}
```

### ExtensionEvent Interface

```typescript
interface ExtensionEvent {
  event: string;         // Semantic event name (e.g., "claude-code:prompt")
  subsystem: string;     // Extension identifier (pattern: "extension:{namespace}")
  timestamp?: string;    // ISO 8601 (auto-added by emitExtensionEvent if omitted)
  [key: string]: unknown; // Extensible context fields
}
```

### Receiving Events

Subscribe via the `onLogEvent` callback:

```typescript
const ctx = createRuntimeContext({
  callbacks: {
    onLogEvent: (event) => {
      console.log(`[${event.subsystem}] ${event.event}`, event);
    },
  },
  functions,
});
```

## Lifecycle Management

Extensions that manage external resources (processes, connections, timers) must implement `dispose()`:

```typescript
function createPooledExtension(config: PoolConfig): ExtensionResult {
  const pool = createConnectionPool(config);

  return {
    query: {
      params: [{ name: 'sql', type: 'string' }],
      fn: async (args) => pool.query(args[0]),
      description: 'Execute SQL query',
      returnType: 'any',
    },
    dispose: () => {
      pool.close();
    },
  };
}

// Usage
const ext = createPooledExtension({ maxConnections: 10 });
const { functions, dispose } = hoistExtension('db', ext);
const ctx = createRuntimeContext({ functions });

try {
  const result = await execute(ast, ctx);
} finally {
  dispose?.();
}
```

### Dispose Guidelines

- `dispose()` may be sync or async
- Must be idempotent (safe to call multiple times)
- Should not throw — log warnings for cleanup failures
- Always call `dispose()` in a `finally` block

## State Persistence

Extensions that hold in-memory state can implement `suspend()` and `restore()` on `ExtensionResult` to participate in host-managed state snapshots.

`suspend()` returns a JSON-serializable snapshot of extension state. `restore(state)` receives the exact value returned by the prior `suspend()` call and restores internal state from it.

```typescript
function createCounterExtension(): ExtensionResult {
  let count = 0;

  return {
    increment: {
      params: [],
      fn: () => ++count,
      description: 'Increment counter',
      returnType: 'number',
    },
    suspend: () => ({ count }),
    restore: (state) => {
      const s = state as { count: number };
      count = s.count;
    },
    dispose: () => {
      count = 0;
    },
  };
}
```

Extensions without `suspend` are excluded from state snapshots. Extensions without `restore` are skipped during restore.

## Package Structure

Extensions follow this layout:

```
my-extension/
├── src/
│   ├── index.ts        # Public exports
│   ├── types.ts         # Type definitions
│   └── factory.ts       # Factory function
├── tests/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### package.json

```json
{
  "name": "@rcrsr/rill-ext-my-extension",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@rcrsr/rill": "workspace:^"
  },
  "devDependencies": {
    "@rcrsr/rill": "workspace:^"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Key conventions:
- Declare `@rcrsr/rill` as a `peerDependency` (not `dependency`)
- Package name follows `@rcrsr/rill-ext-{name}` pattern
- ESM-only (`"type": "module"`)

### tsconfig.json

```json
{
  "extends": "../tsconfig.ext.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "references": [{ "path": "../../core" }],
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

## Writing an Extension

### 1. Validate Configuration Eagerly

Throw errors synchronously in the factory — not during function execution:

```typescript
function createMyExtension(config: MyConfig): ExtensionResult {
  // Validate at creation time
  if (!config.apiKey) {
    throw new Error('apiKey is required');
  }

  // Binary/tool existence check
  try {
    which.sync(config.binaryPath ?? 'mytool');
  } catch {
    throw new Error(`Binary not found: ${config.binaryPath}`);
  }

  return { /* functions */ };
}
```

### 2. Validate Function Arguments

Use rill's parameter type system for automatic validation:

```typescript
return {
  send: {
    params: [
      { name: 'message', type: 'string' },
      { name: 'options', type: 'dict', defaultValue: {} },
    ],
    fn: async (args) => {
      const message = args[0] as string;
      // Runtime guarantees message is a string
      // Additional domain validation here
      if (message.trim().length === 0) {
        throw new RuntimeError('RILL-R004', 'message cannot be empty');
      }
      return await doSend(message);
    },
    description: 'Send a message',
    returnType: 'dict',
  },
};
```

### 3. Emit Events for Observability

Emit events on success and failure for each operation:

```typescript
fn: async (args, ctx) => {
  const start = Date.now();
  try {
    const result = await operation(args[0]);
    emitExtensionEvent(ctx, {
      event: 'my-ext:send',
      subsystem: 'extension:my-ext',
      duration: Date.now() - start,
    });
    return result;
  } catch (error) {
    emitExtensionEvent(ctx, {
      event: 'my-ext:error',
      subsystem: 'extension:my-ext',
      error: error instanceof Error ? error.message : 'Unknown',
      duration: Date.now() - start,
    });
    throw error;
  }
},
```

### 4. Track Resources for Cleanup

When spawning processes or opening connections, track them for `dispose()`:

```typescript
function createMyExtension(): ExtensionResult {
  const activeProcesses = new Set<() => void>();

  return {
    run: {
      params: [{ name: 'cmd', type: 'string' }],
      fn: async (args) => {
        const proc = spawn(args[0]);
        const cleanup = () => proc.kill();
        activeProcesses.add(cleanup);

        try {
          const result = await proc.exitCode;
          return result;
        } finally {
          activeProcesses.delete(cleanup);
          cleanup();
        }
      },
      description: 'Run command',
      returnType: 'string',
    },
    dispose: () => {
      for (const cleanup of activeProcesses) {
        try { cleanup(); } catch { /* log warning */ }
      }
      activeProcesses.clear();
    },
  };
}
```

### 5. Map SDK Errors to RuntimeError

Extensions that wrap third-party SDKs map errors to `RuntimeError` with consistent messages:

```typescript
function mapSDKError(error: unknown, namespace: string): RuntimeError {
  if (error instanceof Error) {
    const message = error.message;

    // HTTP 401 authentication failure
    if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
      return new RuntimeError('RILL-R004', `${namespace}: authentication failed (401)`);
    }

    // Rate limit (429)
    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      return new RuntimeError('RILL-R004', `${namespace}: rate limit exceeded`);
    }

    // Timeout/AbortError
    if (error.name === 'AbortError' || message.toLowerCase().includes('timeout')) {
      return new RuntimeError('RILL-R004', `${namespace}: request timeout`);
    }

    // Generic error with SDK message
    return new RuntimeError('RILL-R004', `${namespace}: ${message}`);
  }

  return new RuntimeError('RILL-R004', `${namespace}: unknown error`);
}

// Use in host function implementation
fn: async (args, ctx) => {
  try {
    const result = await sdkClient.operation(args[0]);
    return result;
  } catch (error) {
    const rillError = mapSDKError(error, 'myext');
    emitExtensionEvent(ctx, {
      event: 'myext:error',
      subsystem: 'extension:myext',
      error: rillError.message,
    });
    throw rillError;
  }
},
```

**Examples:** The qdrant, pinecone, and chroma extensions in [rill-ext](https://github.com/rcrsr/rill-ext) show this pattern for vector database operations. Each maps SDK-specific errors (collection not found, dimension mismatch, authentication) to consistent `RuntimeError` messages with namespace prefixes.


## API Reference

### Core Exports

```typescript
// Extension types
export type { ExtensionResult, ExtensionFactory, ExtensionEvent, HoistedExtension, ExtensionManifest, ExtensionConfigSchema };

// Extension utilities
export { prefixFunctions, hoistExtension, emitExtensionEvent };
```

## See Also

| Document | Description |
|----------|-------------|
| [Bundled Extensions](bundled-extensions.md) | Pre-built extensions shipped with rill |
| [Host Integration](integration-host.md) | Embedding API |
| [Modules](integration-modules.md) | Module convention |
| [Reference](ref-language.md) | Language specification |
