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
      params: [{ name: 'text', type: { kind: 'string' } }],
      fn: async (args) => {
        return await callYourLLM(args[0]);
      },
    },
  },
});

const result = await execute(ast, ctx);
console.log(result.result);
```

## RuntimeOptions

The `createRuntimeContext()` function accepts these options:

| Option | Type | Description |
|--------|------|-------------|
| `variables` | `Record<string, RillValue>` | Initial variables accessible as `$name` |
| `functions` | `Record<string, RillFunction \| RillFunctionSignature>` | Custom functions callable as `name()` |
| `callbacks` | `Partial<RuntimeCallbacks>` | I/O callbacks (e.g., `onLog`) |
| `observability` | `ObservabilityCallbacks` | Execution monitoring hooks |
| `timeout` | `number` | Timeout in ms for async functions |
| `autoExceptions` | `string[]` | Regex patterns that halt execution |
| `signal` | `AbortSignal` | Cancellation signal |
| `requireDescriptions` | `boolean` | Require descriptions for all functions and parameters |
| `resolvers` | `Record<string, SchemeResolver> \| undefined` | Scheme-to-resolver map for `use<scheme:...>` imports |
| `configurations` | `{ resolvers?: Record<string, unknown> } \| undefined` | Per-scheme config data passed to each resolver |
| `checkerMode` | `'strict' \| 'permissive' \| undefined` | Type checker mode; default `'permissive'` |

## Host Function Contract

Host functions must follow these rules to ensure correct script behavior:

### Immutability

**Host functions must not mutate input arguments.** rill values are immutable by design—modifying arguments breaks value semantics and causes unpredictable behavior.

```typescript
// WRONG: Mutates input array
functions: {
  addItem: {
    params: [{ name: 'list', type: { kind: 'list' } }],
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
    params: [{ name: 'list', type: { kind: 'list' } }],
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
    params: [{ name: 'input', type: { kind: 'string' } }],
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

## Value Types

Internal container types host code may encounter in observability callbacks or return values. See [Value Types](integration-resolvers.md#value-types) for `RillOrdered`, `RillTuple`, `RillTypeValue`, and closure introspection (`.^input`, `.^output`).

## Value Conversion

`toNative()` converts a `RillValue` to a structured result suitable for host consumption. See [Value Conversion](integration-resolvers.md#value-conversion) for the conversion table, descriptor shapes, and `NativeResult` migration guide.

## Custom Functions

Functions are called by name: `functionName(arg1, arg2)`.

```typescript
const ctx = createRuntimeContext({
  functions: {
    // Sync function
    add: {
      params: [
        { name: 'a', type: { kind: 'number' } },
        { name: 'b', type: { kind: 'number' } },
      ],
      fn: (args) => args[0] + args[1],
    },

    // Async function
    fetch: {
      params: [{ name: 'url', type: { kind: 'string' } }],
      fn: async (args, ctx, location) => {
        const response = await fetch(args[0]);
        return await response.text();
      },
    },

    // Function with context access
    getVar: {
      params: [{ name: 'name', type: { kind: 'string' } }],
      fn: (args, ctx) => {
        return ctx.variables.get(args[0]) ?? null;
      },
    },

    // Function with location for error reporting
    validate: {
      params: [{ name: 'value', type: { kind: 'string' } }],
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
        { name: 'a', type: { kind: 'number' } },
        { name: 'b', type: { kind: 'number' } },
      ],
      fn: (args) => args[0] + args[1],
    },
    'math::multiply': {
      params: [
        { name: 'a', type: { kind: 'number' } },
        { name: 'b', type: { kind: 'number' } },
      ],
      fn: (args) => args[0] * args[1],
    },
    'str::upper': {
      params: [{ name: 'text', type: { kind: 'string' } }],
      fn: (args) => args[0].toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: { kind: 'string' } }],
      fn: (args) => args[0].toLowerCase(),
    },

    // Multi-level namespaces
    'io::file::read': {
      params: [{ name: 'path', type: { kind: 'string' } }],
      fn: async (args) => fs.readFile(args[0], 'utf-8'),
    },
    'io::file::write': {
      params: [
        { name: 'path', type: { kind: 'string' } },
        { name: 'content', type: { kind: 'string' } },
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
io::file::read("config.json")
```

Namespaces help organize host APIs and avoid name collisions without requiring the `$` variable prefix.

The `ext::fn()` calling pattern is retained for compatibility but is not recommended for new code. In `strict` checker mode, `ext::fn()` calls are flagged. Use `use<ext:...>` imports instead (see [Host Resolver Registration](integration-resolvers.md)).

### Structured Output with generate()

LLM extensions expose `generate(prompt, options)` for schema-constrained structured output. The provider enforces the schema at the API level and returns a consistent dict.

```rill
[name: "string", age: "number", active: "bool"] => $schema

llm::generate("Extract user info from the following text: Alice, 30, active.", [
  schema: $schema,
]) => $result

$result.data.name    # "Alice"
$result.data.age     # 30
$result.data.active  # true
```

`generate()` returns `data` (the parsed dict) instead of `content` (free text). Use `$result.raw` to access the original JSON string.

## Host Resolver Registration

Register resolvers to handle `use<scheme:resource>` import statements in scripts. The `resolvers` and `configurations` fields in `RuntimeOptions` control this. See [Host Resolver Registration](integration-resolvers.md) for setup instructions, built-in resolvers (`moduleResolver`, `extResolver`), and custom resolver examples.

### CallableFn Signature

The `fn` property in `RillFunction` uses the `CallableFn` type:

```typescript
type CallableFn = (
  args: RillValue[],
  ctx: RuntimeContextLike,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;
```

| Parameter | Description |
|-----------|-------------|
| `args` | Positional arguments passed to the function (already validated against `params`) |
| `ctx` | Runtime context with variables, pipeValue, and session metadata |
| `location` | Source location of the call site (for error reporting) |

### Session Metadata in Host Functions

Host functions receive session metadata via `ctx.metadata: Record<string, string> | undefined`.

When running under [`rill-agent-harness`](https://github.com/rcrsr/rill-agent), the runtime populates these keys:

| Key | Type | Description |
|-----|------|-------------|
| `correlationId` | `string` | Unique per-session UUID for distributed tracing |
| `sessionId` | `string` | Session record ID |
| `agentName` | `string` | Name of the running agent |
| `timeoutDeadline` | `string` | Absolute deadline as Unix timestamp in ms |

Read metadata in a host function:

```typescript
functions: {
  trace: {
    params: [{ name: 'msg', type: { kind: 'string' } }],
    fn: (args, ctx) => {
      const correlationId = ctx.metadata?.correlationId ?? 'unknown';
      console.log(`[${correlationId}] ${args[0]}`);
      return args[0];
    },
  },
}
```

`ctx.metadata` is `undefined` when the script runs outside the agent harness (e.g., direct `execute()` calls).

## Host Function Type Declarations

All host functions must declare parameter types and optional defaults using the `RillFunction` interface. The runtime validates arguments before calling your function, eliminating manual type checking.

### Parameter Type Declarations

Declare parameter types in the `params` array:

```typescript
const ctx = createRuntimeContext({
  functions: {
    repeat: {
      params: [
        { name: 'str', type: { kind: 'string' } },
        { name: 'count', type: { kind: 'number' }, defaultValue: 1 },
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

The `type` field on `RillParam` is a `TypeStructure` object — a structural type descriptor. Set it to `undefined` to accept any type without validation.

Common leaf types:

| `TypeStructure` value | Accepts |
|-----------------------|---------|
| `{ kind: 'string' }` | String parameter |
| `{ kind: 'number' }` | Number parameter |
| `{ kind: 'bool' }` | Boolean parameter |
| `{ kind: 'list' }` | Any list |
| `{ kind: 'list', element: { kind: 'string' } }` | List of strings |
| `{ kind: 'dict' }` | Any dict |
| `{ kind: 'any' }` or `undefined` | Any type (no validation) |

See [Type System](topic-type-system.md) for the full `TypeStructure` discriminated union, including `closure`, `tuple`, `ordered`, and `union` variants.

### Default Values

Parameters with default values are optional. The default applies when the argument is missing:

```typescript
functions: {
  greet: {
    params: [
      { name: 'name', type: { kind: 'string' } },
      { name: 'greeting', type: { kind: 'string' }, defaultValue: 'Hello' },
    ],
    fn: (args) => `${args[1]}, ${args[0]}!`,
  },
}
```

```text
greet("Alice")            # "Hello, Alice!"
greet("Bob", "Hi")        # "Hi, Bob!"
```

### Field-Level Default Hydration

When a parameter type is `dict`, `ordered`, or `tuple`, the runtime fills missing fields with declared defaults before calling the host function. This happens at Stage 2.5 of `marshalArgs`, after top-level parameter defaults are applied and before type checking.

For tuple parameters, missing trailing elements are filled from the element type's `defaultValue`:

```typescript
functions: {
  format: {
    params: [
      {
        name: 'point',
        type: {
          kind: 'tuple',
          elements: [
            { type: { kind: 'number' } },
            { type: { kind: 'string' }, defaultValue: 'unnamed' },
          ],
        },
      },
    ],
    fn: (args) => {
      // args[0] is always a tuple with 2 elements
      // If caller passed (42,), runtime fills element 1 with "unnamed"
      const point = args[0] as { __rill_tuple: true; entries: unknown[] };
      return `${point.entries[1]}: ${point.entries[0]}`;
    },
  },
},
```

```text
format((42,))          # "unnamed: 42"  -- trailing default filled
format((42, "home"))   # "home: 42"     -- both elements present, no fill
```

The same hydration applies to `dict` and `ordered` parameters: missing named fields with declared defaults are filled before invocation.

| Parameter type | Missing field condition | Result |
|----------------|------------------------|--------|
| `tuple` | Trailing elements with `defaultValue` | Filled with deep copy of default |
| `tuple` | Trailing elements without `defaultValue` | Left absent; type check at Stage 3 catches |
| `dict` | Named fields with `defaultValue` | Filled with deep copy of default |
| `ordered` | Named fields with `defaultValue` | Filled with deep copy of default |

Hydration is recursive: if a filled default itself has a structured type with defaults, those are also hydrated.

Two additional behaviors apply during recursive hydration:

- **Nested synthesis** — A missing named field with no explicit default is synthesized as an empty collection when all its children declare `defaultValue`. The runtime seeds the empty collection and fills each child.
- **Explicit default hydration** — When a field's declared `defaultValue` is itself a collection, the runtime hydrates it through the field's nested type. Child defaults fill any fields the explicit default omits.

If any required child field lacks a `defaultValue`, the type check at Stage 3 catches the missing field and throws `RUNTIME_TYPE_ERROR`.

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

### RillFunction Interface

```typescript
interface RillFunction {
  readonly params: readonly RillParam[];
  readonly fn: CallableFn;
  readonly description?: string;       // Human-readable function description
  readonly returnType?: TypeStructure;      // undefined = any return type
}

interface RillParam {
  readonly name: string;
  readonly type: TypeStructure | undefined;             // undefined = any type
  readonly defaultValue: RillValue | undefined;    // undefined = required
  readonly annotations: Record<string, RillValue>; // {} when no annotations
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
        { name: 'name', type: { kind: 'string' }, annotations: { description: 'Person to greet' } },
      ],
      description: 'Generate a greeting message',
      returnType: { kind: 'string' },
      fn: (args) => `Hello, ${args[0]}!`,
    },
  },
});
```

Missing descriptions throw clear errors:
- Function: `Function 'name' requires description (requireDescriptions enabled)`
- Parameter: `Parameter 'x' of function 'name' requires description (requireDescriptions enabled)`

## Signature String Registration

Functions can be registered using a rill closure signature string instead of explicit `RillParam[]`. The runtime parses the signature at registration time and derives the parameter list from it.

```typescript
const ctx = createRuntimeContext({
  functions: {
    greet: {
      signature: '|name: string| :string',
      fn: (args) => `Hello, ${args[0]}!`,
    },
  },
});
```

The runtime discriminates `RillFunctionSignature` from `RillFunction` by the presence of the `signature` field.

Signature strings support the full rill closure annotation syntax, including parameter annotations and defaults:

```typescript
functions: {
  repeat: {
    signature: '|^("Times to repeat") count: number = 3, text: string| :string',
    fn: (args) => String(args[1]).repeat(args[0]),
  },
}
```

The `signature` value must be a valid rill closure type annotation string. Invalid signatures throw at registration time.

```typescript
interface RillFunctionSignature {
  readonly signature: string;  // annotated rill closure type signature
  readonly fn: CallableFn;
}
```

## Manifest Generation

`generateManifest(ctx)` returns a valid rill file string: a dict literal of closure type signatures for all registered functions. The dict is the last expression and becomes the script's result value.

```typescript
import { generateManifest } from '@rcrsr/rill';

const manifest = generateManifest(ctx);
// Write to host.rill for static analysis or LLM context
```

Example output for a context with `greet` and `repeat` functions:

```text
[
  "greet": |name: string|:string,
  "repeat": |count: number = 3, text: string|:string,
]
```

An empty function map produces:

```text
[:]
```

The manifest file format is valid rill. Host tools can pass it to static analysis tools, include it in LLM system prompts for code generation context, or serve it to IDE tooling for autocomplete.

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
| `script` | `ScriptCallable` | Closures from rill source code |
| `runtime` | `RuntimeCallable` | rill's built-in functions |
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
  // value is ScriptCallable (from rill source)
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
    onHostCall: (event) => {
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

interface HostCallEvent {
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
console.log('Final value:', final.result);
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
  result: RillValue;
}
```

## Introspection

Discover available functions, access language documentation, and check runtime version. See [Introspection](integration-resolvers.md#introspection) for `getFunctions()`, `getLanguageReference()`, `VERSION`/`VERSION_INFO`, and `getDocumentationCoverage()`.

## I/O Callbacks

Handle script I/O through callbacks:

```typescript
const ctx = createRuntimeContext({
  callbacks: {
    onLog: (value) => {
      // Called when script uses .log method
      console.log('[rill]', value);
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
      params: [{ name: 'input', type: { kind: 'string' } }],
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

See [Extension Backend Selection](integration-backends.md) for backend selection strategy and configuration examples.

## Error Handling

All rill errors extend `RillError` with structured information:

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
| `RILL-R004` | `serializeValue()` called on non-serializable type (closure, iterator, vector, type value, tuple, ordered) |

## See Also

| Document | Description |
|----------|-------------|
| [Host API Reference](ref-host-api.md) | Complete TypeScript API reference and exports |
| [Extensions](integration-extensions.md) | Reusable function packages |
| [Modules](integration-modules.md) | Module convention |
| [Reference](ref-language.md) | Language specification |

