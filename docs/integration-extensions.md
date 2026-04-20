# Developing Extensions

*Writing reusable host function packages distributed as npm modules*

## Quick Start

Create a simple extension with a factory function:

```typescript
import { toCallable, createRuntimeContext } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createGreetExtension(config: { prefix: string }): ExtensionFactoryResult {
  return {
    value: {
      greet: toCallable({
        params: [{ name: 'name', type: { kind: 'string' } }],
        fn: async (args) => `${config.prefix} ${args.name}!`,
        annotations: { description: 'Generate greeting' },
        returnType: { kind: 'string' },
      }),
    },
  };
}

const ext = createGreetExtension({ prefix: 'Hello' });
const ctx = createRuntimeContext({
  variables: { app: ext.value },
});

// Script: app.greet("World")
```

## Extension Contract

Every extension exports a factory function returning `ExtensionFactoryResult`:

```typescript
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(config: MyConfig): ExtensionFactoryResult {
  // Validate config eagerly (throw on invalid)
  // Return value dict with callables and optional lifecycle hooks
  return {
    value: {
      greet: toCallable({
        params: [{ name: 'name', type: { kind: 'string' } }],
        fn: async (args) => `Hello, ${args.name}!`,
        annotations: { description: 'Generate greeting' },
        returnType: { kind: 'string' },
      }),
      version: '1.0.0',  // scalar string leaf
    },
    dispose: () => {
      // Cleanup resources (connections, processes, etc.)
    },
  };
}
```

### ExtensionFactoryResult Type

```typescript
interface ExtensionFactoryResult {
  readonly value: RillValue;          // the extension's data and functions
  dispose?: () => void | Promise<void>;
  suspend?: () => unknown;
  restore?: (state: unknown) => void;
}
```

`value` is the `RillValue` mounted into the script namespace. Callable leaves use `toCallable()`. Non-callable leaves (strings, numbers, dicts) mount as plain data.

Lifecycle hooks (`dispose`, `suspend`, `restore`) live on the factory result object, not inside `value`.

### ExtensionFactory Type

The factory signature accepts an optional second argument (`ExtensionFactoryCtx`) for async factories that need to register error codes or observe the dispose signal:

```typescript
type ExtensionFactory<TConfig> = (
  config: TConfig,
  ctx: ExtensionFactoryCtx
) => ExtensionFactoryResult | Promise<ExtensionFactoryResult>;
```

Factory functions accept typed configuration and return an isolated extension instance.

## Registering Domain Error Codes

Extensions register domain-specific error atoms using `ctx.registerErrorCode` in the factory. Registered atoms become available as `#NAME` literals in scripts.

```typescript
async function createPaymentExtension(
  config: PaymentConfig,
  ctx: ExtensionFactoryCtx
): Promise<ExtensionFactoryResult> {
  ctx.registerErrorCode('PAYMENT_FAILED', 'domain');
  ctx.registerErrorCode('CARD_DECLINED', 'domain');

  return { value: { charge: toCallable({ /* ... */ }) } };
}
```

The second argument to `registerErrorCode` is the atom kind (`'domain'`, `'network'`, etc.). Kind is informational; scripts use the atom name only.

Scripts access registered atoms by name:

```text
guard { app.charge(dict[amount: 100]) } => $result
$result.! -> ($ == #CARD_DECLINED) ? "Try another card" ! error "Payment error: {$result.!}"
```

See [Error Reference](ref-errors.md) for pre-registered atoms. Atoms registered by the runtime itself (e.g. `#TIMEOUT`, `#AUTH`) do not need re-registration.

---

## Returning Invalid Values

Use `ctx.invalidate` to return an invalid value instead of throwing. Invalid values propagate through pipes until the script tests them with `.?` or `.!`.

```typescript
fn: async (args, ctx) => {
  try {
    return await sdkClient.charge(args.amount as number);
  } catch (e) {
    if (e instanceof CardDeclinedError) {
      return ctx.invalidate(e, { code: 'CARD_DECLINED', provider: 'payment' });
    }
    throw e; // re-throw unexpected errors
  }
},
```

Use `ctx.catch` for a declarative alternative:

```typescript
fn: async (args, ctx) => {
  return ctx.catch(
    () => sdkClient.charge(args.amount as number),
    (e) => {
      if (e instanceof CardDeclinedError) return { code: 'CARD_DECLINED', provider: 'payment' };
      if (e instanceof TimeoutError) return { code: 'TIMEOUT', provider: 'payment' };
      return null; // unclassified errors become #R999
    }
  );
},
```

Both approaches produce an invalid value the script can recover from without halting.

