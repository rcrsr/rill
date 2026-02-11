# @rcrsr/rill

Core runtime for [rill](https://rill.run) — scripting designed for machine-generated code. Zero dependencies. Browser and Node.js compatible.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill
```

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const script = `
  prompt("Analyze this code for issues")
    -> .contains("ERROR") ? error($) ! "Analysis complete"
`;

const ctx = createRuntimeContext({
  functions: {
    prompt: {
      params: [{ name: 'message', type: 'string' }],
      fn: async (args) => await callYourLLM(args[0]),
    },
  },
});

const result = await execute(parse(script), ctx);
console.log(result.value);
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
| `prefixFunctions(prefix, fns)` | Namespace host functions (e.g., `app::`) |

### Runtime Options

```typescript
const ctx = createRuntimeContext({
  // Host functions available to scripts
  functions: {
    prompt: {
      params: [{ name: 'text', type: 'string' }],
      fn: async (args, ctx, location) => { /* ... */ },
    },
  },

  // Variables injected into script scope
  variables: {
    config: { greeting: 'hello' },
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

Each factory returns an `ExtensionResult` with host function definitions ready to integrate into your runtime context.

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
