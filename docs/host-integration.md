# Host Integration Guide

This guide covers embedding Rill in host applications. Rill is a vanilla language—all domain-specific functionality must be provided by the host.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const source = `
  "Hello, World!" -> prompt() -> $response
  $response
`;

const ast = parse(source);
const ctx = createRuntimeContext({
  functions: {
    prompt: async (args) => {
      const text = String(args[0]);
      return await callYourLLM(text);
    },
  },
});

const result = await execute(ast, ctx);
console.log(result.value);
```

## RuntimeOptions

The `createRuntimeContext()` function accepts these options:

| Option | Type | Description |
|--------|------|-------------|
| `variables` | `Record<string, RillValue>` | Initial variables accessible as `$name` |
| `functions` | `Record<string, CallableFn>` | Custom functions callable as `name()` |
| `callbacks` | `Partial<RuntimeCallbacks>` | I/O callbacks (e.g., `onLog`) |
| `observability` | `ObservabilityCallbacks` | Execution monitoring hooks |
| `timeout` | `number` | Timeout in ms for async functions |
| `autoExceptions` | `string[]` | Regex patterns that halt execution |
| `signal` | `AbortSignal` | Cancellation signal |

## Host Function Contract

Host functions must follow these rules to ensure correct script behavior:

### Immutability

**Host functions must not mutate input arguments.** rill values are immutable by design—modifying arguments breaks value semantics and causes unpredictable behavior.

```typescript
// WRONG: Mutates input array
functions: {
  addItem: (args) => {
    const list = args[0] as unknown[];
    list.push('new');  // DON'T DO THIS
    return list;
  },
}

// CORRECT: Return new value
functions: {
  addItem: (args) => {
    const list = args[0] as unknown[];
    return [...list, 'new'];  // Create new array
  },
}
```

### Defensive Copies

For maximum safety, consider freezing values passed to host functions:

```typescript
import { deepFreeze } from './utils'; // Your utility

functions: {
  process: (args) => {
    const frozen = deepFreeze(args[0]);
    return transform(frozen);  // Any mutation throws
  },
}
```

### Return Values

- Return new values instead of modifying inputs
- Return `RillValue` types (string, number, boolean, array, object, or `RillCallable`)
- Avoid returning `null` or `undefined`—use empty string `''` or empty array `[]` instead

## Custom Functions

Functions are called by name: `functionName(arg1, arg2)`.

```typescript
const ctx = createRuntimeContext({
  functions: {
    // Sync function
    add: (args) => {
      const a = typeof args[0] === 'number' ? args[0] : 0;
      const b = typeof args[1] === 'number' ? args[1] : 0;
      return a + b;
    },

    // Async function
    fetch: async (args, ctx, location) => {
      const url = String(args[0]);
      const response = await fetch(url);
      return await response.text();
    },

    // Function with context access
    getVar: (args, ctx) => {
      const name = String(args[0]);
      return ctx.variables.get(name) ?? null;
    },

    // Function with location for error reporting
    validate: (args, ctx, location) => {
      if (!args[0]) {
        throw new Error(`Validation failed at line ${location?.line}`);
      }
      return args[0];
    },
  },
});
```

### Namespaced Functions

Use `::` to organize functions into namespaces:

```typescript
const ctx = createRuntimeContext({
  functions: {
    // Namespaced functions use :: separator
    'math::add': (args) => (args[0] as number) + (args[1] as number),
    'math::multiply': (args) => (args[0] as number) * (args[1] as number),
    'str::upper': (args) => String(args[0]).toUpperCase(),
    'str::lower': (args) => String(args[0]).toLowerCase(),

    // Multi-level namespaces
    'io::file::read': async (args) => fs.readFile(String(args[0]), 'utf-8'),
    'io::file::write': async (args) => fs.writeFile(String(args[0]), String(args[1])),
  },
});
```

Scripts call namespaced functions with the same syntax:

```text
math::add(1, 2)           # 3
"hello" -> str::upper     # "HELLO"
io::file::read("config.json") -> parse_json
```

Namespaces help organize host APIs and avoid name collisions without requiring the `$` variable prefix.
```

### CallableFn Signature

```typescript
type CallableFn = (
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;
```

| Parameter | Description |
|-----------|-------------|
| `args` | Positional arguments passed to the function |
| `ctx` | Runtime context with variables, pipeValue, etc. |
| `location` | Source location of the call site (for error reporting) |

## Application Callables

Hosts can create first-class callable values that scripts can store, pass, and invoke.

