# rill Host API Reference

*Complete TypeScript API for embedding rill in applications*

## Complete Example

### Extension Factory Pattern (Recommended)

```typescript
import {
  parse,
  execute,
  createRuntimeContext,
  toCallable,
  AbortError,
  type ExtensionFactoryResult,
} from '@rcrsr/rill';

function createMyExtension(config: { model: string }): ExtensionFactoryResult {
  return {
    value: {
      prompt: toCallable({
        params: [{ name: 'text', type: { kind: 'string' } }],
        fn: async (args) => await callLLM(args.text, config.model),
        annotations: { description: 'Send a prompt to the LLM' },
        returnType: { kind: 'string' },
      }),
    },
  };
}

const ext = createMyExtension({ model: 'claude-3-5-sonnet' });
const controller = new AbortController();

const ctx = createRuntimeContext({
  variables: { llm: ext.value },
  callbacks: { onLog: (value) => console.log('[log]', value) },
  timeout: 30000,
  signal: controller.signal,
});

try {
  const ast = parse('llm.prompt("Hello")');
  const result = await execute(ast, ctx);
  console.log('Result:', result.result);
} catch (err) {
  if (err instanceof AbortError) {
    console.log('Cancelled');
  } else {
    throw err;
  }
} finally {
  await ext.dispose?.();
}
```

### Direct Registration (Legacy)

```typescript
import {
  parse,
  execute,
  createRuntimeContext,
  callable,
  structureToTypeValue,
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
      // Untyped callable: params is undefined, args is RillValue[] (no marshaling)
      format: callable((args) => {
        const [template, ...values] = args as unknown as RillValue[];
        return String(template).replace(/\{\}/g, () =>
          String(values.shift() ?? '')
        );
      }),
    },
  },

  functions: {
    prompt: {
      params: [{ name: 'text', type: { kind: 'string' } }],
      fn: async (args, ctx, location) => {
        console.log(`[prompt at line ${location?.line}]`);
        return await callLLM(args.text);
      },
      annotations: { description: 'Send a prompt to the LLM and return the response' },
      returnType: structureToTypeValue({ kind: 'string' }),
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
  console.log('Result:', result.result);
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
export { execute, createRuntimeContext, createStepper, generateManifest };
export type { RuntimeContext, RuntimeOptions, ExecutionResult };
export type { ExecutionStepper, StepResult };

// Resolvers
export { moduleResolver, extResolver };
export type { SchemeResolver, ResolverResult };

// Callable types
export { callable, isCallable, isScriptCallable, isRuntimeCallable, isApplicationCallable };
export type { RillCallable, ScriptCallable, RuntimeCallable, ApplicationCallable, CallableFn };

// Host function types
export type { RillParam, RillFunction };
export type { TypeStructure };
export type { TypeDefinition, TypeProtocol };
export type { RillTypeValue };

// Stream helpers
export { createRillStream, isRillStream };
export type { RillStream };

// Value types
export type { RillValue };

// Value conversion
export { toNative };
export type { NativeResult, NativeValue, NativeArray, NativePlainObject };

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
export { isDict, isReservedMethod, RESERVED_DICT_METHODS };
export type { SourceLocation, SourceSpan };

// Control flow (for advanced use)
export { BreakSignal, ReturnSignal };

// Syntax highlighting
export { TOKEN_HIGHLIGHT_MAP };
export type { HighlightCategory };

// Error registry
export { ERROR_REGISTRY };

// Extension types
export type { ExtensionFactoryResult, ExtensionFactory, ExtensionEvent, ExtensionManifest, ExtensionConfigSchema };
export type { ExtensionFactoryCtx };

// Extension utilities
export { toCallable, createTestContext, emitExtensionEvent };

// Error registry (atom registration)
export { registerCoreAtom };
export type { RillAtom, RillStatus, InvalidMeta, TraceFrame };
export { formatHalt };

```

