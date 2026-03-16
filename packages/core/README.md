# @rcrsr/rill

Core runtime for [rill](https://rill.run) — scripting designed for machine-generated code. Zero dependencies. Browser and Node.js compatible.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill
```

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, toCallable } from '@rcrsr/rill';
import type { ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(): ExtensionFactoryResult {
  return {
    value: {
      prompt: toCallable({
        params: [{ name: 'message', type: { kind: 'string' } }],
        fn: async (args) => await callYourLLM(args.message),
        annotations: { description: 'Call your LLM' },
        returnType: { kind: 'string' },
      }),
    },
  };
}

const ext = createMyExtension();
const ctx = createRuntimeContext({
  variables: { app: ext.value },
});

const script = `
  app.prompt("Analyze this code for issues")
    -> .contains("ERROR") ? error($) ! "Analysis complete"
`;

const result = await execute(parse(script), ctx);
console.log(result.result);
```

## API

### Core Pipeline

```
Source Text → parse() → AST → execute() → Result
```

| Export | Purpose |
|--------|---------|
| `parse(source)` | Parse rill source into an AST |
| `execute(ast, ctx)` | Execute an AST with a runtime context |
| `createRuntimeContext(opts)` | Create a configured runtime context |
| `callable(fn, isProperty?)` | Wrap a function as a rill-callable value |
| `toCallable(def)` | Convert a `RillFunction` to an `ApplicationCallable` |
| `createTestContext(extensions)` | Wire extensions for testing without config infrastructure |

### Runtime Options

```typescript
const ext = createMyExtension();

const ctx = createRuntimeContext({
  // Extension values injected as variables (recommended)
  variables: {
    app: ext.value,
    config: { greeting: 'hello' },
  },

  // Legacy: direct function registration (still supported)
  functions: {
    prompt: {
      params: [{ name: 'text', type: { kind: 'string' } }],
      fn: async (args, ctx, location) => { /* ... */ },
      annotations: {},
      returnType: { kind: 'string' },
    },
  },

  // Callbacks
  callbacks: {
    onLog: (value) => console.log(value),
  },

  // Observability hooks
  observability: {
    onStepStart: (e) => { /* ... */ },
    onStepEnd: (e) => { /* ... */ },
  },

  // Execution limits
  timeout: 30000,
  signal: abortController.signal,
});
```

### Stepper API

Step through execution one statement at a time:

```typescript
import { parse, createRuntimeContext, createStepper } from '@rcrsr/rill';

const stepper = createStepper(parse(script), createRuntimeContext());

let step;
while (!(step = await stepper.next()).done) {
  console.log(step.value);
}
```

### Additional Exports

| Export | Purpose |
|--------|---------|
| `parseWithRecovery(source)` | Parse with error recovery (for editors) |
| `tokenize(source)` | Tokenize source into a token stream |
| `TOKEN_HIGHLIGHT_MAP` | Syntax highlighting category map |
| `getLanguageReference()` | LLM-optimized language reference text |
| `getDocumentationCoverage()` | Coverage stats for doc examples |
| `getFunctions()` | List of built-in function metadata |
| `VERSION` / `VERSION_INFO` | Runtime version string and metadata |

### Error Handling

```typescript
import { parse, execute, createRuntimeContext, AbortError } from '@rcrsr/rill';

try {
  const result = await execute(parse(script), ctx);
} catch (err) {
  if (err instanceof AbortError) {
    // Execution was cancelled via signal
  }
  // Runtime errors include source location and error code
}
```

### Type Guards

| Export | Purpose |
|--------|---------|
| `isDict(value)` | Check if value is a rill dict |
| `isTuple(value)` | Check if value is a rill tuple |
| `isCallable(value)` | Check if value is any callable |
| `isScriptCallable(value)` | Check if value is a script-defined closure |
| `isApplicationCallable(value)` | Check if value is a host-provided callable |

## Bundled Extensions

rill ships with 5 Node.js-only extensions available as sub-path imports. These extensions provide pre-built host functions for common tasks and are not available in the browser bundle.

### Import Pattern

```typescript
import { createFsExtension } from '@rcrsr/rill/ext/fs';
import { createFetchExtension } from '@rcrsr/rill/ext/fetch';
import { createExecExtension } from '@rcrsr/rill/ext/exec';
import { createKvExtension } from '@rcrsr/rill/ext/kv';
import { createCryptoExtension } from '@rcrsr/rill/ext/crypto';
```

### Available Extensions

| Sub-Path | Factory | Description |
|----------|---------|-------------|
| `@rcrsr/rill/ext/fs` | `createFsExtension(config)` | Sandboxed filesystem operations via mount-based access control |
| `@rcrsr/rill/ext/fetch` | `createFetchExtension(config)` | HTTP requests with endpoint configuration and rate limiting |
| `@rcrsr/rill/ext/exec` | `createExecExtension(config)` | Sandboxed command execution via allowlist/blocklist controls |
| `@rcrsr/rill/ext/kv` | `createKvExtension(config)` | Key-value store with JSON persistence and schema validation |
| `@rcrsr/rill/ext/crypto` | `createCryptoExtension(config)` | Cryptographic functions (hash, hmac, uuid, random) |

Each factory returns an `ExtensionFactoryResult` with a `value` dict of host functions and optional lifecycle hooks (`dispose`, `suspend`, `restore`) ready to integrate into your runtime context.

> **Note:** These extensions require Node.js APIs and are not compatible with browser environments.

## Documentation

| Document | Description |
|----------|-------------|
| [Host Integration](https://github.com/rcrsr/rill/blob/main/docs/integration-host.md) | Embedding guide |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Complete TypeScript API |
| [Language Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-language.md) | Language specification |
| [Extensions](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Reusable host function packages |

## License

MIT