```typescript
import { callable, isCallable, isApplicationCallable } from '@rcrsr/rill';

// Create a callable
const greet = callable((args) => `Hello, ${args[0]}!`);

// Use in variables
const ctx = createRuntimeContext({
  variables: {
    greet: greet,
  },
});

// Script can invoke: $greet("World") -> "Hello, World!"
```

### callable() Function

```typescript
function callable(fn: CallableFn, isProperty?: boolean): ApplicationCallable;
```

| Parameter | Description |
|-----------|-------------|
| `fn` | The function to wrap |
| `isProperty` | If `true`, auto-invokes when accessed from dict |

### Property-Style Callables

Property-style callables auto-invoke when accessed from a dict, enabling computed properties:

```typescript
const ctx = createRuntimeContext({
  variables: {
    user: {
      firstName: 'John',
      lastName: 'Doe',
      // Auto-invokes on access, receives bound dict
      fullName: callable((args) => {
        const dict = args[0] as Record<string, RillValue>;
        return `${dict.firstName} ${dict.lastName}`;
      }, true),
    },
  },
});

// Script: $user.fullName -> "John Doe"
```

### Dict Callables

Callables stored in dicts can be invoked using method syntax:

```typescript
const ctx = createRuntimeContext({
  variables: {
    math: {
      add: callable((args) => {
        const a = typeof args[0] === 'number' ? args[0] : 0;
        const b = typeof args[1] === 'number' ? args[1] : 0;
        return a + b;
      }),
    },
  },
});

// Script: $math.add(1, 2) -> 3
```

### Callable Kinds

| Kind | Type | Description |
|------|------|-------------|
| `script` | `ScriptCallable` | Closures from Rill source code |
| `runtime` | `RuntimeCallable` | Rill's built-in functions |
| `application` | `ApplicationCallable` | Host-provided callables |

### Type Guards

```typescript
import {
  isCallable,
  isScriptCallable,
  isRuntimeCallable,
  isApplicationCallable,
} from '@rcrsr/rill';

if (isCallable(value)) {
  // value is RillCallable (any callable)
}

if (isApplicationCallable(value)) {
  // value is ApplicationCallable (host-provided)
}

if (isScriptCallable(value)) {
  // value is ScriptCallable (from Rill source)
}
```

## Cancellation

Use `AbortSignal` to cancel long-running scripts:

```typescript
const controller = new AbortController();

const ctx = createRuntimeContext({
  signal: controller.signal,
  functions: {
    longTask: async () => {
      await new Promise((r) => setTimeout(r, 10000));
      return 'done';
    },
  },
});

// Cancel after 1 second
setTimeout(() => controller.abort(), 1000);

try {
  await execute(ast, ctx);
} catch (err) {
  if (err instanceof AbortError) {
    console.log('Execution cancelled');
  }
}
```

### AbortError

```typescript
import { AbortError } from '@rcrsr/rill';

try {
  await execute(ast, ctx);
} catch (err) {
  if (err instanceof AbortError) {
    console.log(err.code);    // 'RUNTIME_ABORTED'
    console.log(err.message); // 'Execution aborted'
  }
}
```

Abort is checked at:
- Before each statement
- Before each function call
- Before each loop iteration
- In the stepper's `step()` method

## Observability

Monitor execution with observability callbacks:

```typescript
const ctx = createRuntimeContext({
  observability: {
    onStepStart: (event) => {
      console.log(`Step ${event.index + 1}/${event.total}`);
    },
    onStepEnd: (event) => {
      console.log(`Completed in ${event.durationMs}ms`);
    },
    onFunctionCall: (event) => {
      console.log(`Calling ${event.name}(${event.args.join(', ')})`);
    },
    onFunctionReturn: (event) => {
      console.log(`${event.name} returned: ${event.value}`);
    },
    onCapture: (event) => {
      console.log(`Captured $${event.name} = ${event.value}`);
    },
    onError: (event) => {
      console.error(`Error at step ${event.index}:`, event.error);
    },
  },
});
```

### Event Types

```typescript
interface StepStartEvent {
  index: number;      // Statement index (0-based)
  total: number;      // Total statements
  pipeValue: RillValue;
}

interface StepEndEvent {
  index: number;
  total: number;
  value: RillValue;
  durationMs: number;
}

interface FunctionCallEvent {
  name: string;
  args: RillValue[];
}

interface FunctionReturnEvent {
  name: string;
  value: RillValue;
  durationMs: number;
}

interface CaptureEvent {
  name: string;
  value: RillValue;
}

interface ErrorEvent {
  error: Error;
  index?: number;
}
```

