# rill Core Language Specification

*Sandboxed scripting to power AI agents*

rill is an embeddable, sandboxed scripting language designed for AI agents.

> **Experimental.** Active development. Breaking changes will occur before stabilization.

## Overview

rill is an imperative scripting language that is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught—there are no implicit conversions. Type annotations are optional, but variables lock their type on first assignment. The language is value-based: no references, all copies are deep, all comparisons are by value. Empty values are valid (empty strings, lists, dicts), but null and undefined do not exist. Control flow is singular: no exceptions, no try/catch. Data flows through pipes (`->`), not assignment.

## Design Principles

For design principles, see [Design Principles](topic-design-principles.md).

---

## Quick Reference Tables

### Expression Delimiters

| Delimiter | Semantics | Produces |
|-----------|-----------|----------|
| `{ body }` | Deferred (closure creation) | `ScriptCallable` |
| `( expr )` | Eager (immediate evaluation) | Result value |

### Operators

| Category | Operators |
|----------|-----------|
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Comparison | `.eq`, `.ne`, `.lt`, `.gt`, `.le`, `.ge` methods |
| Logical | `!` (unary), `&&`, `\|\|` |
| Pipe | `->` |
| Capture | `=>` |
| Spread | `@` (sequential), `*` (tuple) |
| Extraction | `*<>` (destructure), `/<>` (slice) |
| Type | `:type` (assert), `:?type` (check), `:$var` (shape assert), `:?$var` (shape check), `:shape(...)` (inline assert), `:?shape(...)` (inline check) |
| Member | `.field`, `[index]` |
| Default | `?? value` |
| Existence | `.?field`, `.?$var`, `.?($expr)`, `.?field&type` |

See [Operators](topic-operators.md) for detailed documentation.

### Control Flow

| Syntax | Description |
|--------|-------------|
| `cond ? then ! else` | Conditional (if-else, supports multi-line) |
| `$val -> ? then ! else` | Piped conditional ($ as condition, supports multi-line) |
| `(cond) @ body` | While loop |
| `@ body ? cond` | Do-while |
| `break` / `$val -> break` | Exit loop |
| `return` / `$val -> return` | Exit block or script |
| `pass` | Returns current `$` unchanged (use in conditionals, dicts) |
| `assert cond` / `assert cond "msg"` | Validate condition, halt on failure |
| `error "msg"` / `$val -> error` | Halt execution with error message |

See [Control Flow](topic-control-flow.md) for detailed documentation. Script-level exit functions must be host-provided.

### Collection Operators

| Syntax | Description |
|--------|-------------|
| `-> each { body }` | Sequential iteration, all results |
| `-> each(init) { body }` | Sequential with accumulator (`$@`) |
| `-> map { body }` | Parallel iteration, all results |
| `-> filter { cond }` | Parallel filter, matching elements |
| `-> fold(init) { body }` | Sequential reduction, final result |

See [Collections](topic-collections.md) for detailed documentation.

### Types

| Type | Syntax | Example | Produces |
|------|--------|---------|----------|
| String | `"text"`, `"""text"""` | `"hello"`, `"""line 1\nline 2"""` | String value |
| Number | `123`, `0.5` | `42`, `0.9` | Number value |
| Bool | `true`, `false` | `true` | Boolean value |
| List | `[a, b]`, `[...$list]` | `["file.ts", 42]`, `[...$a, 3]` | List value |
| Dict | `[k: v]`, `[$k: v]`, `[($e): v]` | `[output: "text"]`, `[$key: 1]` | Dict value |
| Tuple | `*[...]` | `*[1, 2]`, `*[x: 1, y: 2]` | Tuple value |
| Vector | host-provided | `app::embed("text")` | Vector value |
| Closure | `\|\|{ }` | `\|x\|($x * 2)` | `ScriptCallable` |
| Shape | `shape(field: type)` | `shape(name: string)` | Shape value |
| Block | `{ body }` | `{ $ + 1 }` | `ScriptCallable` |

