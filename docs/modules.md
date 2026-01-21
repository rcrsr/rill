# Module Convention

This guide describes a convention for hosts implementing module support in Rill scripts. Modules enable code reuse across scripts while preserving Rill's core principle: **frontmatter is opaque to Rill**.

The convention defines:
- Frontmatter keys (`use`, `export`) for declaring dependencies and public APIs
- Path prefixes (`@core/`, `@host/`, relative) for module resolution
- Host responsibilities for loading, caching, and binding modules

Rill itself does not interpret these keys. The host parses frontmatter and provides resolved modules via the `variables` option.

## Design Principles

1. **Modules are dicts** — No new type; exports are dict members
2. **Host-provided resolution** — Host parses frontmatter and resolves paths
3. **Pipe-compatible** — Modules export values (closures, literals), not side effects
4. **Explicit over implicit** — No auto-imports or magic globals
5. **Namespace alignment** — Uses existing `$namespace.member` pattern

## Syntax Overview

```text
---
use:
  - math: "./utils/math.rill"
  - str: "@core/string"
  - http: "@host/http"
---

5 -> $math.double()
"hello" -> $str.reverse()
$http.get("https://api.example.com")
```

The host:
1. Parses frontmatter YAML
2. Extracts `use` declarations
3. Resolves each specifier to a module
4. Passes resolved modules via `createRuntimeContext({ variables: { math, str, http } })`

Rill sees `$math`, `$str`, `$http` as regular variables containing dicts.

## Import Declaration

Imports appear in frontmatter under the `use` key:

```yaml
---
use:
  - math: "./utils/math.rill"
  - m: "./utils/math.rill"      # Same module, different name
---
```

All imports require a name (the key before the colon). This ensures:
- Clear origin of every symbol (`$math.double` vs bare `$double`)
- No hidden name collisions
- Grep-friendly code (search for `$math.` finds all usages)

### Path Prefixes

| Prefix | Meaning | Resolution |
|--------|---------|------------|
| `./` or `../` | Relative path | Host filesystem |
| `@core/` | Core modules | Host-provided standard library |
| `@host/` | Host modules | Host-specific functionality |
| `name` (bare) | Registry package | Host package resolver |

## Export Declaration

Scripts export values via the `export` frontmatter key:

```text
---
export:
  - double
  - triple
  - constants
---

|x|($x * 2) -> $double
|x|($x * 3) -> $triple
[pi: 3.14159, e: 2.71828] -> $constants
```

The host:
1. Executes the script
2. Reads the `export` list from frontmatter
3. Extracts named variables from the execution result
4. Returns them as a dict

## Module Structure

A module is a Rill script with frontmatter declaring exports:

```text
# utils/math.rill
---
export:
  - double
  - triple
  - clamp
  - constants
---

# Closure exports
|x|($x * 2) -> $double
|x|($x * 3) -> $triple
|x, min, max|{
  ($x < $min) ? $min ! ($x > $max) ? $max ! $x
} -> $clamp

# Literal exports (dicts, lists, numbers, strings)
[pi: 3.14159, e: 2.71828, phi: 1.61803] -> $constants
```

Usage:

```text
---
use:
  - math: "./utils/math.rill"
---

$math.double(5)          # 10
$math.constants.pi       # 3.14159
$math.constants -> .keys # ["pi", "e", "phi"]
```

## Import Binding

A module's exports form a dict. The host binds this dict to the import name:

```text
---
use:
  - math: "./utils/math.rill"
---

# $math is a dict: [double: closure, triple: closure, clamp: closure, constants: dict]
$math.double(5)         # 10
$math.clamp(15, 0, 10)  # 10
$math.constants.pi      # 3.14159

# Standard dict operations work
$math -> .keys          # ["double", "triple", "clamp", "constants"]
$math -> type           # "dict"
```

This aligns with Rill's existing patterns:
- Dict callables with `$obj.method()` syntax
- Host variables via `createRuntimeContext({ variables: { namespace: { fn: callable(...) } } })`
- No new concepts—modules are dicts, exports are members

## Host Implementation

### Core Types

