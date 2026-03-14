# rill Host API Reference

*Complete TypeScript API for embedding rill in applications*

## Complete Example

```typescript
import {
  parse,
  execute,
  createRuntimeContext,
  callable,
  rillTypeToTypeValue,
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
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: async (args, ctx, location) => {
        console.log(`[prompt at line ${location?.line}]`);
        return await callLLM(args.text);
      },
      annotations: { description: 'Send a prompt to the LLM and return the response' },
      returnType: rillTypeToTypeValue({ type: 'string' }),
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
export type { RillType };
export type { RillTypeValue };
export type { RillStructuralType };  // deprecated alias for RillType

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

// Extension contracts
export type { KvExtensionContract, FsExtensionContract, LlmExtensionContract, VectorExtensionContract, SchemaEntry };
```

## NativeResult

`toNative(value: RillValue): NativeResult` converts any rill value to a host-consumable structure.

```typescript
interface NativeResult {
  /** Base rill type name — matches RillTypeName, or "iterator" for lazy sequences */
  rillTypeName: string;
  /** Full structural signature from formatStructuralType,
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

See [Host Integration](integration-host.md) for conversion examples and migration guidance.

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

**7 tokens added:**

| Token | Category | Syntax |
|-------|----------|--------|
| `LIST_LBRACKET` | `keyword` | `list[` |
| `DICT_LBRACKET` | `keyword` | `dict[` |
| `TUPLE_LBRACKET` | `keyword` | `tuple[` |
| `ORDERED_LBRACKET` | `keyword` | `ordered[` |
| `DESTRUCT_LANGLE` | `keyword` | `destruct<` |
| `SLICE_LANGLE` | `keyword` | `slice<` |
| `CONVERT` | `operator` | `:>` |

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

## Extension Contracts

### KvExtensionContract

Contract type for key-value extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type KvExtensionContract = {
  readonly get: RillFunction;
  readonly get_or: RillFunction;
  readonly set: RillFunction;
  readonly merge: RillFunction;
  readonly delete: RillFunction;
  readonly keys: RillFunction;
  readonly has: RillFunction;
  readonly clear: RillFunction;
  readonly getAll: RillFunction;
  readonly schema: RillFunction;
  readonly mounts: RillFunction;
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
  readonly read: RillFunction;
  readonly write: RillFunction;
  readonly append: RillFunction;
  readonly list: RillFunction;
  readonly find: RillFunction;
  readonly exists: RillFunction;
  readonly remove: RillFunction;
  readonly stat: RillFunction;
  readonly mkdir: RillFunction;
  readonly copy: RillFunction;
  readonly move: RillFunction;
  readonly mounts: RillFunction;
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

### LlmExtensionContract

Contract type for LLM extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type LlmExtensionContract = {
  readonly message: RillFunction;
  readonly messages: RillFunction;
  readonly embed: RillFunction;
  readonly embed_batch: RillFunction;
  readonly tool_loop: RillFunction;
  readonly generate: RillFunction;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};
```

**Required Functions (6 total):**

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `message` | `(text: string, options?: dict)` | `dict` | Send single message |
| `messages` | `(messages: list, options?: dict)` | `dict` | Multi-turn conversation |
| `embed` | `(text: string)` | `vector` | Generate embedding vector |
| `embed_batch` | `(texts: list)` | `list` | Batch embeddings |
| `tool_loop` | `(prompt: string, options?: dict)` | `dict` | Tool use orchestration; `options.tools` is `dict<string, ScriptCallable \| ApplicationCallable>` — keys are tool names, values are callables (`RuntimeCallable` is rejected) |
| `generate` | `(prompt: string, options: dict)` | `dict` | Structured output extraction |

**Usage:**

```typescript
import type { LlmExtensionContract } from '@rcrsr/rill';
import { createMyLlmBackend } from './my-llm-backend';

// Type-check backend implementation
const backend: LlmExtensionContract = createMyLlmBackend({ /* config */ });
```

### VectorExtensionContract

Contract type for vector database extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type VectorExtensionContract = {
  readonly upsert: RillFunction;
  readonly upsert_batch: RillFunction;
  readonly search: RillFunction;
  readonly get: RillFunction;
  readonly delete: RillFunction;
  readonly delete_batch: RillFunction;
  readonly count: RillFunction;
  readonly create_collection: RillFunction;
  readonly delete_collection: RillFunction;
  readonly list_collections: RillFunction;
  readonly describe: RillFunction;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};
```

**Required Functions (11 total):**

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `upsert` | `(id: string, vector: vector, metadata?: dict)` | `dict` | Insert or update vector |
| `upsert_batch` | `(items: list)` | `dict` | Batch insert/update |
| `search` | `(vector: vector, options?: dict)` | `list` | Search k nearest neighbors |
| `get` | `(id: string)` | `dict` | Fetch vector by ID |
| `delete` | `(id: string)` | `dict` | Delete vector by ID |
| `delete_batch` | `(ids: list)` | `dict` | Batch delete |
| `count` | `()` | `number` | Count vectors in collection |
| `create_collection` | `(name: string, options?: dict)` | `dict` | Create collection |
| `delete_collection` | `(name: string)` | `dict` | Delete collection |
| `list_collections` | `()` | `list` | List all collections |
| `describe` | `()` | `dict` | Get collection metadata |

**Usage:**

```typescript
import type { VectorExtensionContract } from '@rcrsr/rill';
import { createMyVectorBackend } from './my-vector-backend';

// Type-check backend implementation
const backend: VectorExtensionContract = createMyVectorBackend({ /* config */ });
```

## RillParam

`RillParam` is the unified parameter descriptor for host functions and script closures.

```typescript
interface RillParam {
  readonly name: string;
  readonly type: RillType | undefined;
  readonly defaultValue: RillValue | undefined;
  readonly annotations: Record<string, RillValue>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `RillType \| undefined` | Structural type descriptor. `undefined` = any type (no validation) |
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

**Returns:** `RillValue` or `Promise<RillValue>`.

**Migration note:** The `args` parameter changed from `RillValue[]` (positional) to `Record<string, RillValue>` (named). Replace `args[0]` with `args.paramName` for each parameter. Untyped callables created via `callable()` (where `params` is `undefined`) bypass marshaling and still receive `RillValue[]` — their internal type cast is unchanged.

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

## RillStructuralType

**Note:** `RillType` is the canonical name. `RillStructuralType` is a deprecated alias that will be removed in a future major version.

`RillType` is a discriminated union that describes the structural shape of any rill value. The runtime uses it for type checking, type inference, and formatting.

```typescript
// Canonical type
type RillType =
  | { type: 'number' }
  | { type: 'string' }
  | { type: 'bool' }
  | { type: 'vector' }
  | { type: 'type' }
  | { type: 'any' }
  | { type: 'dict';    fields?: Record<string, RillType> }
  | { type: 'list';    element?: RillType }
  | { type: 'closure'; params?: [string, RillType][]; ret?: RillType }
  | { type: 'tuple';   elements?: RillType[] }
  | { type: 'ordered'; fields?: [string, RillType][] }
  | { type: 'union';   members: RillType[] };

// Deprecated alias — same type
type RillStructuralType = RillType;
```

The `type` field is the discriminator. Leaf variants (`number`, `string`, `bool`, `vector`, `type`, `any`) carry no sub-fields. Compound variants carry optional sub-fields — absent sub-fields match any value of that compound type.

### Field Constraints

| Variant | Field | Type | Required | Semantics |
|---------|-------|------|----------|-----------|
| `dict` | `fields` | `Record<string, RillType>` | No | Absent = any dict |
| `list` | `element` | `RillType` | No | Absent = any list |
| `closure` | `params` | `[string, RillType][]` | No | Absent = any closure |
| `closure` | `ret` | `RillType` | No | Absent = any return type |
| `tuple` | `elements` | `RillType[]` | No | Absent = any tuple |
| `ordered` | `fields` | `[string, RillType][]` | No | Absent = any ordered |
| `union` | `members` | `RillType[]` | Yes | Non-empty array of member types |

### Breaking Change: `kind` Removed

Prior versions used a `kind` field as the discriminator. That shape is removed. Update all code that reads `kind`, `name`, or checks for a `primitive` variant.

| Old Shape | New Shape |
|-----------|-----------|
| `{ kind: 'primitive', name: 'string' }` | `{ type: 'string' }` |
| `{ kind: 'primitive', name: 'number' }` | `{ type: 'number' }` |
| `{ kind: 'primitive', name: 'bool' }` | `{ type: 'bool' }` |
| `{ kind: 'list', element: T }` | `{ type: 'list', element?: T }` |
| `{ kind: 'dict', fields: F }` | `{ type: 'dict', fields?: F }` |
| `{ kind: 'closure', params: P, ret: R }` | `{ type: 'closure', params?: P, ret?: R }` |
| `{ kind: 'tuple', elements: E }` | `{ type: 'tuple', elements?: E }` |
| `{ kind: 'ordered', fields: F }` | `{ type: 'ordered', fields?: F }` |
| `{ kind: 'any' }` | `{ type: 'any' }` |

### Exports

```typescript
// Structural type system
export type { RillType, RillFieldDescriptor };
export type { RillStructuralType };  // deprecated alias for RillType
export {
  inferStructuralType,
  inferElementType,
  structuralTypeEquals,
  structuralTypeMatches,
  formatStructuralType,
  buildFieldDescriptor,
  paramsToStructuralType,
};
```

### `inferStructuralType`

```typescript
inferStructuralType(value: RillValue): RillType
```

Returns the structural type descriptor for any rill value. Primitive values return leaf variants. Compound values return their respective variants with sub-fields populated from the value's actual structure. Callable values return `{ type: 'closure' }` with `params` and `ret` populated.

Pure function. Result is a frozen object.

### `inferElementType`

```typescript
inferElementType(elements: RillValue[]): RillType
```

Infers the element type for a homogeneous list. All elements must share the same structural type (verified via `structuralTypeEquals`).

| Input | Result |
|-------|--------|
| Empty array | `{ type: 'any' }` |
| Uniform-type array | Structural type of the common element |
| Mixed-type array | Throws `RILL-R002` |

### `structuralTypeEquals`

```typescript
structuralTypeEquals(a: RillType, b: RillType): boolean
```

Compares two structural types for deep structural equality. Switches on the `type` discriminator. Leaf variants compare by `type` alone. Compound variants compare sub-fields recursively.

Pure function. Variants with different `type` values always return `false`. Absent sub-fields on compound variants are equal to other absent sub-fields.

### `structuralTypeMatches`

```typescript
structuralTypeMatches(value: RillValue, type: RillType): boolean
```

Checks if a value matches a structural type descriptor. Used by the `:?` runtime type check operator.

| Type descriptor | Matching behavior |
|-----------------|-------------------|
| `{ type: 'any' }` | Matches all values |
| Compound with absent sub-fields | Matches any value of that compound type |
| Compound with sub-fields present | Deep structural match against sub-fields |

Pure function.

### `formatStructuralType`

```typescript
formatStructuralType(type: RillType): string
```

Formats a structural type descriptor as a human-readable string.

| Input | Output |
|-------|--------|
| `{ type: 'number' }` | `"number"` |
| `{ type: 'string' }` | `"string"` |
| `{ type: 'bool' }` | `"bool"` |
| `{ type: 'any' }` | `"any"` |
| `{ type: 'list' }` | `"list"` |
| `{ type: 'list', element: { type: 'number' } }` | `"list(number)"` |
| `{ type: 'dict' }` | `"dict"` |
| `{ type: 'dict', fields: { x: { type: 'number' } } }` | `"dict(x: number)"` |
| `{ type: 'closure' }` | `"closure"` |
| `{ type: 'closure', params: [['x', { type: 'number' }]], ret: { type: 'string' } }` | `"\|x: number\| :string"` |
| `{ type: 'closure', params: [['$', { type: 'list', element: { type: 'string' } }]], ret: { type: 'any' } }` | `"\|$: list(string)\| :any"` |

Absent sub-fields on compound variants format as the bare type name.

### `buildFieldDescriptor`

```typescript
buildFieldDescriptor(
  structuralType: RillType & { type: 'dict' },
  fieldName: string,
  location: SourceLocation
): RillFieldDescriptor
```

Builds a frozen `RillFieldDescriptor` for a named field within a structural dict type.

`structuralType` must narrow to `{ type: 'dict' }` at the call site. `structuralType.fields` must contain `fieldName` or `RILL-R003` is thrown.

### `paramsToStructuralType`

```typescript
paramsToStructuralType(params: RillParam[]): RillType
```

Builds a `RillType` closure variant from a parameter list. Return type is always `{ type: 'any' }`. Result is a frozen object.

| Param shape | Maps to |
|-------------|---------|
| `param.type` defined | The `RillType` from `param.type` |
| `param.type` undefined | `{ type: 'any' }` |

---

## See Also

- [Host Integration](integration-host.md) — Embedding guide and runtime configuration
- [Extensions](integration-extensions.md) — Reusable function packages
- [Modules](integration-modules.md) — Module convention

