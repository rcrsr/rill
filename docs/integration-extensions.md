# Developing Extensions

*Writing reusable host function packages distributed as npm modules*

## Quick Start

Create a simple extension with a factory function:

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
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
const functions = prefixFunctions('app', ext);
const ctx = createRuntimeContext({ functions });

// Script: app::greet("World")
```

## Extension Contract

Every extension exports a factory function returning `ExtensionResult`:

```typescript
import type { ExtensionResult, HostFunctionDefinition } from '@rcrsr/rill';

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
type ExtensionResult = Record<string, HostFunctionDefinition> & {
  dispose?: () => void | Promise<void>;
};
```

Each key (except `dispose`) maps a function name to a `HostFunctionDefinition`. The runtime registers these as callable host functions.

### ExtensionFactory Type

```typescript
type ExtensionFactory<TConfig> = (config: TConfig) => ExtensionResult;
```

Factory functions accept typed configuration and return an isolated extension instance.

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
- Alphanumeric characters and hyphens only (`/^[a-zA-Z0-9-]+$/`)
- Invalid namespaces throw `RuntimeError` with code `RUNTIME_TYPE_ERROR`

### Behavior

- Prefixes every key except `dispose` with `namespace::`
- Preserves the `dispose` method on the returned object
- Returns a new `ExtensionResult` (does not mutate the original)

## Extension Events

Extensions emit structured diagnostic events through `emitExtensionEvent()`:

```typescript
import { emitExtensionEvent, type RuntimeContext } from '@rcrsr/rill';

function myFunction(args: RillValue[], ctx: RuntimeContext) {
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
const ctx = createRuntimeContext({
  functions: prefixFunctions('db', ext),
});

try {
  const result = await execute(ast, ctx);
} finally {
  ext.dispose?.();
}
```

### Dispose Guidelines

- `dispose()` may be sync or async
- Must be idempotent (safe to call multiple times)
- Should not throw — log warnings for cleanup failures
- Always call `dispose()` in a `finally` block

## Package Structure

Extensions follow this layout:

```
packages/ext/my-extension/
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
    emitExtensionEvent(ctx as RuntimeContext, {
      event: 'my-ext:send',
      subsystem: 'extension:my-ext',
      duration: Date.now() - start,
    });
    return result;
  } catch (error) {
    emitExtensionEvent(ctx as RuntimeContext, {
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


## API Reference

### Core Exports

```typescript
// Extension types
export type { ExtensionResult, ExtensionFactory, ExtensionEvent };

// Extension utilities
export { prefixFunctions, emitExtensionEvent };
```

## See Also

- [Bundled Extensions](bundled-extensions.md) — Pre-built extensions shipped with rill
- [Host Integration](integration-host.md) — Embedding API
- [Modules](integration-modules.md) — Module convention
- [Reference](ref-language.md) — Language specification
