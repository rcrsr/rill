# rill Host Resolver Registration

*Registering scheme resolvers, inspecting runtime values, and accessing host introspection APIs*

## Host Resolver Registration

Register resolvers in `createRuntimeContext()` to handle `use<scheme:resource>` import statements. Scripts use the `scheme` portion to select a resolver, and the `resource` portion is passed to that resolver along with its configuration.

```typescript
import { moduleResolver, extResolver, createRuntimeContext } from '@rcrsr/rill';
import { myQdrantExtension } from './qdrant';

const ctx = createRuntimeContext({
  resolvers: {
    host: moduleResolver,
    ext: extResolver,
  },
  configurations: {
    resolvers: {
      host: {
        utils: './utils.rill',
      },
      ext: {
        qdrant: myQdrantExtension,
      },
    },
  },
});
```

Scripts import resources using the `use<scheme:resource>` syntax:

```text
use<host:utils>
use<ext:qdrant>
use<ext:qdrant.search>
```

Two built-in resolvers are available:

| Resolver | Import | Purpose |
|----------|--------|---------|
| `moduleResolver` | `import { moduleResolver } from '@rcrsr/rill'` | Maps module IDs to rill source files |
| `extResolver` | `import { extResolver } from '@rcrsr/rill'` | Maps extension IDs to pre-built rill value dicts |

### RuntimeOptions Fields

These two fields in `createRuntimeContext()` control resolver registration:

| Field | Type | Description |
|-------|------|-------------|
| `resolvers` | `Record<string, SchemeResolver> \| undefined` | Scheme-to-resolver map for `use<scheme:...>` imports |
| `configurations` | `{ resolvers?: Record<string, unknown> } \| undefined` | Per-scheme config data passed to each resolver |

### Custom Resolvers

Implement `SchemeResolver` to handle any custom scheme:

```typescript
import type { SchemeResolver } from '@rcrsr/rill';

const myResolver: SchemeResolver = async (resource, config) => {
  const source = await loadSource(resource);
  return { kind: 'source', text: source };
};

const ctx = createRuntimeContext({
  resolvers: { custom: myResolver },
  configurations: {
    resolvers: {
      custom: { /* your config */ },
    },
  },
});
```

See [SchemeResolver](ref-host-api.md#schemeresolver) and [ResolverResult](ref-host-api.md#resolverresult) in the API reference for full type details.

### moduleResolver

`moduleResolver` maps module identifiers to rill source files on disk.

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

`moduleResolver` returns `{ kind: 'source', text: string }` after reading the target file. Paths resolve relative to the config file's directory.

### extResolver

`extResolver` maps extension identifiers to pre-built rill value dicts.

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

`extResolver` returns `{ kind: 'value', value: RillValue }`.

### ext::fn() Compatibility

The `ext::fn()` calling pattern is retained for compatibility but is not recommended for new code. In `strict` checker mode, `ext::fn()` calls are flagged. Use `use<ext:...>` imports instead.

---

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

### Callable Introspection: .^input and .^output

All callable kinds expose their parameter and return type shapes via `.^input` and `.^output`.

**`.^input`** returns a `RillOrdered` value. Each entry is a `[paramName, RillTypeValue]` pair, preserving parameter declaration order. `.^input` works on all callable kinds — script closures, application callables, and runtime callables.

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

---

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

---

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

---

## See Also

| Document | Description |
|----------|-------------|
| [Host Integration](integration-host.md) | Full runtime configuration and embedding guide |
| [Host API Reference](ref-host-api.md) | `SchemeResolver`, `ResolverResult`, and all exports |
| [Modules](integration-modules.md) | Module convention for rill source files |
| [Extensions](integration-extensions.md) | Building reusable extension packages |
