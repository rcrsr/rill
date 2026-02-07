# rill Host Integration Guide

*Embedding rill in host applications with custom functions and runtime configuration*

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const source = `
  "Hello, World!" -> prompt() => $response
  $response
`;

const ast = parse(source);
const ctx = createRuntimeContext({
  functions: {
    prompt: {
      params: [{ name: 'text', type: 'string' }],
      fn: async (args) => {
        return await callYourLLM(args[0]);
      },
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
| `functions` | `Record<string, HostFunctionDefinition>` | Custom functions callable as `name()` |
| `callbacks` | `Partial<RuntimeCallbacks>` | I/O callbacks (e.g., `onLog`) |
| `observability` | `ObservabilityCallbacks` | Execution monitoring hooks |
| `timeout` | `number` | Timeout in ms for async functions |
| `autoExceptions` | `string[]` | Regex patterns that halt execution |
| `signal` | `AbortSignal` | Cancellation signal |
| `requireDescriptions` | `boolean` | Require descriptions for all functions and parameters |

## Host Function Contract

Host functions must follow these rules to ensure correct script behavior:

### Immutability

**Host functions must not mutate input arguments.** rill values are immutable by design—modifying arguments breaks value semantics and causes unpredictable behavior.

```typescript
// WRONG: Mutates input array
functions: {
  addItem: {
    params: [{ name: 'list', type: 'list' }],
    fn: (args) => {
      const list = args[0] as unknown[];
      list.push('new');  // DON'T DO THIS
      return list;
    },
  },
}

// CORRECT: Return new value
functions: {
  addItem: {
    params: [{ name: 'list', type: 'list' }],
    fn: (args) => {
      const list = args[0] as unknown[];
      return [...list, 'new'];  // Create new array
    },
  },
}
```

### Defensive Copies

For maximum safety, consider freezing values passed to host functions:

```typescript
import { deepFreeze } from './utils'; // Your utility

functions: {
  process: {
    params: [{ name: 'input', type: 'string' }],
    fn: (args) => {
      const frozen = deepFreeze(args[0]);
      return transform(frozen);  // Any mutation throws
    },
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
    add: {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (args) => args[0] + args[1],
    },

    // Async function
    fetch: {
      params: [{ name: 'url', type: 'string' }],
      fn: async (args, ctx, location) => {
        const response = await fetch(args[0]);
        return await response.text();
      },
    },

    // Function with context access
    getVar: {
      params: [{ name: 'name', type: 'string' }],
      fn: (args, ctx) => {
        return ctx.variables.get(args[0]) ?? null;
      },
    },

    // Function with location for error reporting
    validate: {
      params: [{ name: 'value', type: 'string' }],
      fn: (args, ctx, location) => {
        if (!args[0]) {
          throw new Error(`Validation failed at line ${location?.line}`);
        }
        return args[0];
      },
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
    'math::add': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (args) => args[0] + args[1],
    },
    'math::multiply': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (args) => args[0] * args[1],
    },
    'str::upper': {
      params: [{ name: 'text', type: 'string' }],
      fn: (args) => args[0].toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: 'string' }],
      fn: (args) => args[0].toLowerCase(),
    },

    // Multi-level namespaces
    'io::file::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: async (args) => fs.readFile(args[0], 'utf-8'),
    },
    'io::file::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: async (args) => fs.writeFile(args[0], args[1]),
    },
  },
});
```

Scripts call namespaced functions with the same syntax:

```rill
math::add(1, 2)           # 3
"hello" -> str::upper     # "HELLO"
io::file::read("config.json") -> parse_json
```

Namespaces help organize host APIs and avoid name collisions without requiring the `$` variable prefix.

### CallableFn Signature

The `fn` property in `HostFunctionDefinition` uses the `CallableFn` type:

```typescript
type CallableFn = (
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;
```

| Parameter | Description |
|-----------|-------------|
| `args` | Positional arguments passed to the function (already validated against `params`) |
| `ctx` | Runtime context with variables, pipeValue, etc. |
| `location` | Source location of the call site (for error reporting) |

## Host Function Type Declarations

All host functions must declare parameter types and optional defaults using the `HostFunctionDefinition` interface. The runtime validates arguments before calling your function, eliminating manual type checking.

### Parameter Type Declarations

Declare parameter types in the `params` array:

```typescript
const ctx = createRuntimeContext({
  functions: {
    repeat: {
      params: [
        { name: 'str', type: 'string' },
        { name: 'count', type: 'number', defaultValue: 1 },
      ],
      fn: (args) => {
        // args[0] guaranteed to be string
        // args[1] guaranteed to be number (or default)
        return args[0].repeat(args[1]);
      },
    },
  },
});
```

Scripts call typed functions the same way:

```text
repeat("hello", 3)        # "hellohellohello"
repeat("hi")              # "hi" (uses default count)
```

### Supported Types

| Type | Rill Value | Validation |
|------|------------|------------|
| `'string'` | String | `typeof value === 'string'` |
| `'number'` | Number | `typeof value === 'number'` |
| `'bool'` | Boolean | `typeof value === 'boolean'` |
| `'list'` | List | `Array.isArray(value)` |
| `'dict'` | Dict | `isDict(value)` |

### Default Values

Parameters with default values are optional. The default applies when the argument is missing:

```typescript
functions: {
  greet: {
    params: [
      { name: 'name', type: 'string' },
      { name: 'greeting', type: 'string', defaultValue: 'Hello' },
    ],
    fn: (args) => `${args[1]}, ${args[0]}!`,
  },
}
```

```text
greet("Alice")            # "Hello, Alice!"
greet("Bob", "Hi")        # "Hi, Bob!"
```

### Type Mismatch Errors

When argument types don't match, the runtime throws `RuntimeError` with code `RUNTIME_TYPE_ERROR`:

```typescript
// Script: repeat(42, 3)
// Error: Function 'repeat' expects parameter 'str' (position 0) to be string, got number
```

Error details include:

- Function name
- Parameter name
- Parameter position
- Expected type
- Actual type received

### HostFunctionDefinition Interface

```typescript
interface HostFunctionDefinition {
  params: HostFunctionParam[];
  fn: CallableFn;
  description?: string;                              // Human-readable function description
  returnType?: 'string' | 'number' | 'bool' | 'list' | 'dict' | 'any';  // Default: 'any'
}

interface HostFunctionParam {
  name: string;
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  defaultValue?: RillValue;
  description?: string;                              // Human-readable parameter description
}
```

### Documentation Validation

Enable `requireDescriptions` to enforce documentation at registration time:

```typescript
const ctx = createRuntimeContext({
  requireDescriptions: true,
  functions: {
    greet: {
      params: [
        { name: 'name', type: 'string', description: 'Person to greet' },
      ],
      description: 'Generate a greeting message',
      returnType: 'string',
      fn: (args) => `Hello, ${args[0]}!`,
    },
  },
});
```

Missing descriptions throw clear errors:
- Function: `Function 'name' requires description (requireDescriptions enabled)`
- Parameter: `Parameter 'x' of function 'name' requires description (requireDescriptions enabled)`

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
    longTask: {
      params: [],
      fn: async () => {
        await new Promise((r) => setTimeout(r, 10000));
        return 'done';
      },
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

## Introspection

Discover available functions, access language documentation, and check runtime version at runtime.

### getFunctions()

Enumerate all callable functions registered in the runtime context:

```typescript
import { createRuntimeContext, getFunctions } from '@rcrsr/rill';

const ctx = createRuntimeContext({
  functions: {
    greet: {
      params: [
        { name: 'name', type: 'string', description: 'Person to greet' },
      ],
      description: 'Generate a greeting message',
      fn: (args) => `Hello, ${args[0]}!`,
    },
  },
});

const functions = getFunctions(ctx);
// [
//   {
//     name: 'greet',
//     description: 'Generate a greeting message',
//     params: [{ name: 'name', type: 'string', description: 'Person to greet', defaultValue: undefined }]
//   },
//   ... built-in functions
// ]
```

Returns `FunctionMetadata[]` combining:
1. Host functions (with full parameter metadata)
2. Built-in functions
3. Script closures (reads `^(doc: "...")` annotation for description)

### getLanguageReference()

Access the bundled rill language reference for LLM prompt context:

```typescript
import { getLanguageReference } from '@rcrsr/rill';

const reference = getLanguageReference();
// Returns complete language reference text (syntax, operators, types, etc.)

// Use in LLM system prompts:
const systemPrompt = `You are a rill script assistant.

${reference}

Help the user write rill scripts.`;
```

### VERSION and VERSION_INFO

Access runtime version information for logging, diagnostics, or version checks:

```typescript
import { VERSION, VERSION_INFO } from '@rcrsr/rill';

// VERSION: Semver string for display
console.log(`Running rill ${VERSION}`);  // "Running rill 0.5.0"

// VERSION_INFO: Structured components for programmatic comparison
if (VERSION_INFO.major === 0 && VERSION_INFO.minor < 4) {
  console.warn('Rill version too old, upgrade required');
}

// Log full version info
console.log('Runtime:', {
  version: VERSION,
  major: VERSION_INFO.major,
  minor: VERSION_INFO.minor,
  patch: VERSION_INFO.patch,
  prerelease: VERSION_INFO.prerelease,
});
```

**VERSION Constant:**
- Type: `string`
- Format: Semver (e.g., `"0.5.0"`, `"1.0.0-beta.1"`)
- Use: Display in logs, error messages, diagnostics

**VERSION_INFO Constant:**
- Type: `VersionInfo`
- Fields:
  - `major: number` - Major version (breaking changes)
  - `minor: number` - Minor version (new features)
  - `patch: number` - Patch version (bug fixes)
  - `prerelease?: string` - Prerelease tag if present
- Use: Programmatic version comparison, compatibility checks

**Version Comparison Example:**

```typescript
import { VERSION_INFO } from '@rcrsr/rill';

function checkCompatibility(): boolean {
  const required = { major: 0, minor: 4, patch: 0 };

  if (VERSION_INFO.major !== required.major) {
    return false; // Breaking change
  }

  if (VERSION_INFO.minor < required.minor) {
    return false; // Missing features
  }

  return true;
}

if (!checkCompatibility()) {
  throw new Error(`Requires rill >= 0.4.0, found ${VERSION}`);
}
```

### getDocumentationCoverage()

Analyze documentation coverage of functions in a runtime context:

```typescript
import { createRuntimeContext, getDocumentationCoverage } from '@rcrsr/rill';

const ctx = createRuntimeContext({
  functions: {
    documented: {
      params: [{ name: 'x', type: 'string', description: 'Input value' }],
      description: 'A documented function',
      fn: (args) => args[0],
    },
    undocumented: {
      params: [{ name: 'x', type: 'string' }],
      fn: (args) => args[0],
    },
  },
});

const result = getDocumentationCoverage(ctx);
// { total: 2, documented: 1, percentage: 50 }
```

A function counts as documented when:
- Has non-empty description (after trim)
- All parameters have non-empty descriptions (after trim)

Empty context returns `{ total: 0, documented: 0, percentage: 100 }`.

### Introspection Types

```typescript
interface FunctionMetadata {
  readonly name: string;        // Function name (e.g., "math::add")
  readonly description: string; // Human-readable description
  readonly params: readonly ParamMetadata[];
  readonly returnType: string;  // Return type (default: 'any')
}

interface ParamMetadata {
  readonly name: string;                    // Parameter name
  readonly type: string;                    // Type constraint (e.g., "string")
  readonly description: string;             // Parameter description
  readonly defaultValue: RillValue | undefined; // Default if optional
}

interface DocumentationCoverageResult {
  readonly total: number;       // Total function count
  readonly documented: number;  // Functions with complete documentation
  readonly percentage: number;  // Percentage (0-100), rounded to 2 decimals
}

interface VersionInfo {
  readonly major: number;        // Major version (breaking changes)
  readonly minor: number;        // Minor version (new features)
  readonly patch: number;        // Patch version (bug fixes)
  readonly prerelease?: string;  // Prerelease tag if present
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
    slowOperation: {
      params: [],
      fn: async () => {
        // Will throw TimeoutError if exceeds 30s
        await longRunningTask();
        return 'done';
      },
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
    process: {
      params: [{ name: 'input', type: 'string' }],
      fn: (args) => {
        // If this returns "error: invalid input",
        // execution halts with AutoExceptionError
        return externalProcess(args[0]);
      },
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
| `RUNTIME_TYPE_ERROR` | Type mismatch (includes host function parameter validation) |
| `RUNTIME_TIMEOUT` | Operation timed out |
| `RUNTIME_ABORTED` | Execution cancelled |
| `RUNTIME_INVALID_PATTERN` | Invalid regex pattern |
| `RUNTIME_AUTO_EXCEPTION` | Auto-exception triggered |
| `RUNTIME_ASSERTION_FAILED` | Assertion failed (condition false) |
| `RUNTIME_ERROR_RAISED` | Error statement executed |

## See Also

- [Host API Reference](ref-host-api.md) — Complete TypeScript API reference and exports
- [Extensions](integration-extensions.md) — Reusable function packages
- [Modules](integration-modules.md) — Module convention
- [Reference](ref-language.md) — Language specification

