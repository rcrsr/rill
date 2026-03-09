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
      params: [{ name: 'text', type: { type: 'string' } }],
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

## Host Function Contract

Host functions must follow these rules to ensure correct script behavior:

### Immutability

**Host functions must not mutate input arguments.** rill values are immutable by design—modifying arguments breaks value semantics and causes unpredictable behavior.

```typescript
// WRONG: Mutates input array
functions: {
  addItem: {
    params: [{ name: 'list', type: { type: 'list' } }],
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
    params: [{ name: 'list', type: { type: 'list' } }],
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
    params: [{ name: 'input', type: { type: 'string' } }],
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

rill uses several internal container types that host code may encounter in observability callbacks or return values.

### RillOrdered

`RillOrdered` is the container produced by dict spread (`*dict`). It preserves insertion order and carries named keys.

```typescript
interface RillOrdered {
  __rill_ordered: true;
  entries: [string, RillValue][];
}
// Created by: ordered[a: 1, b: 2]
```

`toNative()` converts `RillOrdered` to a plain object — the `NativeResult.value` field holds `{ key: value, ... }` with insertion-order keys.

### RillTuple

`RillTuple` holds positional values produced by tuple expressions. The `entries` field is a plain array, not a `Map`:

```typescript
interface RillTuple {
  __rill_tuple: true;
  entries: RillValue[];    // positional values, 0-indexed
}
```

`toNative()` converts `RillTuple` to a native array — the `NativeResult.value` field holds the entries as a plain array.

### RillTypeValue

`^type` expressions return a `RillTypeValue`. The `structure` field carries the full structural type:

```typescript
interface RillTypeValue {
  __rill_type: true;
  name: string;                    // coarse name: "list", "dict", "number", etc.
  structure: RillStructuralType;   // full structural type
}
```

`RillStructuralType` uses a `type` discriminator field. The `kind`, `name`, and `primitive` fields no longer exist:

```typescript
type RillStructuralType =
  | { type: 'number' }
  | { type: 'string' }
  | { type: 'bool' }
  | { type: 'vector' }
  | { type: 'type' }
  | { type: 'any' }
  | { type: 'dict';    fields?: Record<string, RillStructuralType> }
  | { type: 'list';    element?: RillStructuralType }
  | { type: 'closure'; params?: [string, RillStructuralType][]; ret?: RillStructuralType }
  | { type: 'tuple';   elements?: RillStructuralType[] }
  | { type: 'ordered'; fields?: [string, RillStructuralType][] }
```

**Breaking change from previous versions:** `{ kind: 'primitive', name: 'string' }` is now `{ type: 'string' }`. `{ kind: 'any' }` is now `{ type: 'any' }`. `{ kind: 'dict', fields: F }` is now `{ type: 'dict', fields?: F }`. Switch on `structure.type`, not `structure.kind`.

The structural type formats as a human-readable string via `formatStructuralType`:

| Expression | `:>string` output |
|------------|---------------|
| `[1, 2, 3] -> ^type` | `"list(number)"` |
| `[a: 1, b: "x"] -> ^type` | `"dict(a: number, b: string)"` |
| `tuple[1, "x"] -> ^type` | `"tuple(number, string)"` |
| `ordered[a: 1, b: 2] -> ^type` | `"ordered(a: number, b: number)"` |

Dict fields are sorted alphabetically in the formatted output.

### Closure Introspection: .^input and .^output

Script closures expose their parameter and return type shapes via `.^input` and `.^output`.

**`.^input`** returns a `RillOrdered` value. Each entry is a `[paramName, RillTypeValue]` pair, preserving parameter declaration order. Only `ScriptCallable` closures populate this — other callable kinds return an empty ordered value.

```typescript
// Script closure returned from execute():
// |x: number, y: string| x -> :>string

const closure = result.result; // RillCallable (ScriptCallable)
// $fn.^input -> ordered[x: ^number, y: ^string]
// Host side: RillOrdered with entries [["x", RillTypeValue], ["y", RillTypeValue]]
// entries[0][1].structure -> { type: 'number' }
// entries[1][1].structure -> { type: 'string' }
```

```typescript
// Parameterized closure: |x: list(string), y: number| { $x }
// entries[0][1].structure -> { type: 'list', element: { type: 'string' } }
// entries[1][1].structure -> { type: 'number' }
//
// Use structure.element to inspect the list's element type:
// if (entries[0][1].structure.type === 'list') {
//   const elementType = entries[0][1].structure.element; // { type: 'string' }
// }
```

> **Behavioral change (v0.x):** Hosts inspecting `.^input` on parameterized closures now see full structural sub-fields. Code that checks `structure.type === 'list'` is unaffected. Code that assumed `element` was always absent must handle the populated case.

**`.^output`** returns a `RillTypeValue` with the closure's declared return type. When no return type is declared, the fallback structure is `{ type: 'any' }`:

```typescript
// Closure with declared return: |x: number| :string -> ...
// $fn.^output -> ^string
// Host side: RillTypeValue with structure { type: 'string' }

