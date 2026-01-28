# rill Core Language Specification v0.1.0

*From prompts to workflows*

rill is a pipe-based scripting language for orchestrating workflows.

> **Experimental (v0.1.0).** Active development. Breaking changes until v1.0.

## Overview

rill is an imperative scripting language that is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught—there are no implicit conversions. Type annotations are optional, but variables lock their type on first assignment. The language is value-based: no references, all copies are deep, all comparisons are by value. Empty values are valid (empty strings, lists, dicts), but null and undefined do not exist. Control flow is singular: no exceptions, no try/catch. Data flows through pipes (`->`), not assignment.

## Design Principles

1. **Pipes over assignment** — Data flows via `->`. No `=` operator exists.
2. **Pattern-driven decisions** — Check response patterns, branch accordingly.
3. **Singular control flow** — No try/catch. Errors halt execution. Recovery requires explicit conditionals.
4. **Value-based** — All values compare by content. No references, no object identity.
5. **No null/undefined** — Empty values are valid, but "no value" cannot be represented.
6. **No magic** — No truthiness, no automatic type conversions. Explicit behavior only.
7. **Expressive and consistent** — Small syntax, coherent semantics. Every construct composes predictably.

---

## Quick Reference Tables

### Operators

| Category | Operators |
|----------|-----------|
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Comparison | `.eq`, `.ne`, `.lt`, `.gt`, `.le`, `.ge` methods |
| Logical | `!` (unary), `&&`, `\|\|` |
| Pipe | `->` |
| Capture | `:>` |
| Spread | `@` (sequential), `*` (tuple) |
| Extraction | `*<>` (destructure), `/<>` (slice) |
| Type | `:type` (assert), `:?type` (check) |
| Member | `.field`, `[index]` |
| Default | `?? value` |
| Existence | `.?field`, `.?field&type` |

See [Operators](04_operators.md) for detailed documentation.

### Control Flow

| Syntax | Description |
|--------|-------------|
| `cond ? then ! else` | Conditional (if-else) |
| `$val -> ? then ! else` | Piped conditional ($ as condition) |
| `(cond) @ body` | While loop |
| `@ body ? cond` | Do-while |
| `break` / `$val -> break` | Exit loop |
| `return` / `$val -> return` | Exit block or script |
| `assert cond` / `assert cond "msg"` | Validate condition, halt on failure |
| `error "msg"` / `$val -> error` | Halt execution with error message |

See [Control Flow](05_control-flow.md) for detailed documentation. Script-level exit functions must be host-provided.

### Collection Operators

| Syntax | Description |
|--------|-------------|
| `-> each { body }` | Sequential iteration, all results |
| `-> each(init) { body }` | Sequential with accumulator (`$@`) |
| `-> map { body }` | Parallel iteration, all results |
| `-> filter { cond }` | Parallel filter, matching elements |
| `-> fold(init) { body }` | Sequential reduction, final result |

See [Collections](07_collections.md) for detailed documentation.

### Types

| Type | Syntax | Example |
|------|--------|---------|
| String | `"text"`, `"""text"""` | `"hello"`, `"""line 1\nline 2"""` |
| Number | `123`, `0.5` | `42`, `0.9` |
| Bool | `true`, `false` | `true` |
| List | `[a, b]` | `["file.ts", 42]` |
| Dict | `[k: v]` | `[output: "text", code: 0]` |
| Tuple | `*[...]` | `*[1, 2]`, `*[x: 1, y: 2]` |
| Closure | `\|\|{ }` | `\|x\|($x * 2)` |

See [Types](02_types.md) for detailed documentation.

### Functions

| Syntax | Description |
|--------|-------------|
| `\|p: type\|{ } :> $fn` | Define and capture function |
| `\|p = default\|{ }` | Parameter with default |
| `$fn(arg)` | Call function directly |
| `arg -> $fn()` | Call function with pipe value |
| `arg -> $fn` | Pipe-style invoke |

See [Closures](06_closures.md) for detailed documentation.

### Special Variables

| Variable | Contains | Source |
|----------|----------|--------|
| `$` | Piped value (current scope) | Grammar |
| `$ARGS` | CLI positional args (list) | Runtime |
| `$ENV.NAME` | Environment variable | Runtime |
| `$name` | Named variable | Runtime |

See [Variables](03_variables.md) for detailed documentation.

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
| `$data.?field` | Existence check |

### Dict Dispatch

Pipe a value to a dict to match keys and return associated values:

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

### Parsing Functions

| Function | Description |
|----------|-------------|
| `parse_auto` | Auto-detect and extract structured content |
| `parse_json` | Parse JSON with error repair |
| `parse_xml(tag?)` | Extract content between XML tags |
| `parse_fence(lang?)` | Extract fenced code block content |
| `parse_fences` | Extract all fenced blocks as list |
| `parse_frontmatter` | Parse `---` delimited YAML frontmatter |
| `parse_checklist` | Parse `- [ ]` and `- [x]` items |

See [Parsing](10_parsing.md) for detailed documentation.

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

See [Strings](09_strings.md) for detailed string method documentation.

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

See [Iterators](08_iterators.md) for `range` and `repeat` documentation.

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

See [Operators](04_operators.md) for detailed extraction operator documentation.

---

## Tuples

Tuples package values for argument unpacking:

```rill
|a, b, c|"{$a}-{$b}-{$c}" :> $fmt
*[1, 2, 3] -> $fmt()             # "1-2-3"
*[c: 3, a: 1, b: 2] -> $fmt()    # "1-2-3" (named)
```

See [Types](02_types.md) for detailed tuple documentation.

---

## Runtime Limits

### Iteration Limits

Loops have a default maximum of **10,000 iterations**. Override with `^(limit: N)`:

```rill
^(limit: 100) 0 -> ($ < 50) @ { $ + 1 }
```

### Concurrency Limits

The `^(limit: N)` annotation also controls parallel concurrency in `map`:

```text
^(limit: 3) $items -> map { slow_process($) }
```

See [Host Integration](14_host-integration.md) for timeout and cancellation configuration.

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

See [Host Integration](14_host-integration.md) for complete API documentation.

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

The complete formal grammar is in [grammar.ebnf](15_grammar.ebnf).

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
| `RUNTIME_TYPE_ERROR` | Type mismatch |
| `RUNTIME_TIMEOUT` | Operation timed out |
| `RUNTIME_ABORTED` | Execution cancelled |
| `RUNTIME_INVALID_PATTERN` | Invalid regex pattern |
| `RUNTIME_AUTO_EXCEPTION` | Auto-exception triggered |
| `RUNTIME_ASSERTION_FAILED` | Assertion failed (condition false) |
| `RUNTIME_ERROR_RAISED` | Error statement executed |

See [Host Integration](14_host-integration.md) for error handling details.

---

## Topic Guides

For detailed documentation on specific topics:

- [Types](02_types.md) — Type system, type assertions
- [Variables](03_variables.md) — Declaration, scope, `$` binding
- [Control Flow](05_control-flow.md) — Conditionals, loops
- [Operators](04_operators.md) — All operators
- [Closures](06_closures.md) — Late binding, dict closures
- [Collections](07_collections.md) — `each`, `map`, `filter`, `fold`
- [Iterators](08_iterators.md) — `range`, `repeat`, `.first()`
- [Strings](09_strings.md) — String methods
- [Parsing](10_parsing.md) — Content parsing
- [Host Integration](14_host-integration.md) — Embedding API
