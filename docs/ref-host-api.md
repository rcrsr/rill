# rill Host API Reference

*Complete TypeScript API for embedding rill in applications*

## Complete Example

```typescript
import {
  parse,
  execute,
  createRuntimeContext,
  callable,
  AbortError,
  type RillValue,
} from '@rcrsr/rill';

const script = `
  $config.greeting -> prompt() => $response
  $response
`;

const controller = new AbortController();

const ctx = createRuntimeContext({
  variables: {
    config: {
      greeting: 'Say hello in French',
    },
    utils: {
      // Property-style callable (computed property)
      timestamp: callable(() => Date.now(), true),
      // Regular callable
      format: callable((args) => {
        const [template, ...values] = args;
        return String(template).replace(/\{\}/g, () =>
          String(values.shift() ?? '')
        );
      }),
    },
  },

  functions: {
    prompt: {
      params: [{ name: 'text', type: 'string' }],
      fn: async (args, ctx, location) => {
        console.log(`[prompt at line ${location?.line}]`);
        return await callLLM(args[0]);
      },
    },
  },

  callbacks: {
    onLog: (value) => console.log('[log]', value),
  },

  observability: {
    onStepStart: (e) => console.log(`Step ${e.index + 1}...`),
    onStepEnd: (e) => console.log(`Done (${e.durationMs}ms)`),
  },

  timeout: 30000,
  signal: controller.signal,
});

try {
  const ast = parse(script);
  const result = await execute(ast, ctx);
  console.log('Result:', result.value);
  console.log('Variables:', result.variables);
} catch (err) {
  if (err instanceof AbortError) {
    console.log('Cancelled');
  } else {
    throw err;
  }
}
```

## API Reference

### Exports

```typescript
// Parsing
export { parse, ParseError, tokenize, LexerError };

// Execution
export { execute, createRuntimeContext, createStepper };
export type { RuntimeContext, RuntimeOptions, ExecutionResult };
export type { ExecutionStepper, StepResult };

// Callable types
export { callable, isCallable, isScriptCallable, isRuntimeCallable, isApplicationCallable };
export type { RillCallable, ScriptCallable, RuntimeCallable, ApplicationCallable, CallableFn };

// Host function types
export type { HostFunctionDefinition, HostFunctionParam, RillFunctionReturnType };
export { validateHostFunctionArgs };

// Value types
export type { RillValue, RillArgs };

// Introspection
export { getFunctions, getLanguageReference, getDocumentationCoverage };
export type { FunctionMetadata, ParamMetadata, DocumentationCoverageResult };

// Version information
export { VERSION, VERSION_INFO };
export type { VersionInfo };

// Callbacks
export type { RuntimeCallbacks, ObservabilityCallbacks };
export type { StepStartEvent, StepEndEvent, FunctionCallEvent, FunctionReturnEvent };
export type { CaptureEvent, ErrorEvent };

// Errors
export { RillError, RuntimeError, ParseError, AbortError, TimeoutError, AutoExceptionError };
export { RILL_ERROR_CODES };
export type { RillErrorCode };

// Utilities
export { isArgs, isDict, isReservedMethod, RESERVED_DICT_METHODS };
export type { SourceLocation, SourceSpan };

// Control flow (for advanced use)
export { BreakSignal, ReturnSignal };

// Extension contracts
export type { KvExtensionContract, FsExtensionContract, SchemaEntry };
```

## Extension Contracts

### KvExtensionContract

Contract type for key-value extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type KvExtensionContract = {
  readonly get: HostFunctionDefinition;
  readonly get_or: HostFunctionDefinition;
  readonly set: HostFunctionDefinition;
  readonly merge: HostFunctionDefinition;
  readonly delete: HostFunctionDefinition;
  readonly keys: HostFunctionDefinition;
  readonly has: HostFunctionDefinition;
  readonly clear: HostFunctionDefinition;
  readonly getAll: HostFunctionDefinition;
  readonly schema: HostFunctionDefinition;
  readonly mounts: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};