---

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
| `factory` | `ExtensionFactory<any>` | Yes | Called with config object; must return `ExtensionFactoryResult` |
| `configSchema` | `ExtensionConfigSchema` | No | Maps field names to `ConfigFieldDescriptor` entries |
| `version` | `string` | No | Semver string (e.g., `"1.2.0"`); informational only |

`ExtensionConfigSchema` is `Record<string, ConfigFieldDescriptor>`. Each `ConfigFieldDescriptor` has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'boolean'` | Yes | Expected type for the config value |
| `required` | `boolean` | No | Whether the field must appear in config |
| `secret` | `boolean` | No | Advisory flag; tooling may mask or omit the value |

### Manifest Contract

To publish a conforming manifest:

1. Export a named `extensionManifest` from the package's main entry point.
2. If the factory accepts config, declare all fields in `configSchema` with their types and `required` flags.
3. The factory receives only the config object; it must not call rill runtime APIs during construction.
4. Validation errors must throw synchronously from the factory, not during function execution.

### Relationship to ExtensionFactoryResult and ExtensionFactory

`ExtensionManifest` wraps the existing `ExtensionFactory` type. The `factory` field is the same function you write for manual integration. The manifest adds `configSchema` and `version` so that `rill-run` can mount the extension without host-side wiring code. The mount path in `rill-config.json` determines the namespace scripts use to access extension functions.

See [rill-run Config](ref-config.md) for how `extensions.mounts` entries reference manifest packages.

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
  variables: { myExt: ext.value },
});
```

## Lifecycle Management

Extensions that manage external resources (processes, connections, timers) must implement `dispose()`.

`dispose`, `suspend`, and `restore` live on the `ExtensionFactoryResult` object, not inside the `value` dict:

```typescript
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createPooledExtension(config: PoolConfig): ExtensionFactoryResult {
  const pool = createConnectionPool(config);

  return {
    value: {
      query: toCallable({
        params: [{ name: 'sql', type: { kind: 'string' } }],
        fn: async (args) => pool.query(args.sql),
        annotations: { description: 'Execute SQL query' },
        returnType: { kind: 'any' },
      }),
    },
    dispose: () => {
      pool.close();
    },
  };
}

// Usage
const ext = createPooledExtension({ maxConnections: 10 });
const ctx = createRuntimeContext({ variables: { db: ext.value } });

try {
  const result = await execute(ast, ctx);
} finally {
  await ext.dispose?.();
}
```

### Dispose Guidelines

- `dispose()` may be sync or async.
- Must be idempotent (safe to call multiple times).
- Should not throw; log warnings for cleanup failures.
- Always call `dispose()` in a `finally` block.
- `ctx.signal` in the factory fires when the runtime disposes before factory completion. Pass it to long-running setup operations.