// Closure with no declared return type:
// $fn.^output -> ^any
// Host side: RillTypeValue with structure { type: 'any' }
```

Both accessors use `structure.type` (not `structure.kind`) to discriminate the structural type.

## Value Conversion

`toNative()` converts a `RillValue` to a structured result suitable for host consumption.

```typescript
import { toNative } from '@rcrsr/rill';

const nativeResult = toNative(executionResult.result);
console.log(nativeResult.rillTypeName);      // e.g. "string", "list", "ordered"
console.log(nativeResult.rillTypeSignature); // e.g. "string", "list(number)"
console.log(nativeResult.value);             // JS-native value, always populated
```

### NativeResult

```typescript
interface NativeResult {
  /** Base rill type name — "string", "number", "bool", "list", "dict",
   *  "tuple", "ordered", "closure", "vector", "type", or "iterator" */
  rillTypeName: string;
  /** Full structural type signature from formatStructuralType,
   *  e.g. "list(number)", "dict(a: number, b: string)", "|x: number| :string" */
  rillTypeSignature: string;
  /** JS-native representation. Always populated — never undefined.
   *  Non-native types produce descriptor objects (see Descriptor shapes below). */
  value: NativeValue;
}

type NativeValue = string | number | boolean | null | NativeValue[] | { [key: string]: NativeValue };
```

### Conversion table

| Rill value | `rillTypeName` | `value` |
|------------|----------------|---------|
| `null` (rill null / empty string) | `"string"` | `null` |
| string | `"string"` | string |
| number | `"number"` | number |
| bool | `"bool"` | boolean |
| list | `"list"` | array |
| dict | `"dict"` | plain object |
| tuple | `"tuple"` | array of entry values |
| ordered | `"ordered"` | plain object with insertion-order keys |
| closure | `"closure"` | descriptor: `{ signature: string }` |
| vector | `"vector"` | descriptor: `{ model: string, dimensions: number }` |
| type value | `"type"` | descriptor: `{ name: string, signature: string }` |
| iterator | `"iterator"` | descriptor: `{ done: boolean }` |

`value` is always a `NativeValue` — it is never `undefined`. JavaScript `null` is a valid `NativeValue` (rill null maps to JS null).

### Descriptor shapes

Non-native rill types produce descriptor objects in `value` instead of primitive values:

**closure** — `value` is `{ signature: string }`:

```typescript
const result = toNative(closureValue);
// result.rillTypeName      -> "closure"
// result.rillTypeSignature -> "|x: number| :string"
// result.value             -> { signature: "|x: number| :string" }
```

`signature` is identical to `rillTypeSignature` — both come from `formatStructuralType`.

**vector** — `value` is `{ model: string, dimensions: number }`:

```typescript
const result = toNative(vectorValue);
// result.rillTypeName      -> "vector"
// result.rillTypeSignature -> "vector"
// result.value             -> { model: "text-embedding-3-small", dimensions: 1536 }
```

**type value** — `value` is `{ name: string, signature: string }`:

```typescript
const result = toNative(typeValue);
// result.rillTypeName      -> "type"
// result.rillTypeSignature -> "list(number)"
// result.value             -> { name: "list", signature: "list(number)" }
```

`name` is the coarse type name; `signature` is the full structural signature from `formatStructuralType`.

**iterator** — `value` is `{ done: boolean }`:

```typescript
const result = toNative(iteratorValue);
// result.rillTypeName      -> "iterator"
// result.rillTypeSignature -> "iterator"
// result.value             -> { done: false }
```

### Migration from previous NativeResult

The `NativeResult` interface was redesigned. Hosts consuming `toNative()` must update field access.

| Before | After | Action |
|--------|-------|--------|
| `result.kind` | `result.rillTypeName` | Rename field access |
| `result.typeSig` | `result.rillTypeSignature` | Rename field access |
| `result.native` | `result.value` | Rename field access |
| `result.native === null` guard | Not needed — `value` is always populated | Remove null checks |
| Non-native types return `native: null` | Non-native types return descriptor objects | Read descriptor fields instead |

### valueToJSON

The built-in `json` function (used inside scripts as `value -> json`) throws `RILL-R004` for non-serializable types (closure, iterator, vector, type value, tuple, ordered). Use `toNative()` at the host boundary for safe, non-throwing conversion with type metadata.

## Custom Functions

Functions are called by name: `functionName(arg1, arg2)`.

```typescript
const ctx = createRuntimeContext({
  functions: {
    // Sync function
    add: {
      params: [
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (args) => args[0] + args[1],
    },

    // Async function
    fetch: {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: async (args, ctx, location) => {
        const response = await fetch(args[0]);
        return await response.text();
      },
    },

    // Function with context access
    getVar: {
      params: [{ name: 'name', type: { type: 'string' } }],
      fn: (args, ctx) => {
        return ctx.variables.get(args[0]) ?? null;
      },
    },

    // Function with location for error reporting
    validate: {
      params: [{ name: 'value', type: { type: 'string' } }],
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
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (args) => args[0] + args[1],
    },
    'math::multiply': {
      params: [
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (args) => args[0] * args[1],
    },
    'str::upper': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: (args) => args[0].toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: (args) => args[0].toLowerCase(),
    },

    // Multi-level namespaces
    'io::file::read': {
      params: [{ name: 'path', type: { type: 'string' } }],
      fn: async (args) => fs.readFile(args[0], 'utf-8'),
    },
    'io::file::write': {
      params: [
        { name: 'path', type: { type: 'string' } },
        { name: 'content', type: { type: 'string' } },
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
    params: [{ name: 'msg', type: { type: 'string' } }],
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
        { name: 'str', type: { type: 'string' } },
        { name: 'count', type: { type: 'number' }, defaultValue: 1 },
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

The `type` field on `RillParam` is a `RillType` object — a structural type descriptor. Set it to `undefined` to accept any type without validation.

Common leaf types:

| `RillType` value | Accepts |
|------------------|---------|
| `{ type: 'string' }` | String parameter |
| `{ type: 'number' }` | Number parameter |
| `{ type: 'bool' }` | Boolean parameter |
| `{ type: 'list' }` | Any list |
| `{ type: 'list', element: { type: 'string' } }` | List of strings |
| `{ type: 'dict' }` | Any dict |
| `{ type: 'any' }` or `undefined` | Any type (no validation) |

See [Type System](topic-type-system.md) for the full `RillType` discriminated union, including `closure`, `tuple`, `ordered`, and `union` variants.

### Default Values

Parameters with default values are optional. The default applies when the argument is missing:

```typescript
functions: {
  greet: {
    params: [
      { name: 'name', type: { type: 'string' } },
      { name: 'greeting', type: { type: 'string' }, defaultValue: 'Hello' },
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

### RillFunction Interface

```typescript
interface RillFunction {
  readonly params: readonly RillParam[];
  readonly fn: CallableFn;
  readonly description?: string;       // Human-readable function description
  readonly returnType?: RillType;      // undefined = any return type
}

interface RillParam {
  readonly name: string;
  readonly type: RillType | undefined;             // undefined = any type
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
        { name: 'name', type: { type: 'string' }, annotations: { description: 'Person to greet' } },
      ],
      description: 'Generate a greeting message',
      returnType: { type: 'string' },
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

`generateManifest(ctx)` returns a valid rill file string: a dict literal of closure type signatures for all registered functions, followed by `-> export`.

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
-> export
```

An empty function map produces:

```text
[:]
-> export
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

Discover available functions, access language documentation, and check runtime version at runtime.

### getFunctions()

Enumerate all callable functions registered in the runtime context:

```typescript
import { createRuntimeContext, getFunctions } from '@rcrsr/rill';

const ctx = createRuntimeContext({
  functions: {
    greet: {
      params: [
        { name: 'name', type: { type: 'string' }, annotations: { description: 'Person to greet' } },
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
  console.warn('rill version too old, upgrade required');
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

| Constant | Type | Use |
|----------|------|-----|
| `VERSION` | `string` | Semver string for display in logs and error messages |
| `VERSION_INFO` | `VersionInfo` | Structured `major`/`minor`/`patch`/`prerelease` for programmatic comparison |

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
      params: [{ name: 'x', type: { type: 'string' }, annotations: { description: 'Input value' } }],
      description: 'A documented function',
      fn: (args) => args[0],
    },
    undocumented: {
      params: [{ name: 'x', type: { type: 'string' } }],
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
      params: [{ name: 'input', type: { type: 'string' } }],
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
| `RILL-R004` | `valueToJSON()` called on non-serializable type (closure, iterator, vector, type value, tuple, ordered) |

## See Also

| Document | Description |
|----------|-------------|
| [Host API Reference](ref-host-api.md) | Complete TypeScript API reference and exports |
| [Extensions](integration-extensions.md) | Reusable function packages |
| [Modules](integration-modules.md) | Module convention |
| [Reference](ref-language.md) | Language specification |