> **Migration note:** `KvExtensionContract` and `FsExtensionContract` types moved to
> [`@rcrsr/rill-ext-kv`](https://github.com/rcrsr/rill-ext) and
> [`@rcrsr/rill-ext-fs`](https://github.com/rcrsr/rill-ext) in the
> [rill-ext](https://github.com/rcrsr/rill-ext) repository.

## NativeResult

`toNative(value: RillValue): NativeResult` converts any rill value to a host-consumable structure.

```typescript
interface NativeResult {
  /** Base rill type name — matches RillTypeName, or "iterator" for lazy sequences */
  rillTypeName: string;
  /** Full structural signature from formatStructure,
   *  e.g. "list(number)", "dict(a: number, b: string)", "|x: number| :string" */
  rillTypeSignature: string;
  /** JS-native representation. Always populated — never undefined.
   *  Non-native types produce descriptor objects. */
  value: NativeValue;
}

type NativeValue =
  | string | number | boolean | null
  | NativeArray | NativePlainObject;
```

### Descriptor shapes for non-native types

| Rill type | `value` shape |
|-----------|---------------|
| `closure` | `{ signature: string }` |
| `vector` | `{ model: string, dimensions: number }` |
| `type` | `{ name: string, signature: string }` |
| `iterator` | `{ done: boolean }` |
| `stream` | `{ done: boolean }` |
| `datetime` | `{ unix: number, iso: string }` |
| `duration` | `{ months: number, ms: number }` |

See [Host Integration](integration-host.md) for conversion examples and migration guidance.

---

## createRuntimeContext

`createRuntimeContext(options: RuntimeOptions): RuntimeContext` builds the execution context passed to `execute()`. See [Host Integration](integration-host.md) for the full `RuntimeOptions` field reference.

### Datetime Fields

Two fields control datetime behavior in scripts.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timezone` | `number` | `0` (UTC) | Numeric hour offset for `.local_*` properties on `datetime` values |
| `nowMs` | `number` | `undefined` | Fixed unix millisecond timestamp for deterministic `now()` calls |

`timezone` accepts numeric offsets only (e.g., `-5` for UTC-5, `5.5` for UTC+5:30). IANA timezone name resolution (e.g., `"America/New_York"`) requires `datetime-extension`.

`nowMs` pins `now()` to a fixed timestamp. Scripts that call `now()` without `nowMs` return the wall-clock time at execution.

```typescript
import { createRuntimeContext } from '@rcrsr/rill';

// Fixed timestamp for deterministic test execution
const ctx = createRuntimeContext({
  timezone: -5,
  nowMs: new Date('2024-06-15T12:00:00Z').getTime(),
});

// Scripts using now() return 2024-06-15T12:00:00Z
// Scripts using .local_date return date in UTC-5 (2024-06-15)
```

---

## TOKEN_HIGHLIGHT_MAP

`TOKEN_HIGHLIGHT_MAP` maps each `TokenType` to a `HighlightCategory`. Use this to build syntax highlighters for rill scripts.

```typescript
import { TOKEN_HIGHLIGHT_MAP, tokenize } from '@rcrsr/rill';

const tokens = tokenize(source);
for (const token of tokens) {
  const category = TOKEN_HIGHLIGHT_MAP.get(token.type);
  if (category) applyHighlight(token, category);
}
```

### HighlightCategory Values

| Category | Description |
|----------|-------------|
| `keyword` | Language keywords and collection keyword prefixes |
| `operator` | All binary and unary operators |
| `string` | String literals |
| `number` | Numeric literals |
| `bool` | Boolean literals (`true`, `false`) |
| `comment` | Line comments |
| `variableName` | Variables (`$`), identifiers, `_` |
| `punctuation` | Structural characters (`.`, `,`, `:`) |
| `bracket` | Delimiters (`(`, `)`, `{`, `}`, `[`, `]`) |
| `meta` | Frontmatter delimiters |

### Token Changes in Explicit-Literal Syntax

The explicit-literal-syntax initiative (replacing sigil-based forms with keyword-prefixed forms) changed which tokens exist:

**6 tokens added:**

| Token | Category | Syntax |
|-------|----------|--------|
| `LIST_LBRACKET` | `keyword` | `list[` |
| `DICT_LBRACKET` | `keyword` | `dict[` |
| `TUPLE_LBRACKET` | `keyword` | `tuple[` |
| `ORDERED_LBRACKET` | `keyword` | `ordered[` |
| `DESTRUCT_LANGLE` | `keyword` | `destruct<` |
| `SLICE_LANGLE` | `keyword` | `slice<` |

**2 tokens removed:**

| Token | Was | Replaced by |
|-------|-----|-------------|
| `STAR_LT` | Destruct sigil (`*<`) | `DESTRUCT_LANGLE` |
| `SLASH_LT` | Slice sigil (`/<`) | `SLICE_LANGLE` |

Highlighters that mapped the removed tokens must update to the replacement tokens.

`AT` remains in `TOKEN_HIGHLIGHT_MAP` as `operator` for the `@` while-loop operator. Only the chain-sigil use of `@` was removed; the token itself was not.

## ERROR_REGISTRY

`ERROR_REGISTRY` provides structured access to all error definitions. Use this to build diagnostic tools or format error messages with links.

```typescript
import { ERROR_REGISTRY } from '@rcrsr/rill';

const entry = ERROR_REGISTRY.get('RILL-P008');
console.log(entry?.description);  // "Bare bracket literal"
console.log(entry?.helpUrl);      // "https://rill.run/docs/reference/errors/#rill-p008"
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get(code)` | `ErrorEntry \| undefined` | Look up an error by code |
| `all()` | `ErrorEntry[]` | All registered error entries |

### Error Code Ranges

| Range | Category |
|-------|----------|
| `RILL-L001` – `RILL-L005` | Lexer errors |
| `RILL-P001` – `RILL-P005`, `RILL-P007` – `RILL-P010` | Parse errors |
| `RILL-R001` – `RILL-R016` | Runtime errors |
| `RILL-C001` – `RILL-C004` | Check errors |

Note: `RILL-P006` (deprecated capture arrow syntax) was removed. `RILL-P007` through `RILL-P010` cover explicit-literal-syntax violations.

See [Error Reference](ref-errors.md) for full error descriptions and resolution strategies.

## RillParam

`RillParam` is the unified parameter descriptor for host functions and script closures.

```typescript
interface RillParam {
  readonly name: string;
  readonly type: TypeStructure | undefined;
  readonly defaultValue: RillValue | undefined;
  readonly annotations: Record<string, RillValue>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `TypeStructure \| undefined` | Structural type descriptor. `undefined` = any type (no validation) |
| `defaultValue` | `RillValue \| undefined` | Default value when argument missing. `undefined` = required parameter |
| `annotations` | `Record<string, RillValue>` | Key-value metadata. Empty object when no annotations. `annotations.description` is the parameter description |

---

## CallableFn

`CallableFn` is the function signature for typed host function implementations.

```typescript
type CallableFn = (
  args: Record<string, RillValue>,
  ctx: RuntimeContextLike,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `Record<string, RillValue>` | Named arguments keyed by parameter name. The runtime marshals positional call-site arguments into this record using the declared `params` list before invoking `fn` |
| `ctx` | `RuntimeContextLike` | Runtime context for the current execution. Provides access to variables, abort signal, and callbacks |
| `location` | `SourceLocation \| undefined` | Source location of the call site. Present when the call originates from a rill script; undefined in programmatic calls |

**Returns:** `RillValue` or `Promise<RillValue>`. `RillStream` is a valid `RillValue` return. Use `createRillStream` to build a stream from an `AsyncIterable`. See [Stream Helpers](#stream-helpers) for construction details.

**Migration note:** The `args` parameter changed from `RillValue[]` (positional) to `Record<string, RillValue>` (named). Replace `args[0]` with `args.paramName` for each parameter. Untyped callables created via `callable()` (where `params` is `undefined`) bypass marshaling and still receive `RillValue[]`; their internal type cast is unchanged.

---

## RillFunction

`RillFunction` is the single registration path for all host functions.

```typescript
interface RillFunction {
  readonly params: readonly RillParam[];
  readonly fn: CallableFn;
  readonly annotations?: Record<string, RillValue>;
  readonly returnType: RillTypeValue;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `params` | `readonly RillParam[]` | Parameter descriptors. Runtime validates arguments before calling `fn` |
| `fn` | `CallableFn` | The function implementation. The runtime marshals call-site arguments into `Record<string, RillValue>` keyed by parameter name before invoking `fn`. See [CallableFn](#callablefn) |
| `annotations` | `Record<string, RillValue> \| undefined` | Key-value metadata. `annotations.description` replaces the old `description` field. Optional; defaults to `{}` |
| `returnType` | `RillTypeValue` | Declared return type. Required. Use `anyTypeValue` as the equivalent of "no constraint". Runtime does NOT validate return values at call time |

### Tuple Parameter Hydration

When a host function parameter type is `{ kind: 'tuple' }` and `type.fields` contains fields with `defaultValue !== undefined`, the runtime fills missing trailing positions with deep copies of those defaults before invoking `fn`.

This happens at Stage 2.5 of `marshalArgs`, after argument validation and before `fn` is called.

```typescript
const fn: RillFunction = {
  params: [{
    name: 'coords',
    type: {
      kind: 'tuple',
      fields: [
        { type: { kind: 'number' } },
        { type: { kind: 'number' }, defaultValue: 0 },  // default: 0
      ],
    },
  }],
  fn: (args) => args.coords,  // caller passes tuple[1] → receives tuple[1, 0]
  returnType: structureToTypeValue({ kind: 'tuple' }),
};
```

Hydration applies only to trailing elements. A missing non-trailing element with no default raises `RILL-R009`. Hydration does not apply to list, dict, ordered, or closure types.

---

## Stream Helpers

`RillStream` is a valid `RillValue`. A host function returns a stream to deliver incremental results to rill scripts.

---

### createRillStream

```typescript
createRillStream(options: {
  chunks: AsyncIterable<RillValue>;
  resolve: () => Promise<RillValue>;
  dispose?: () => void;
  chunkType?: TypeStructure;
  retType?: TypeStructure;
}): RillStream
```

Builds a `RillStream` from an `AsyncIterable` of chunk values and a resolution callback.

| Parameter | Type | Description |
|-----------|------|-------------|
| `chunks` | `AsyncIterable<RillValue>` | Async source of chunk values. Each yielded value is one stream step |
| `resolve` | `() => Promise<RillValue>` | Called once when all chunks are consumed. Returns the final resolved value |
| `dispose` | `() => void` | Optional cleanup function. Called when the stream is exhausted |
| `chunkType` | `TypeStructure` | Optional structural type descriptor for chunk values |
| `retType` | `TypeStructure` | Optional structural type descriptor for the resolved return value |

```typescript
import { createRillStream } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

const fn: RillFunction = {
  params: [{ name: 'prompt', type: { kind: 'string' } }],
  fn: async (args) => {
    async function* generateChunks(): AsyncIterable<RillValue> {
      for await (const token of streamLLM(args.prompt as string)) {
        yield token as RillValue;
      }
    }
    return createRillStream({
      chunks: generateChunks(),
      resolve: async () => 'done' as RillValue,
    });
  },
  returnType: structureToTypeValue({ kind: 'stream', chunk: { kind: 'string' }, ret: { kind: 'string' } }),
};
```

---

### isRillStream

```typescript
isRillStream(value: RillValue): value is RillStream
```

Returns `true` when `value` is a `RillStream`. Use this to detect stream results from `execute()`.

```typescript
import { isRillStream } from '@rcrsr/rill';
import type { RillStream } from '@rcrsr/rill';
```

---

### execute() Stream Result Path

When a rill script returns a stream, `execute()` returns a `RillStream` inside `result.result`. Use `isRillStream` to detect it, then consume chunks by calling `step.next.fn`.

```typescript
import { parse, execute, createRuntimeContext, isRillStream } from '@rcrsr/rill';
import type { RillStream } from '@rcrsr/rill';

const ast = parse('use<ext:app> => $app\n$app.stream_fn("prompt text")');
const ctx = createRuntimeContext({ /* ... */ });
const result = await execute(ast, ctx);

if (isRillStream(result.result)) {
  let step = result.result as RillStream;

  // Advance through chunks; initial stream object has no value — call next first
  step = (await step.next.fn({}, ctx)) as RillStream;
  while (!step.done) {
    console.log('chunk:', step.value);
    step = (await step.next.fn({}, ctx)) as RillStream;
  }

  // Invoke the resolution callback via the hidden resolve property
  const resolveFn = (step as unknown as Record<string, () => Promise<unknown>>)[
    '__rill_stream_resolve'
  ];
  const finalValue = resolveFn ? await resolveFn() : undefined;
  console.log('resolved:', finalValue);
}
```

`step.done` is `false` while chunks remain. The initial stream object has no value; call `step.next.fn({}, ctx)` to get the first step. When `step.done` is `true`, all chunks are consumed. The resolution callback is stored as `__rill_stream_resolve` on the initial stream object.

---

## generateManifest

`generateManifest(ctx: RuntimeContext): string`

Generates a valid rill manifest file listing all registered host functions as closure type signatures.

```typescript
import { generateManifest } from '@rcrsr/rill';

const manifest = generateManifest(ctx);
// Returns a rill file suitable for static analysis or LLM context
```

The output format is a rill dict literal. The dict is the last expression and becomes the script's result value:

```text
[
  "greet": |name: string|:string,
  "fetch": |url: string|:dict,
]
```

An empty function map returns `[:]`. Functions with `params: undefined` (created via the `callable()` helper) are excluded.

---

## SchemeResolver

`SchemeResolver` is the function type for custom `use<scheme:...>` resource resolvers.

```typescript
type SchemeResolver = (
  resource: string,
  config?: unknown
) => ResolverResult | Promise<ResolverResult>;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `resource` | `string` | The resource path after the scheme prefix (e.g., `"myModule"` from `use<host:myModule>`) |
| `config` | `unknown \| undefined` | Per-scheme configuration data from `RuntimeOptions.configurations` |

**Returns:** `ResolverResult` or a promise that resolves to one. See [ResolverResult](#resolverresult) for variant shapes.

```typescript
import type { SchemeResolver } from '@rcrsr/rill';

const myResolver: SchemeResolver = async (resource, config) => {
  const source = await loadSource(resource);
  return { kind: 'source', text: source };
};
```

---

## ResolverResult

`ResolverResult` is the discriminated union returned by a `SchemeResolver`.

```typescript
type ResolverResult =
  | { kind: 'value'; value: RillValue }
  | { kind: 'source'; text: string };
```

| Variant | Fields | Description |
|---------|--------|-------------|
| `{ kind: 'value' }` | `value: RillValue` | Supplies a pre-built rill value (e.g., an extension dict) |
| `{ kind: 'source' }` | `text: string` | Supplies rill source text to be parsed and executed |

```typescript
import type { ResolverResult, RillValue } from '@rcrsr/rill';

// Return a pre-built value
const valueResult: ResolverResult = {
  kind: 'value',
  value: { search: mySearchFn } as RillValue,
};

// Return source text for rill to parse
const sourceResult: ResolverResult = {
  kind: 'source',
  text: `|x: string| x -> .upper`,
};
```

---

## moduleResolver

`moduleResolver` is a built-in `SchemeResolver` that maps module identifiers to file paths and returns their source text.

```typescript
import { moduleResolver } from '@rcrsr/rill';
```

**Config shape:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `[moduleId]` | `string` | Yes (at least one) | Maps a module identifier to a file path (relative to the config file's directory) |

**Error codes:**

| Code | Trigger |
|------|---------|
| `RILL-R050` | Module identifier not found in config |
| `RILL-R051` | File read failure (I/O error or missing file) |
| `RILL-R059` | Config is missing or malformed |

```typescript
import { moduleResolver, createRuntimeContext } from '@rcrsr/rill';

const ctx = createRuntimeContext({
  resolvers: { host: moduleResolver },
  configurations: {
    resolvers: {
      host: {
        utils: './utils.rill',
        helpers: './lib/helpers.rill',
      },
    },
  },
});

// Scripts can now use: use<host:utils>
```

`moduleResolver` returns `{ kind: 'source', text: string }` after reading the target file. Paths resolve relative to the config file's directory.

---

## extResolver

`extResolver` is a built-in `SchemeResolver` that maps extension identifiers to pre-built rill values.

```typescript
import { extResolver } from '@rcrsr/rill';
```

**Config shape:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `[extensionId]` | `RillValue` | Yes (at least one) | Maps an extension identifier to its full rill value dict |

**Member access:** A resource of `"qdrant.search"` returns only the `search` member from the `qdrant` extension dict. A resource of `"qdrant"` returns the full dict.

**Error codes:**

| Code | Trigger |
|------|---------|
| `RILL-R052` | Extension identifier not found in config |
| `RILL-R053` | Member path not found within the extension dict |

```typescript
import { extResolver, createRuntimeContext } from '@rcrsr/rill';
import { qdrantExtension } from './my-qdrant-ext';

const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: {
      ext: {
        qdrant: qdrantExtension,
      },
    },
  },
});

// Scripts can now use: use<ext:qdrant> or use<ext:qdrant.search>
```

`extResolver` returns `{ kind: 'value', value: RillValue }`.

---

## Factory-Scope Context (`ExtensionFactoryCtx`)

`ExtensionFactoryCtx` is passed as the second argument to async extension factories. It provides pre-execution registration and a lifecycle abort signal.

```typescript
interface ExtensionFactoryCtx {
  registerErrorCode(name: string, kind: string): void;
  readonly signal: AbortSignal;
}

type ExtensionFactory<TConfig> = (
  config: TConfig,
  ctx: ExtensionFactoryCtx
) => ExtensionFactoryResult | Promise<ExtensionFactoryResult>;
```

| Member | Type | Description |
|--------|------|-------------|
| `registerErrorCode` | `(name: string, kind: string) => void` | Register a domain atom (e.g. `"PAYMENT_FAILED"`, `"domain"`). Available as `#NAME` in scripts. |
| `signal` | `AbortSignal` | Fires when the runtime disposes. Use to cancel long-running factory setup. |

> **Note:** The function name `registerErrorCode` is intentionally unchanged per TD-NOD-5. `code` here is an English noun meaning "error code", not a reference to the atom primitive type. The `ExtensionFactoryCtx` method returns `void`; the underlying registry creates a `RillAtom` accessible at runtime as `#NAME` and via the standalone `registerErrorCode` export from `@rcrsr/rill`.

```typescript
async function createPaymentExtension(
  config: PaymentConfig,
  ctx: ExtensionFactoryCtx
): Promise<ExtensionFactoryResult> {
  ctx.registerErrorCode('PAYMENT_FAILED', 'domain');
  ctx.registerErrorCode('CARD_DECLINED', 'domain');

  const client = await PaymentClient.connect(config.endpoint, {
    signal: ctx.signal,
  });

  return {
    value: {
      charge: toCallable({ /* ... */ }),
    },
    dispose: () => client.close(),
  };
}
```

See [Extensions](integration-extensions.md) for registering error codes and returning invalid values.

---

## RuntimeContext Helpers

Three helpers on `RuntimeContext` support error-aware extension functions.

### `ctx.invalidate`

```typescript
invalidate(error: unknown, meta: InvalidateMeta): RillValue
```

Wraps a JavaScript error as an invalid rill value. Returns a `:atom`-tagged invalid value the script can test with `.?` and `.!`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `error` | `unknown` | The caught JavaScript error or any throwable |
| `meta` | `InvalidateMeta` | Metadata: `{ code, provider, raw? }` identifying the failure |

```typescript
fn: async (args, ctx) => {
  try {
    return await sdkClient.fetch(args.url as string);
  } catch (e) {
    return ctx.invalidate(e, { code: 'UNAVAILABLE', provider: 'my-ext' });
  }
},
```

### `ctx.catch`

```typescript
catch<T>(
  thunk: () => Promise<T>,
  detector: (e: unknown) => InvalidMeta | null
): Promise<T | RillValue>
```

Runs `thunk`. On throw, calls `detector(e)`. When `detector` returns `InvalidMeta`, returns an invalid value. When `detector` returns `null`, returns an invalid value with code `#R999`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `thunk` | `() => Promise<T>` | Async operation to attempt |
| `detector` | `(e: unknown) => InvalidMeta \| null` | Maps thrown errors to `InvalidMeta`, or `null` to return an invalid value with code `#R999` |

```typescript
fn: async (args, ctx) => {
  return ctx.catch(
    () => sdkClient.fetch(args.url as string),
    (e) => {
      if (e instanceof TimeoutError) return { code: 'TIMEOUT', provider: 'my-ext' };
      if (e instanceof AuthError) return { code: 'AUTH', provider: 'my-ext' };
      return null; // re-throw unknown errors
    }
  );
},
```

### `ctx.signal`

```typescript
readonly signal: AbortSignal | undefined
```

The `AbortSignal` for the current execution, or `undefined` when no cancellation source is configured. Pass to async I/O operations to propagate cancellation from the script runtime.

```typescript
fn: async (args, ctx) => {
  const response = await fetch(args.url as string, {
    signal: ctx.signal,
  });
  return response.text();
},
```

---

## `dispose()` Lifecycle

`dispose()` is a top-level async function that shuts down the runtime. It is idempotent.

```typescript
function dispose(): Promise<void>
```

Calling `dispose()` fires the `AbortSignal` on all in-flight extension calls. In-flight work receives abort via `AbortSignal.any()` combined with an internal timeout. After the timeout, `dispose()` resolves regardless.

```typescript
import { parse, execute, createRuntimeContext, dispose } from '@rcrsr/rill';

const ctx = createRuntimeContext({ /* ... */ });

try {
  const result = await execute(parse(script), ctx);
  console.log(result.result);
} finally {
  await dispose();
}
```

| Behavior | Detail |
|----------|--------|
| Idempotent | Safe to call multiple times; subsequent calls are no-ops |
| Signal propagation | Fires `AbortSignal` on all registered extension factory contexts |
| In-flight timeout | Uses `AbortSignal.any()` plus a grace-period timeout |

---

## Type System API

`TypeStructure`, `TypeDefinition`, `TypeProtocol`, `RillFieldDef`, and related structural type exports are documented in [Host API Types Reference](ref-host-api-types.md).

## See Also

- [Host Integration](integration-host.md): Embedding guide and runtime configuration
- [Extensions](integration-extensions.md): Reusable function packages
- [Modules](integration-modules.md): Module convention
- [Host API Types](ref-host-api-types.md): TypeStructure, TypeDefinition, TypeProtocol