The top-level `dispose()` function from `@rcrsr/rill` shuts down the runtime and fires abort signals to all in-flight calls. See [Host API Reference](ref-host-api.md#dispose-lifecycle) for contract details.

## State Persistence

Extensions that hold in-memory state implement `suspend()` and `restore()` on `ExtensionFactoryResult` to participate in host-managed state snapshots.

`suspend()` returns a JSON-serializable snapshot. `restore(state)` receives the exact value returned by the prior `suspend()` call and restores internal state from it.

```typescript
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createCounterExtension(): ExtensionFactoryResult {
  // Mutable shared reference — all callables close over this object
  const state = { count: 0 };

  return {
    value: {
      increment: toCallable({
        params: [],
        fn: () => ++state.count,
        annotations: { description: 'Increment counter' },
        returnType: { kind: 'number' },
      }),
    },
    suspend: () => ({ count: state.count }),
    restore: (snapshot) => {
      const s = snapshot as { count: number };
      state.count = s.count;
    },
    dispose: () => {
      state.count = 0;
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

Throw errors synchronously in the factory, not during function execution:

```typescript
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(config: MyConfig): ExtensionFactoryResult {
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

  return { value: { /* callables */ } };
}
```

### 2. Validate Function Arguments

Use rill's parameter type system for automatic validation:

```typescript
import { toCallable } from '@rcrsr/rill';

return {
  value: {
    send: toCallable({
      params: [
        { name: 'message', type: { kind: 'string' } },
        { name: 'options', type: { kind: 'dict' }, defaultValue: {} },
      ],
      fn: async (args) => {
        const message = args.message as string;
        // Runtime guarantees message is a string
        // Additional domain validation here
        if (message.trim().length === 0) {
          throw new RuntimeError('RILL-R004', 'message cannot be empty');
        }
        return await doSend(message);
      },
      annotations: { description: 'Send a message' },
      returnType: { kind: 'dict' },
    }),
  },
};
```

### 3. Emit Events for Observability

Emit events on success and failure for each operation:

```typescript
fn: async (args, ctx) => {
  const start = Date.now();
  try {
    const result = await operation(args.input);
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
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(): ExtensionFactoryResult {
  const activeProcesses = new Set<() => void>();

  return {
    value: {
      run: toCallable({
        params: [{ name: 'cmd', type: { kind: 'string' } }],
        fn: async (args) => {
          const proc = spawn(args.cmd);
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
        annotations: { description: 'Run command' },
        returnType: { kind: 'string' },
      }),
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
    const result = await sdkClient.operation(args.input);
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

## Testing Extensions

Use `createTestContext` to wire extensions for testing without config infrastructure:

```typescript
import { createTestContext, toCallable, execute, parse } from '@rcrsr/rill';

const context = createTestContext({
  myExt: {
    value: {
      greet: toCallable({
        fn: (args) => `Hello, ${args.name}!`,
        params: [{ name: 'name', type: { kind: 'string' } }],
        returnType: { kind: 'string' },
        annotations: {}
      })
    }
  }
});

const result = await execute(parse('myExt.greet("World")'), context);
// result.result === "Hello, World!"
```

---

## Migration: ExtensionResult to ExtensionFactoryResult

v0.17.0 introduces a breaking change to the extension factory return type. `ExtensionResult` is replaced by `ExtensionFactoryResult`. The `hoistExtension` and `prefixFunctions` utilities are removed. Sub-dict organization replaces the `namespace::fn` flat function pattern.

### Before and After

**Before (v0.16.x):**

```typescript
import type { ExtensionResult } from '@rcrsr/rill';
import { hoistExtension, prefixFunctions } from '@rcrsr/rill';

function createMyExtension(config: MyConfig): ExtensionResult {
  return {
    greet: {
      params: [{ name: 'name', type: { kind: 'string' } }],
      fn: async (args) => `Hello, ${args.name}!`,
      annotations: { description: 'Generate greeting' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    dispose: () => cleanup(),
  };
}

const ext = createMyExtension(config);
const { functions, dispose } = hoistExtension('app', ext);
const ctx = createRuntimeContext({ functions });
// Script: app::greet("World")
```

**After (v0.17.0):**

```typescript
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(config: MyConfig): ExtensionFactoryResult {
  return {
    value: {
      greet: toCallable({
        params: [{ name: 'name', type: { kind: 'string' } }],
        fn: async (args) => `Hello, ${args.name}!`,
        annotations: { description: 'Generate greeting' },
        returnType: { kind: 'string' },
      }),
    },
    dispose: () => cleanup(),
  };
}

const ext = createMyExtension(config);
const ctx = createRuntimeContext({ variables: { app: ext.value } });
// Script: app.greet("World")
```

---

### Migration Steps

**Step 1: Replace `ExtensionResult` return type with `ExtensionFactoryResult`**

```typescript
// Before
function createMyExt(config): ExtensionResult { ... }

// After
function createMyExt(config): ExtensionFactoryResult { ... }
```

**Step 2: Wrap each `RillFunction` definition with `toCallable()`**

```typescript
// Before
return {
  greet: { params, fn, annotations, returnType },
  dispose: () => cleanup(),
};

// After
return {
  value: {
    greet: toCallable({ params, fn, annotations, returnType }),
  },
  dispose: () => cleanup(),
};
```

Move `dispose`, `suspend`, and `restore` to the outer result object. Remove them from inside the `value` dict.

**Step 3: Replace `hoistExtension` / `prefixFunctions` with `variables`**

```typescript
// Before
const { functions, dispose } = hoistExtension('app', ext);
const ctx = createRuntimeContext({ functions });

// After
const ctx = createRuntimeContext({ variables: { app: ext.value } });
await ext.dispose?.();
```

**Step 4: Update script call syntax from `namespace::fn()` to `namespace.fn()`**

```text
// Before
app::greet("World")

// After
app.greet("World")
```

**Step 5: Update import statements**

```typescript
// Remove these imports
import type { ExtensionResult } from '@rcrsr/rill';
import { hoistExtension, prefixFunctions } from '@rcrsr/rill';

// Add these imports
import { toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';
```

---

## API Reference

### Core Exports

```typescript
// Extension types
export type { ExtensionFactoryResult, ExtensionFactory, ExtensionEvent, ExtensionManifest, ExtensionConfigSchema };

// Extension utilities
export { toCallable, createTestContext, emitExtensionEvent };
```

## See Also

| Document | Description |
|----------|-------------|
| [Bundled Extensions](bundled-extensions.md) | Pre-built extensions shipped with rill |
| [Host Integration](integration-host.md) | Embedding API |
| [Modules](integration-modules.md) | Module convention |
| [Reference](ref-language.md) | Language specification |
