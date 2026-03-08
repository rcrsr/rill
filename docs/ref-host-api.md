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
  console.log('Result:', result.result);
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
export { isArgs, isDict, isReservedMethod, RESERVED_DICT_METHODS };
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

### LlmExtensionContract

Contract type for LLM extension implementations. Backend authors use this type to verify compile-time compatibility.

```typescript
type LlmExtensionContract = {
  readonly message: HostFunctionDefinition;
  readonly messages: HostFunctionDefinition;
  readonly embed: HostFunctionDefinition;
  readonly embed_batch: HostFunctionDefinition;
  readonly tool_loop: HostFunctionDefinition;
  readonly generate: HostFunctionDefinition;
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
  readonly upsert: HostFunctionDefinition;
  readonly upsert_batch: HostFunctionDefinition;
  readonly search: HostFunctionDefinition;
  readonly get: HostFunctionDefinition;
  readonly delete: HostFunctionDefinition;
  readonly delete_batch: HostFunctionDefinition;
  readonly count: HostFunctionDefinition;
  readonly create_collection: HostFunctionDefinition;
  readonly delete_collection: HostFunctionDefinition;
  readonly list_collections: HostFunctionDefinition;
  readonly describe: HostFunctionDefinition;
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

## RillStructuralType

`RillStructuralType` is a discriminated union that describes the structural shape of any rill value. The runtime uses it for type checking, type inference, and formatting.

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

The `type` field is the discriminator. Leaf variants (`number`, `string`, `bool`, `vector`, `type`, `any`) carry no sub-fields. Compound variants carry optional sub-fields — absent sub-fields match any value of that compound type.

### Field Constraints

| Variant | Field | Type | Required | Semantics |
|---------|-------|------|----------|-----------|
| `dict` | `fields` | `Record<string, RillStructuralType>` | No | Absent = any dict |
| `list` | `element` | `RillStructuralType` | No | Absent = any list |
| `closure` | `params` | `[string, RillStructuralType][]` | No | Absent = any closure |
| `closure` | `ret` | `RillStructuralType` | No | Absent = any return type |
| `tuple` | `elements` | `RillStructuralType[]` | No | Absent = any tuple |
| `ordered` | `fields` | `[string, RillStructuralType][]` | No | Absent = any ordered |

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
export type { RillStructuralType, RillFieldDescriptor };
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
inferStructuralType(value: RillValue): RillStructuralType
```

Returns the structural type descriptor for any rill value. Primitive values return leaf variants. Compound values return their respective variants with sub-fields populated from the value's actual structure. Callable values return `{ type: 'closure' }` with `params` and `ret` populated.

Pure function. Result is a frozen object.

### `inferElementType`

```typescript
inferElementType(elements: RillValue[]): RillStructuralType
```

Infers the element type for a homogeneous list. All elements must share the same structural type (verified via `structuralTypeEquals`).

| Input | Result |
|-------|--------|
| Empty array | `{ type: 'any' }` |
| Uniform-type array | Structural type of the common element |
| Mixed-type array | Throws `RILL-R002` |

### `structuralTypeEquals`

```typescript
structuralTypeEquals(a: RillStructuralType, b: RillStructuralType): boolean
```

Compares two structural types for deep structural equality. Switches on the `type` discriminator. Leaf variants compare by `type` alone. Compound variants compare sub-fields recursively.

Pure function. Variants with different `type` values always return `false`. Absent sub-fields on compound variants are equal to other absent sub-fields.

### `structuralTypeMatches`

```typescript
structuralTypeMatches(value: RillValue, type: RillStructuralType): boolean
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
formatStructuralType(type: RillStructuralType): string
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
  structuralType: RillStructuralType & { type: 'dict' },
  fieldName: string,
  location: SourceLocation
): RillFieldDescriptor
```

Builds a frozen `RillFieldDescriptor` for a named field within a structural dict type.

`structuralType` must narrow to `{ type: 'dict' }` at the call site. `structuralType.fields` must contain `fieldName` or `RILL-R003` is thrown.

### `paramsToStructuralType`

```typescript
paramsToStructuralType(params: CallableParam[]): RillStructuralType
```

Builds a `RillStructuralType` closure variant from a closure's parameter list. Return type is always `{ type: 'any' }`. Result is a frozen object.

| Param shape | Maps to |
|-------------|---------|
| Parameterized typed param (`typeStructure` present) | The full `RillStructuralType` from `param.typeStructure` |
| Bare typed param (`typeName` non-null, no `typeStructure`) | `{ type: param.typeName }` |
| Untyped param (`typeName: null`) | `{ type: 'any' }` |

When the script closure uses parameterized annotations (`|x: list(string)|`), the `typeStructure` field carries the full structural type. The resulting `.^input` structure on the host side reflects the full parameterized shape:

```typescript
// Script: |x: list(string), y: number| { $x }
// entries[0][1].structure -> { type: 'list', element: { type: 'string' } }
// entries[1][1].structure -> { type: 'number' }
```

---

## See Also

- [Host Integration](integration-host.md) — Embedding guide and runtime configuration
- [Extensions](integration-extensions.md) — Reusable function packages
- [Modules](integration-modules.md) — Module convention