**Type names** (valid in `:type` assertions, `:?type` checks, and parameter annotations): `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `vector`, `shape`, `any`

See [Types](topic-types.md) for detailed documentation.

### Functions

| Syntax | Description |
|--------|-------------|
| `\|p: type\|{ } => $fn` | Define and capture function |
| `\|p: type\| -> rtype { }` | Define with return type metadata (host API only) |
| `\|p = default\|{ }` | Parameter with default |
| `\|^(min: 0) p\|{ }` | Parameter with annotation |
| `$fn(arg)` | Call function directly |
| `arg -> $fn()` | Call function with pipe value |
| `arg -> $fn` | Pipe-style invoke |

See [Closures](topic-closures.md) for detailed documentation.

### Special Variables

| Variable | Contains | Source |
|----------|----------|--------|
| `$` | Piped value (current scope) | Grammar |
| `$ARGS` | CLI positional args (list) | Runtime |
| `$ENV.NAME` | Environment variable | Runtime |
| `$name` | Named variable | Runtime |

See [Variables](topic-variables.md) for detailed documentation.

### `$` Binding by Context

| Context | `$` contains |
|---------|--------------|
| Inline block `-> { }` | Piped value |
| Each loop `-> each { }` | Current item |
| While-loop `(cond) @ { }` | Accumulated value |
| Do-while `@ { } ? cond` | Accumulated value |
| Conditional `cond ? { }` | Tested value |
| Piped conditional `-> ? { }` | Piped value |
| Stored closure `\|x\|{ }` | N/A — use params |
| Dict closure `\|\|{ $.x }` | Dict self |

### Property Access

| Syntax | Description |
|--------|-------------|
| `$data.field` | Literal field access |
| `$data[0]`, `$data[-1]` | Index access |
| `$data.$key` | Variable as key |
| `$data.($i + 1)` | Computed key |
| `$data.(a \|\| b)` | Alternative keys |
| `$data.field ?? default` | Default if missing |
| `$data.?field` | Existence check (literal) |
| `$data.?$key` | Existence check (variable) |
| `$data.?($expr)` | Existence check (computed) |
| `$data.?field&type` | Existence + type check |
| `$data.^key` | Annotation reflection |

### Shape Validation

Validate a dict against a shape. All forms use the `:` type position.

| Syntax | Behavior | On Mismatch |
|--------|----------|-------------|
| `value -> :$shape` | Assert: dict matches shape in `$shape` | Halts with `RILL-R004` |
| `value -> :?$shape` | Check: dict matches shape in `$shape` | Returns `false` |
| `value -> :shape(field: type)` | Assert: dict matches inline shape | Halts with `RILL-R004` |
| `value -> :?shape(field: type)` | Check: dict matches inline shape | Returns `false` |
| `value -> :shape` | Assert: value is a shape type | Halts with `RILL-R004` |
| `value -> :?shape` | Check: value is a shape type | Returns `false` |

Disambiguation after `:` (and optional `?`): `$` → variable shape reference; `shape` followed by `(` → inline shape literal; `shape` without `(` → plain type assertion.

See [Types](topic-types.md) for shape literal syntax and validation examples.

### Dispatch

Pipe a value to a collection (dict or list) to retrieve the corresponding element.

**Dict Dispatch:** Match keys and return associated values.

| Syntax | Description |
|--------|-------------|
| `$val -> [k1: v1, k2: v2]` | Returns value for matching key |
| `$val -> [k1: v1, k2: v2] ?? default` | Returns matched value or default |
| `$val -> [["k1", "k2"]: shared]` | Multi-key dispatch (same value) |

```text
$value -> [apple: "fruit", carrot: "vegetable"]  # Returns "fruit" if $value is "apple"
$value -> [apple: "fruit"] ?? "not found"        # Returns "not found" if no match
$method -> [["GET", "HEAD"]: "safe", ["POST", "PUT"]: "unsafe"]  # Multi-key dispatch
```

**Type-Aware Dispatch:** Keys match by both value and type.

| Input | Dict | Result |
|-------|------|--------|
| `1` | `[1: "one", 2: "two"]` | `"one"` |
| `"1"` | `[1: "one", "1": "string"]` | `"string"` |
| `true` | `[true: "yes", false: "no"]` | `"yes"` |
| `"true"` | `[true: "bool", "true": "string"]` | `"string"` |
| `1` | `[[1, "one"]: "match"]` | `"match"` |
| `"one"` | `[[1, "one"]: "match"]` | `"match"` |

Dict keys can be identifiers, numbers, or booleans. Multi-key syntax `[k1, k2]: value` maps multiple keys to the same value.

**Hierarchical Dispatch:** Navigate nested structures using a path list.

| Syntax | Description |
|--------|-------------|
| `[path] -> $target` | Navigate nested dict/list using path of keys/indexes |
| `[] -> $target` | Empty path returns target unchanged |
| `[k1, k2, ...] -> $dict` | Sequential navigation through nested dicts |
| `[0, 1, ...] -> $list` | Sequential navigation through nested lists |
| `[k, 0, k2] -> $mixed` | Mixed dict keys and list indexes |

Path element types: string keys for dict lookup, number indexes for list access (negative indexes supported). Type mismatch throws `RUNTIME_TYPE_ERROR`.

Terminal closures receive `$` bound to the final path key.

```text
["name", "first"] -> [name: [first: "Alice"]]              # "Alice" (dict path)
[0, 1] -> [[1, 2, 3], [4, 5, 6]]                           # 2 (list path)
["users", 0, "name"] -> [users: [[name: "Alice"]]]         # "Alice" (mixed path)
["req", "draft"] -> [req: [draft: { "key={$}" }]]          # "key=draft" (terminal closure)
```

**List Dispatch:** Index into a list using a number.

| Syntax | Description |
|--------|-------------|
| `$idx -> [a, b, c]` | Returns element at index (0-based) |
| `$idx -> [a, b, c] ?? default` | Returns element or default if out of bounds |

```text
0 -> ["first", "second", "third"]     # "first"
1 -> ["first", "second", "third"]     # "second"
-1 -> ["first", "second", "third"]    # "third" (last element)
5 -> ["a", "b"] ?? "not found"        # "not found" (out of bounds)
```

**Variable Dispatch:** Use stored collections.

```rill
[apple: "fruit", carrot: "vegetable"] => $lookup
"apple" -> $lookup                    # "fruit"

["a", "b", "c"] => $items
1 -> $items                           # "b"
```

**Error Messages:**

| Scenario | Error |
|----------|-------|
| Dict dispatch key not found | `Dict dispatch: key '{key}' not found` |
| List dispatch index not found | `List dispatch: index '{index}' not found` |
| List dispatch with non-number | `List dispatch requires number index, got {type}` |
| Dispatch to non-collection | `Cannot dispatch to {type}` |

### Core Methods

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `.str` | Any | String | Convert to string |
| `.num` | Any | Number | Convert to number |
| `.len` | Any | Number | Length |
| `.trim` | String | String | Remove whitespace |
| `.head` | String/List | Any | First element |
| `.tail` | String/List | Any | Last element |
| `.at(idx)` | String/List | Any | Element at index |
| `.split(sep)` | String | List | Split by separator |
| `.join(sep)` | List | String | Join with separator |
| `.lines` | String | List | Split on newlines |
| `.lower` | String | String | Lowercase |
| `.upper` | String | String | Uppercase |
| `.replace(pat, repl)` | String | String | Replace first match |
| `.replace_all(pat, repl)` | String | String | Replace all matches |
| `.contains(text)` | String | Bool | Contains substring |
| `.starts_with(pre)` | String | Bool | Starts with prefix |
| `.ends_with(suf)` | String | Bool | Ends with suffix |
| `.match(regex)` | String | Dict | First match info |
| `.is_match(regex)` | String | Bool | Regex matches |
| `.empty` | Any | Bool | Is empty |
| `.has(value)` | List | Bool | Check if list contains value (deep equality) |
| `.has_any([values])` | List | Bool | Check if list contains any value from candidates |
| `.has_all([values])` | List | Bool | Check if list contains all values from candidates |
| `.keys` | Dict | List | All keys |
| `.values` | Dict | List | All values |
| `.entries` | Dict | List | Key-value pairs |
| `.params` | Closure | Dict | Parameter metadata (type, __annotations) |

See [Strings](topic-strings.md) for detailed string method documentation.

### Global Functions

| Function | Description |
|----------|-------------|
| `type` | Returns type name of value |
| `log` | Print to console, pass through |
| `json` | Convert to JSON string |
| `identity` | Returns input unchanged |
| `range(start, end, step?)` | Generate number sequence |
| `repeat(value, count)` | Repeat value n times |
| `enumerate(collection)` | Add index to elements |
| `to_shape(dict)` | Convert dict descriptor to shape value |

See [Iterators](topic-iterators.md) for `range` and `repeat` documentation.

---

## Implied `$`

When constructs appear without explicit input, `$` is used implicitly:

| Written | Equivalent to |
|---------|---------------|
| `? { }` | `$ -> ? { }` |
| `.method()` | `$ -> .method()` |
| `$fn()` | `$fn($)` (when no args, no default) |

---

## Extraction Operators

### Destructure `*<>`

Extract elements from lists or dicts into variables:

```rill
[1, 2, 3] -> *<$a, $b, $c>
# $a = 1, $b = 2, $c = 3

[name: "test", count: 42] -> *<name: $n, count: $c>
# $n = "test", $c = 42
```

### Slice `/<>`

Extract portions using Python-style `start:stop:step`:

```rill
[0, 1, 2, 3, 4] -> /<0:3>        # [0, 1, 2]
[0, 1, 2, 3, 4] -> /<-2:>        # [3, 4]
[0, 1, 2, 3, 4] -> /<::-1>       # [4, 3, 2, 1, 0]
"hello" -> /<1:4>                # "ell"
```

See [Operators](topic-operators.md) for detailed extraction operator documentation.

---

## Annotation Reflection

Access annotation values on closures using `.^key` syntax.

**Type Restriction:** Annotations attach to closures only. Accessing `.^key` on primitives (string, number, boolean, list, dict) throws `RUNTIME_TYPE_ERROR`.

```rill
^(min: 0, max: 100) |x|($x) => $fn

$fn.^min     # 0
$fn.^max     # 100
$fn.^missing # Error: RUNTIME_UNDEFINED_ANNOTATION
```

Annotations are metadata attached to closures during creation. They enable runtime configuration and introspection.

**Scope rule:** Annotations apply only to the closure directly targeted by `^(...)`. A closure nested inside an annotated statement does not inherit the annotation.

```rill
# Direct annotation: works
^(version: 2) |x|($x) => $fn
$fn.^version    # 2
```

```text
# Nested closure does NOT inherit outer annotation
^(version: 2)
"" -> {
  |x|($x) => $fn
}
$fn.^version    # Error: RUNTIME_UNDEFINED_ANNOTATION
```

### Description Shorthand

A bare string in `^(...)` expands to `description: <string>`:

```rill
^("Validates user input") |input|($input) => $validate
$validate.^description    # "Validates user input"
```

Mix the shorthand with explicit keys:

```rill
^("Fetch user profile", cache: true) |id|($id) => $get_user
$get_user.^description    # "Fetch user profile"
$get_user.^cache          # true
```

### Common Use Cases

**Function Metadata:**

```rill
^(doc: "validates user input", version: 2) |input|($input) => $validate

$validate.^doc      # "validates user input"
$validate.^version  # 2
```

**Configuration Annotations:**

```rill
^(timeout: 30000, retry: 3) |url|($url) => $fetch

$fetch.^timeout  # 30000
$fetch.^retry    # 3
```

**Complex Annotation Values:**

```rill
^(config: [timeout: 30, endpoints: ["a", "b"]]) |x|($x) => $fn

$fn.^config.timeout      # 30
$fn.^config.endpoints[0] # "a"
```

### Error Handling

Accessing undefined annotation keys throws `RUNTIME_UNDEFINED_ANNOTATION`:

```rill
|x|($x) => $fn
$fn.^missing   # Error: Annotation 'missing' not defined
```

Use default value operator for optional annotations:

```rill
|x|($x) => $fn
$fn.^timeout ?? 30  # 30 (uses default since annotation missing)
```

Accessing `.^key` on non-closure values throws `RUNTIME_TYPE_ERROR`:

```text
"hello" => $str
$str.^key        # Error: Cannot access annotation on string
```

### Parameter Annotations

Parameters can have their own annotations using `^(key: value)` syntax. These attach metadata to individual parameters.

**Syntax:** `|^(annotation: value) paramName| body`

**Order:** Parameter annotations appear before the parameter name, before the type annotation (if present) and default value (if present).

```rill
|^(min: 0, max: 100) x: number|($x) => $validate
|^(required: true) name: string = "guest"|($name) => $greet
|^(cache: true) count = 0|($count) => $process
```

**Access via `.params`:**

The `.params` property returns a dict keyed by parameter name. Each entry is a dict containing:

- `type` — Type annotation (string) if present
- `__annotations` — Dict of parameter-level annotations if present

```rill
|^(min: 0, max: 100) x: number, y: string|($x + $y) => $fn

$fn.params
# Returns:
# [
#   x: [type: "number", __annotations: [min: 0, max: 100]],
#   y: [type: "string"]
# ]

$fn.params.x.__annotations.min  # 0
$fn.params.y.?__annotations     # false (no annotations on y)
```

**Use Cases:**

```rill
# Validation metadata
|^(min: 0, max: 100) value|($value) => $bounded

# Caching hints
|^(cache: true) key|($key) => $fetch

# Format specifications
|^(format: "ISO8601") timestamp|($timestamp) => $formatDate
```

See [Closures](topic-closures.md) for parameter annotation examples and patterns.

---

## Return Type Declarations

The `-> type` syntax after the closing `|` attaches return type metadata to a closure. Return types are **not enforced at runtime** — they are metadata for host applications and tooling.

**Syntax:** `|params| -> returnType { body }`

```rill
|x: number| -> string { "{$x}" } => $fn
$fn(42)    # "42"
```

Valid return types:

| Return Type | Description |
|-------------|-------------|
| `string` | String value |
| `number` | Numeric value |
| `bool` | Boolean value |
| `list` | List value |
| `dict` | Dict value |
| `any` | Any type (unconstrained) |
| `vector` | Vector embedding |

The function executes regardless of actual return type:

```rill
|x: number| -> string { $x * 2 } => $double
$double(5)    # 10 (returns number despite -> string declaration)
```

Return type metadata is accessible to host applications via the TypeScript `getFunctions()` introspection API. It is not directly readable in rill script syntax.

---

## Tuples

Tuples package values for argument unpacking:

```rill
|a, b, c|"{$a}-{$b}-{$c}" => $fmt
*[1, 2, 3] -> $fmt()             # "1-2-3"
*[c: 3, a: 1, b: 2] -> $fmt()    # "1-2-3" (named)
```

See [Types](topic-types.md) for detailed tuple documentation.

---

## Operator-Level Annotations

Place `^(...)` between the operator name and its body to attach metadata to that operation. Annotations apply per evaluation, not per definition.

**Loops:**

```rill
0 -> ($ < 50) @ ^(limit: 100) { $ + 1 }
```

**Collection operators:**

```rill
[1, 2, 3] -> each ^(limit: 1000) { $ * 2 }
[1, 2, 3] -> map ^(limit: 10) { $ + 1 }
[1, 2, 3] -> filter ^(limit: 50) { $ > 1 }
[1, 2, 3] -> fold ^(limit: 20) |acc, x=0| { $acc + $x }
```

Invalid annotation keys for operator context produce a runtime error.

See [Control Flow](topic-control-flow.md) and [Collections](topic-collections.md) for detailed examples.

## Runtime Limits

### Iteration Limits

Loops have a default maximum of **10,000 iterations**. Place `^(limit: N)` at operator level, before the body:

```rill
0 -> ($ < 50) @ ^(limit: 100) { $ + 1 }
```

### Concurrency Limits

The `^(limit: N)` annotation also controls parallel concurrency in `map`:

```text
$items -> map ^(limit: 3) { slow_process($) }
```

See [Host Integration](integration-host.md) for timeout and cancellation configuration.

---

## Host-Provided Functions

rill is a vanilla language. The host application registers domain-specific functions via `RuntimeContext`:

```typescript
const ctx = createRuntimeContext({
  functions: {
    prompt: async (args) => await callLLM(args[0]),
    'io::read': async (args) => fs.readFile(String(args[0]), 'utf-8'),
  },
  variables: {
    config: { apiUrl: 'https://api.example.com' },
  },
});
```

Scripts call these as `prompt("text")` or `io::read("file.txt")`.

See [Host Integration](integration-host.md) for complete API documentation.

---

## Script Frontmatter

Optional YAML frontmatter between `---` markers. **Frontmatter is opaque to rill**—the host interprets it:

```text
---
timeout: 00:10:00
args: file: string
---

process($file)
```

---

## Script Return Values

Scripts return their last expression:

| Return | Exit Code |
|--------|-----------|
| `true` / non-empty string | 0 |
| `false` / empty string | 1 |
| `[0, "message"]` | 0 with message |
| `[1, "message"]` | 1 with message |

---

## Comments

Single-line comments start with `#`:

```rill
# This is a comment
"hello"  # inline comment
```

---

## Grammar

The complete formal grammar is in [grammar.ebnf](ref-grammar.ebnf).

---

## Error Codes

Runtime and parse errors include structured error codes for programmatic handling.

| Code | Description |
|------|-------------|
| `PARSE_UNEXPECTED_TOKEN` | Unexpected token in source |
| `PARSE_INVALID_SYNTAX` | Invalid syntax |
| `PARSE_INVALID_TYPE` | Invalid type annotation |
| `RUNTIME_UNDEFINED_VARIABLE` | Variable not defined |
| `RUNTIME_UNDEFINED_FUNCTION` | Function not defined |
| `RUNTIME_UNDEFINED_METHOD` | Method not defined (built-in only) |
| `RUNTIME_UNDEFINED_ANNOTATION` | Annotation key not defined |
| `RUNTIME_TYPE_ERROR` | Type mismatch |
| `RUNTIME_TIMEOUT` | Operation timed out |
| `RUNTIME_ABORTED` | Execution cancelled |
| `RUNTIME_INVALID_PATTERN` | Invalid regex pattern |
| `RUNTIME_AUTO_EXCEPTION` | Auto-exception triggered |
| `RUNTIME_ASSERTION_FAILED` | Assertion failed (condition false) |
| `RUNTIME_ERROR_RAISED` | Error statement executed |

See [Host Integration](integration-host.md) for error handling details.

---

## See Also

For detailed documentation on specific topics:

- [Types](topic-types.md) — Type system, type assertions
- [Variables](topic-variables.md) — Declaration, scope, `$` binding
- [Control Flow](topic-control-flow.md) — Conditionals, loops
- [Operators](topic-operators.md) — All operators
- [Closures](topic-closures.md) — Late binding, dict closures
- [Collections](topic-collections.md) — `each`, `map`, `filter`, `fold`
- [Iterators](topic-iterators.md) — `range`, `repeat`, `.first()`
- [Strings](topic-strings.md) — String methods
- [Host Integration](integration-host.md) — Embedding API
