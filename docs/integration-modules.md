# rill Module System

*Loading reusable rill scripts via `use<scheme:resource>` expressions*

The `use<>` expression resolves a named resource through a host-registered scheme resolver. The result is the last expression of the loaded script. Modules are plain rill values — dicts, closures, or any other type.

## Syntax

```text
use<module:greetings>
use<module:greetings> => $g
use<module:greetings>($name)
```

The formal grammar:

```text
use-expr = "use" "<" use-id ">" [ ":" type-ref ] ;
use-id   = identifier ":" identifier { "." identifier }   # static form
         | "$" identifier                                  # variable form
         | "(" pipe-chain ")" ;                            # computed form
```

The scheme (`module`) and resource (`greetings`) are separated by `:`. The host registers a resolver for each scheme.

## Module Structure

A module is a rill script whose last expression is its exported value. There is no `export:` frontmatter. The last expression determines what the caller receives.

```rill
|name|"Hello, {$name}!" => $hello
|name|"Goodbye, {$name}!" => $goodbye
dict[hello: $hello, goodbye: $goodbye]
```

The final `dict[...]` is the module value. The host executes the script and binds the result.

## Consumer Pattern

Load a module and call its members:

```text
use<module:greetings> => $g
$g.hello("World")
# Result: "Hello, World!"
```

`$g` is a dict with callable members. Member access follows the same rules as any rill dict.

## Re-export via Dict Composition

Combine multiple modules into a single namespace:

```text
use<module:math> => $math
use<module:string> => $str
dict[math: $math, str: $str] => $utils
$utils.math.double(5)
```

There is no special re-export syntax. Dict composition achieves nested namespaces.

---

## Host Declaration Modules

Some modules are backed by host code rather than rill source. The resolver returns `{ kind: "value", value: ... }` directly:

```text
# Resolver returns a host-constructed dict:
use<http:client> => $http
$http.get("https://api.example.com")
```

The caller cannot distinguish source-backed from value-backed modules.

---

## `moduleResolver` Registration

`moduleResolver` is a built-in scheme resolver exported from `@rcrsr/rill`. It reads rill source files from the filesystem.

### Config shape

```typescript
type ModuleResolverConfig = {
  [moduleId: string]: string;   // Maps module ID to file path
};
```

### Registration

```typescript
import {
  createRuntimeContext,
  execute,
  moduleResolver,
  parse,
} from '@rcrsr/rill';

const ctx = createRuntimeContext({
  resolvers: {
    module: moduleResolver,
  },
  configurations: {
    resolvers: {
      module: {
        greetings: './greet.rill',
        utils: './utils.rill',
      },
    },
  },
  parseSource: parse,
});

const ast = parse(source);
const result = await execute(ast, ctx);
```

`parseSource` is required when any resolver returns `kind: "source"` results. `moduleResolver` always returns source, so it must be provided.

### Return value

`moduleResolver` returns `{ kind: "source", text }` after reading the target file. The runtime parses and executes the text, then binds the last expression as the module value.

### Caching

The runtime does not cache module results between `execute` calls. Implement caching in the host by wrapping the resolver:

```typescript
const cache = new Map<string, import('@rcrsr/rill').RillValue>();

const cachingResolver: import('@rcrsr/rill').SchemeResolver = async (resource, config) => {
  if (cache.has(resource)) {
    return { kind: 'value', value: cache.get(resource)! };
  }
  const result = await moduleResolver(resource, config);
  // Cache after execution — store the value, not the source
  return result;
};
```

For same-run deduplication, the runtime tracks in-flight resolution to detect cycles (see [Circular Resolution](#circular-resolution)).

---

## Custom Resolvers

Any function matching `SchemeResolver` works as a resolver. Register multiple schemes for different resource types:

```typescript
import { createRuntimeContext, parse } from '@rcrsr/rill';
import type { SchemeResolver } from '@rcrsr/rill';

const dbResolver: SchemeResolver = async (resource) => {
  const row = await db.query(`SELECT source FROM modules WHERE id = ?`, [resource]);
  return { kind: 'source', text: row.source };
};

const ctx = createRuntimeContext({
  resolvers: {
    module: moduleResolver,
    db: dbResolver,
  },
  configurations: {
    resolvers: {
      module: { greetings: './greet.rill' },
    },
  },
  parseSource: parse,
});
```

Scripts use each scheme independently:

```text
use<module:greetings> => $g
use<db:templates> => $t
```

---

## Halts inside a module

A halt raised while a module loaded by `use<>` runs passes through `use<>`, `guard`, and `retry`. Wrapping `use<>` in `guard` catches only resolution failures. A source that does not parse halts with `RILL-R056`, which is catchable.

```text
guard { use<module:greetings> } => $g
```

If `module:greetings` divides by zero while loading, the halt propagates out of the `guard`. If the resolver throws or the source is unparseable, `guard` catches `RILL-R056`.

---

## Circular Resolution

The runtime tracks in-flight resolution keys. If module A loads module B which loads module A, the runtime throws `RILL-R055` before infinite recursion occurs.

```text
# module:a contains: use<module:b>
# module:b contains: use<module:a>
# Error: RILL-R055 Circular resolution detected: module:a is already being resolved
```

See [Error Reference](ref-errors.md) for full error details on RILL-R055 and related codes.

---

## Error Reference

| Code | Trigger | Catchable |
|------|---------|-----------|
| `RILL-R050` | Module ID not in `moduleResolver` config; `use<>` surfaces it as `RILL-R056` | Yes |
| `RILL-R051` | File path in config cannot be read; `use<>` surfaces it as `RILL-R056` | Yes |
| `RILL-R054` | Scheme name not registered in `resolvers` | Yes |
| `RILL-R055` | Circular resolution: key already in flight | No |
| `RILL-R056` | Resolver threw, returned a malformed result, or the source failed to parse | Yes |
| `RILL-R058` | Computed `use<>` identifier lacks `:` | Yes |
| `RILL-P020` | Missing `:` after scheme in `use<>` | No (parse error) |
| `RILL-P021` | Missing resource identifier after `:` | No (parse error) |
| `RILL-P022` | Missing `>` to close `use<>` | No (parse error) |

---

## See Also

- [Host Integration](integration-host.md) for `createRuntimeContext` API details
- [Extensions](integration-extensions.md) for packaging reusable host function bundles
- [Error Reference](ref-errors.md) for full error code documentation