```typescript
type ModuleResolver = (
  specifier: string,
  fromPath: string
) => Promise<ModuleResult>;

interface ModuleResult {
  exports: Record<string, RillValue>;
  path: string;  // Canonical path for caching
}
```

### Minimal Implementation

```typescript
import { parse, execute, createRuntimeContext, callable } from '@rcrsr/rill';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

async function loadModule(
  specifier: string,
  fromPath: string,
  cache: Map<string, Record<string, RillValue>>
): Promise<Record<string, RillValue>> {
  // Resolve path
  const absolutePath = path.resolve(path.dirname(fromPath), specifier);

  // Check cache
  if (cache.has(absolutePath)) {
    return cache.get(absolutePath)!;
  }

  // Load and parse
  const source = await fs.readFile(absolutePath, 'utf-8');
  const ast = parse(source);

  // Extract frontmatter
  const frontmatter = ast.frontmatter
    ? yaml.parse(ast.frontmatter.content)
    : {};

  // Resolve dependencies first
  const imports: Record<string, RillValue> = {};
  if (frontmatter.use) {
    for (const entry of frontmatter.use) {
      const [name, depPath] = Object.entries(entry)[0] as [string, string];
      imports[name] = await loadModule(depPath, absolutePath, cache);
    }
  }

  // Execute module
  const ctx = createRuntimeContext({ variables: imports });
  const result = await execute(ast, ctx);

  // Extract exports
  const exports: Record<string, RillValue> = {};
  const exportList: string[] = frontmatter.export ?? [];
  for (const name of exportList) {
    if (result.variables[name] !== undefined) {
      exports[name] = result.variables[name];
    }
  }

  cache.set(absolutePath, exports);
  return exports;
}

// Usage
async function runScript(entryPath: string) {
  const cache = new Map();
  const source = await fs.readFile(entryPath, 'utf-8');
  const ast = parse(source);

  const frontmatter = ast.frontmatter
    ? yaml.parse(ast.frontmatter.content)
    : {};

  // Load imports
  const variables: Record<string, RillValue> = {};
  if (frontmatter.use) {
    for (const entry of frontmatter.use) {
      const [name, specifier] = Object.entries(entry)[0] as [string, string];
      variables[name] = await loadModule(specifier, entryPath, cache);
    }
  }

  const ctx = createRuntimeContext({ variables });
  return execute(ast, ctx);
}
```

### Circular Import Detection

Track the import chain to detect cycles:

```typescript
async function loadModule(
  specifier: string,
  fromPath: string,
  cache: Map<string, Record<string, RillValue>>,
  chain: Set<string> = new Set()
): Promise<Record<string, RillValue>> {
  const absolutePath = path.resolve(path.dirname(fromPath), specifier);

  if (chain.has(absolutePath)) {
    const cycle = [...chain, absolutePath].join(' -> ');
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  if (cache.has(absolutePath)) {
    return cache.get(absolutePath)!;
  }

  chain.add(absolutePath);
  // ... load and execute ...
  chain.delete(absolutePath);

  cache.set(absolutePath, exports);
  return exports;
}
```

### Host Functions with Namespaces

For host-specific functionality, you can use namespaced functions with `::` syntax instead of the module convention. This is simpler when you don't need the full module system:

```typescript
const ctx = createRuntimeContext({
  functions: {
    'http::get': async (args) => {
      const response = await fetch(String(args[0]));
      return response.text();
    },
    'http::post': async (args) => {
      const response = await fetch(String(args[0]), {
        method: 'POST',
        body: String(args[1]),
      });
      return response.text();
    },
    'fs::read': async (args) => fs.readFile(String(args[0]), 'utf-8'),
    'fs::write': async (args) => {
      await fs.writeFile(String(args[0]), String(args[1]));
      return true;
    },
  },
});
```

Scripts call these directly:

```text
http::get("https://api.example.com") -> parse_json
fs::read("config.json") -> parse_json -> $config
```

### Host Modules (@host/) — Alternative

For more complex scenarios, register host modules as dicts with callable members:

```typescript
import { callable } from '@rcrsr/rill';

const hostModules: Record<string, Record<string, RillValue>> = {
  '@host/http': {
    get: callable(async (args) => {
      const response = await fetch(String(args[0]));
      return response.text();
    }),
    post: callable(async (args) => {
      const response = await fetch(String(args[0]), {
        method: 'POST',
        body: String(args[1]),
      });
      return response.text();
    }),
  },
  '@host/fs': {
    read: callable(async (args) => fs.readFile(String(args[0]), 'utf-8')),
    write: callable(async (args) => {
      await fs.writeFile(String(args[0]), String(args[1]));
      return true;
    }),
  },
};

// In resolver
if (specifier.startsWith('@host/')) {
  return hostModules[specifier] ?? {};
}
```

This approach requires the `$` prefix (`$http.get()`) but allows passing modules as values.

### Core Modules (@core/)

Suggested standard library modules (host-provided):

| Module | Exports |
|--------|---------|
| `@core/string` | `reverse`, `capitalize`, `words`, `lines` |
| `@core/list` | `sort`, `reverse`, `unique`, `flatten` |
| `@core/math` | `abs`, `min`, `max`, `floor`, `ceil`, `round` |
| `@core/json` | `parse`, `stringify`, `pretty` |

Hosts can implement these in Rill or TypeScript. Consistency across hosts improves script portability.

## Examples

### Basic Module

```text
# greet.rill
---
export:
  - hello
  - goodbye
---

|name|"Hello, {$name}!" -> $hello
|name|"Goodbye, {$name}!" -> $goodbye
```

### Using a Module

```text
---
use:
  - greet: "./greet.rill"
---

"World" -> $greet.hello() -> log
# Output: Hello, World!
```

### Re-exporting

Imported modules can be re-exported:

```text
# utils/index.rill
---
use:
  - math: "./math.rill"
  - str: "./string.rill"
export:
  - math
  - str
---
```

The importing script sees nested namespaces:

```text
---
use:
  - utils: "./utils/index.rill"
---

5 -> $utils.math.double()
"hello" -> $utils.str.reverse()
```

### Private Helpers

Non-exported variables remain private:

```text
---
export:
  - processAll
---

# Private helper (not exported)
|item|{
  $item -> .upper -> .trim
} -> $normalizeItem

# Public function using private helper
|items|{
  $items -> map $normalizeItem
} -> $processAll
```

## Module Loading Phases

1. **Parse** — Parse source, extract frontmatter as raw YAML
2. **Resolve** — Host resolves import specifiers to paths
3. **Load** — Recursively load dependencies (detect cycles)
4. **Execute** — Execute module body, collect variables
5. **Extract** — Build export dict from `export` list
6. **Bind** — Pass to importing script via `variables` option

### Caching

Cache modules by canonical path. Same module imported multiple times shares the same export object:

```text
# Both reference the same loaded module
---
use:
  - a: "./utils/math.rill"
  - b: "../project/utils/math.rill"  # Same canonical path
---

$a == $b    # true (same export object)
```

## Design Rationale

### Why Frontmatter?

Alternatives considered:

**Import statements** (`import math from "./math.rill"`)
- Rejected: Introduces new statement type. Frontmatter keeps imports declarative and separate from executable code.

**Pipe-based imports** (`"./math.rill" -> import -> $math`)
- Rejected: Imports are static metadata, not runtime operations.

**Global registry** (`$modules.math.double(5)`)
- Rejected: Creates implicit global state. Explicit imports are clearer.

### Why Host-Managed?

Keeping module resolution in the host:
- Preserves "frontmatter is opaque" principle
- Allows hosts to customize resolution (virtual modules, access control, caching)
- Keeps Rill runtime dependency-free
- Enables different hosts to support different module ecosystems

## Open Questions

### Selective Imports

Should scripts import specific members?

```yaml
use:
  - double: "./math.rill".double
```

**Recommendation:** Defer. Full-module imports are simpler and grep-friendly.

### Version Constraints

Should specifiers support versions?

```yaml
use:
  - lodash: "lodash@^4.0.0"
```

**Recommendation:** Leave to host/registry. Specifiers pass through verbatim.

### Type Exports

Should modules export type information?

**Recommendation:** Defer. Types are not enforced at runtime; tooling can infer from execution.