## Step-by-Step Execution

Use the stepper API for controlled execution:

```typescript
import { parse, createRuntimeContext, createStepper } from '@rcrsr/rill';

const ast = parse(source);
const ctx = createRuntimeContext({ ... });
const stepper = createStepper(ast, ctx);

while (!stepper.done) {
  const result = await stepper.step();
  console.log(`Step ${result.index + 1}: ${result.value}`);

  if (result.captured) {
    console.log(`Captured: $${result.captured.name}`);
  }
}

const final = stepper.getResult();
console.log('Final value:', final.value);
console.log('Variables:', final.variables);
```

### ExecutionStepper Interface

```typescript
interface ExecutionStepper {
  readonly done: boolean;
  readonly index: number;
  readonly total: number;
  readonly context: RuntimeContext;
  step(): Promise<StepResult>;
  getResult(): ExecutionResult;
}

interface StepResult {
  value: RillValue;
  done: boolean;
  index: number;
  total: number;
  captured?: { name: string; value: RillValue };
}

interface ExecutionResult {
  value: RillValue;
  variables: Record<string, RillValue>;
}
```

## I/O Callbacks

Handle script I/O through callbacks:

```typescript
const ctx = createRuntimeContext({
  callbacks: {
    onLog: (value) => {
      // Called when script uses .log method
      console.log('[Rill]', value);
    },
  },
});
```

## Timeouts

Set a timeout for async operations:

```typescript
const ctx = createRuntimeContext({
  timeout: 30000, // 30 seconds
  functions: {
    slowOperation: async () => {
      // Will throw TimeoutError if exceeds 30s
      await longRunningTask();
      return 'done';
    },
  },
});
```

## Auto-Exceptions

Halt execution when output matches patterns:

```typescript
const ctx = createRuntimeContext({
  autoExceptions: [
    'error:.*',      // Matches "error: something"
    'FATAL',         // Matches "FATAL" anywhere
  ],
  functions: {
    process: (args) => {
      // If this returns "error: invalid input",
      // execution halts with AutoExceptionError
      return externalProcess(args[0]);
    },
  },
});
```

## Initial Variables

Provide variables accessible in scripts:

```typescript
const ctx = createRuntimeContext({
  variables: {
    config: {
      apiUrl: 'https://api.example.com',
      maxRetries: 3,
    },
    userId: 'user-123',
    items: [1, 2, 3],
  },
});

// Script can access: $config.apiUrl, $userId, $items
```

## Error Handling

All Rill errors extend `RillError` with structured information:

```typescript
import { RuntimeError, ParseError, AbortError, TimeoutError } from '@rcrsr/rill';

try {
  const ast = parse(source);
  const result = await execute(ast, ctx);
} catch (err) {
  if (err instanceof ParseError) {
    console.log('Parse error:', err.message);
    console.log('Location:', err.location);
  } else if (err instanceof RuntimeError) {
    console.log('Runtime error:', err.code);
    console.log('Message:', err.message);
    console.log('Location:', err.location);
    console.log('Context:', err.context);
  } else if (err instanceof AbortError) {
    console.log('Execution cancelled');
  } else if (err instanceof TimeoutError) {
    console.log('Operation timed out');
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `PARSE_UNEXPECTED_TOKEN` | Unexpected token in source |
| `PARSE_INVALID_SYNTAX` | Invalid syntax |
| `PARSE_INVALID_TYPE` | Invalid type annotation |
| `RUNTIME_UNDEFINED_VARIABLE` | Variable not defined |
| `RUNTIME_UNDEFINED_FUNCTION` | Function not defined |
| `RUNTIME_UNDEFINED_METHOD` | Method not defined (built-in only) |
| `RUNTIME_TYPE_ERROR` | Type mismatch |
| `RUNTIME_TIMEOUT` | Operation timed out |
| `RUNTIME_ABORTED` | Execution cancelled |
| `RUNTIME_INVALID_PATTERN` | Invalid regex pattern |
| `RUNTIME_AUTO_EXCEPTION` | Auto-exception triggered |

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
  $config.greeting -> prompt() -> $response
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
    prompt: async (args, ctx, location) => {
      console.log(`[prompt at line ${location?.line}]`);
      return await callLLM(String(args[0]));
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

// Value types
export type { RillValue, RillArgs };

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
```