```

**Required Functions (11 total):**

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `get` | `(mount: string, key: string)` | `RillValue` | Retrieve value or schema default |
| `get_or` | `(mount: string, key: string, fallback: RillValue)` | `RillValue` | Retrieve value with fallback |
| `set` | `(mount: string, key: string, value: RillValue)` | `boolean` | Store value with validation |
| `merge` | `(mount: string, key: string, partial: Record<string, RillValue>)` | `boolean` | Merge dict properties |
| `delete` | `(mount: string, key: string)` | `boolean` | Remove key |
| `keys` | `(mount: string)` | `string[]` | List all keys in mount |
| `has` | `(mount: string, key: string)` | `boolean` | Check key existence |
| `clear` | `(mount: string)` | `boolean` | Remove all keys |
| `getAll` | `(mount: string)` | `Record<string, RillValue>` | Retrieve all key-value pairs |
| `schema` | `(mount: string)` | `RillValue[]` | Get mount schema metadata |
| `mounts` | `()` | `RillValue[]` | List all configured mounts |

**Usage:**

```typescript
import type { KvExtensionContract } from '@rcrsr/rill';
import { createMyKvBackend } from './my-kv-backend';

// Type-check backend implementation
const backend: KvExtensionContract = createMyKvBackend({ /* config */ });
```

### FsExtensionContract

Contract type for filesystem extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type FsExtensionContract = {
  readonly read: HostFunctionDefinition;
  readonly write: HostFunctionDefinition;
  readonly append: HostFunctionDefinition;
  readonly list: HostFunctionDefinition;
  readonly find: HostFunctionDefinition;
  readonly exists: HostFunctionDefinition;
  readonly remove: HostFunctionDefinition;
  readonly stat: HostFunctionDefinition;
  readonly mkdir: HostFunctionDefinition;
  readonly copy: HostFunctionDefinition;
  readonly move: HostFunctionDefinition;
  readonly mounts: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};
```

**Required Functions (12 total):**

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `read` | `(mount: string, path: string)` | `string` | Read file content |
| `write` | `(mount: string, path: string, content: string)` | `string` | Write file content |
| `append` | `(mount: string, path: string, content: string)` | `string` | Append to file |
| `list` | `(mount: string, path?: string)` | `RillValue[]` | List directory entries |
| `find` | `(mount: string, pattern?: string)` | `RillValue[]` | Find files by pattern |
| `exists` | `(mount: string, path: string)` | `boolean` | Check file/directory existence |
| `remove` | `(mount: string, path: string)` | `boolean` | Delete file/directory |
| `stat` | `(mount: string, path: string)` | `Record<string, RillValue>` | Get file metadata |
| `mkdir` | `(mount: string, path: string)` | `boolean` | Create directory |
| `copy` | `(mount: string, src: string, dest: string)` | `boolean` | Copy file/directory |
| `move` | `(mount: string, src: string, dest: string)` | `boolean` | Move file/directory |
| `mounts` | `()` | `RillValue[]` | List all configured mounts |

**Usage:**

```typescript
import type { FsExtensionContract } from '@rcrsr/rill';
import { createMyFsBackend } from './my-fs-backend';

// Type-check backend implementation
const backend: FsExtensionContract = createMyFsBackend({ /* config */ });
```

### SchemaEntry

Type for key-value store schema definitions. Used in `KvExtensionContract` backends to define type constraints and defaults.

```typescript
export interface SchemaEntry {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  default: RillValue;
  description?: string;
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'bool' \| 'list' \| 'dict'` | Yes | Value type constraint |
| `default` | `RillValue` | Yes | Default value if key missing |
| `description` | `string` | No | Human-readable description |

**Usage:**

```typescript
import type { SchemaEntry } from '@rcrsr/rill';

const schema: Record<string, SchemaEntry> = {
  name: { type: 'string', default: '', description: 'User name' },
  age: { type: 'number', default: 0, description: 'User age in years' },
  active: { type: 'bool', default: true },
};
```

## See Also

- [Host Integration](integration-host.md) — Embedding guide and runtime configuration
- [Extensions](integration-extensions.md) — Reusable function packages
- [Modules](integration-modules.md) — Module convention
