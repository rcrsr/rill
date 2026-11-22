# rill Variables and Scope

*Variable declaration, type locking, and scope rules*

## Overview

rill uses capture (`=>`) instead of assignment. Variables are type-locked after first assignment and follow strict scoping rules.

**Key principles:**
- **Capture, not assign**: Use `=>` to capture values into variables
- **Type-locked**: Variables lock type on first assignment
- **No rebinding**: A capture cannot rebind an outer variable; a function parameter may shadow one
- **No leakage**: Variables created inside blocks don't exist outside

---

## Variable Declaration

Variables are declared via capture (`=>`), not assignment:

```rill
"hello" => $greeting
42 => $count
[1, 2, 3] => $numbers
```

### Capture and Continue

The `=>` operator captures the value AND continues the chain:

```rill
"hello"
    => $greeting         # capture "hello" into $greeting
    -> "{$} world"       # $ is still "hello"
    => $message          # capture "hello world" into $message
    -> .upper            # result: "HELLO WORLD"
```

### Terminal Capture

Capture at end of expression stores and ends the chain:

```rill
"hello" => $result       # capture and end chain (result: "hello")
```

---

## The Pipe Variable `$`

`$` holds the current piped value in the current scope:

```rill
"test value" -> {
  .upper -> log          # $ is "test value", logs "TEST VALUE"
}
```

### `$` Binding by Context

| Context | `$` contains |
|---------|--------------|
| Inline block `-> { }` | Piped value |
| Each loop `-> seq({ })` | Current iteration item |
| While-loop `while (cond) do { }` | Accumulated value |
| Do-while `do { } while (cond)` | Accumulated value |
| Conditional `cond ? a ! b` | Pipe value entering the conditional, in either branch (block or bare) |
| Piped conditional `-> ? { }` | Piped value (also used as condition) |
| Head block `{ } => $x` | Enclosing `$`; the block runs where written |
| Held block `dict[a: { }]` | Selector under dispatch, else enclosing `$` |
| Stored function `fn(x) { }` | N/A — use explicit params |

### Implied `$`

When certain constructs appear without explicit input, `$` is used implicitly:

| Written | Equivalent to | Context |
|---------|---------------|---------|
| `? { }` | `$ -> ? { }` | Piped conditional ($ as condition) |
| `.method()` | `$ -> .method()` | Method call without receiver |

A call with no arguments receives no implied `$`. Write `$fn($)` to pass it.

Inside a held block, `$@` is lexical: it resolves to the binding around the block, and a block creates none. See [Code Blocks](ref-language.md#code-blocks) for the held-block rules.

```rill
# Inside blocks, $ flows naturally
"test value" -> {
  .upper -> log           # $ is "test value"
}

# In each loops, $ is the current item
fn(x) { $x * 2 } => $double
[1, 2, 3] -> seq({ $double($) })   # $double receives 1, 2, 3
```

**Function calls pass arguments as written:**

```rill
# Explicit args override implied $
fn(x) { $x } => $fn
$fn("explicit")           # uses "explicit", not $

# Params with defaults use the default
fn(x: string = "default") { $x } => $fn2
$fn2()                    # uses "default", not $
```

---

## Type-Locked Variables

Variables lock type after first assignment:

```rill
"hello" => $name              # locked as string
"world" => $name              # OK: same type
```

```text
5 => $name                    # ERROR: cannot assign number to string
```

A capture of a value that carries a declared type locks the new variable to that declaration:

```rill
1 => $x:union(number, string)
$x => $y                      # $y locks to union(number, string)
"a" => $y                     # OK: string is a member
$y
# Result: "a"
```

The lock is the asserted or declared type the value carries, else its full inferred type, element and field types included. `list[1]` locks to `list(number)`, so a list of strings halts:

```rill
list[1] => $x
list["a"] => $x
# Error: RILL-R001
```

A dict lock is exact, a tuple lock is positional, and a function locks to its full `fn(...)` type:

```rill
dict[a: 1] => $d
dict[a: 2] => $d
tuple[1, "a"] => $t
tuple[2, "b"] => $t
fn(n: number) { $n } => $f
fn(n: number) { $n + 1 } => $f
$f(1)
# Result: 2
```

```rill
dict[a: 1] => $d
dict[a: 1, b: 2] => $d
# Error: RILL-R001
```

```rill
fn(n: number) { $n } => $f
fn(s: string) { $s } => $f
# Error: RILL-R001
```

An empty `list[] => $x` locks the unspecified form and admits any list. Host variables supplied through `variables` lock the same way; see [Host Integration](integration-host.md) for the host options.

### Declared Literals

A written type followed by a literal on the same line declares the literal's type. A declared empty literal locks the variable to that type, so a later capture of another element type halts:

```rill
list(number)[] => $x
list["a"] => $x
# Error: RILL-R001
```

A literal that fails its declared type halts `#TYPE_MISMATCH`:

```rill
guard { list(number)["a"] } => $r
$r.!code
# Result: #TYPE_MISMATCH
```

A space between `list` and `[` reads the same as the adjacent form:

```rill
list [1, 2] == list[1, 2]
# Result: true
```

A newline ends the type, so these are two statements:

```rill
list(number)
[1, 2]
# Result: list[1, 2]
```

### Explicit Type Annotations

Declare type explicitly with `:type`:

```rill
"hello" => $name:string       # declare and lock as string
42 => $count:number           # declare and lock as number
```

**Supported types:** `string`, `number`, `bool`, `fn`, `list`, `dict`, `tuple`

An annotation sets the variable's declared type, which `.^type` reports. See [Declared and Effective Types](topic-type-system.md#declared-and-effective-types).

`any` declares nothing, so the variable locks to the value's own type:

```rill
1 => $x:any
$x.^type.signature
# Result: "number"
```

```rill
# Error: Type mismatch: cannot assign string to $x (locked as number)
1 => $x:any
"a" => $x
```

The language service reports this lock as the `ANY_CAPTURE_LOCK` checker error.

Union types, written `union(...)`, are valid in capture annotations. The runtime accepts any value that satisfies at least one union member:

```rill
"hello" => $x:union(string, number)
$x
# Result: "hello"
```

```rill
# Error: #TYPE_MISMATCH: Type assertion failed: expected union(number, string), got bool
true => $x:union(string, number)
```

A capture that fails its annotation halts `#TYPE_MISMATCH`; a capture that breaks an existing type lock halts `RILL-R001`. Both are catchable:

```rill
guard { true => $x:union(string, number) } => $r
$r.!code
# Result: #TYPE_MISMATCH
```

### Inline Capture with Type

```rill
"hello" => $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```rill
fn(x) { $x } => $fn:fn          # locked as fn
$fn(42)
```

```text
"text" => $fn                 # ERROR: cannot assign string to fn
```

---

## Scope Rules

Blocks, loops, conditionals, grouped expressions, and string interpolations create child scopes.

### Three Rules

1. **Read from parent:** Variables from outer scopes are accessible (read-only)
2. **No rebinding:** A capture cannot rebind a variable an outer scope binds; it halts `RILL-R001`. A function parameter may reuse an outer name and reads the argument; see [Parameter Shadowing](topic-closures.md#parameter-shadowing).
3. **No leakage:** Variables created inside don't exist outside

```rill
"context" => $ctx

"check" -> .contains("c") ? {
  "process with {$ctx}" -> log   # OK: read outer variable
  "local" => $temp               # OK: new local variable
}
# $temp not accessible here
```

```rill
# Error: RILL-R001
"context" => $ctx
"check" -> .contains("c") ? {
  "new" => $ctx                  # halts: cannot rebind outer $ctx
}
```

### While Loops and `$`

While loops use `$` as the accumulator since named variables in the body don't persist across iterations:

```rill
# Use $ as accumulator (body result becomes next iteration's $)
0 -> while ($ < 5) do { $ + 1 }    # Result: 5

# Variables inside loop body are local to each iteration
0 -> while ($ < 3) do {
  ($ * 10) => $temp    # $temp exists only in this iteration
  $ + 1
}
# $temp not accessible here
```

**Common mistake:** capturing into an outer variable from inside a loop body halts with `RILL-R001`. The body cannot rebind a name an enclosing scope owns.

```rill
# Error: RILL-R001 Cannot reassign outer variable
0 => $count
list[1, 2, 3] -> seq({ $count + $ => $count })
```

Use `fold` for reductions, or pack multiple values into `$` as a dict. See [Collections](topic-collections.md) for accumulator patterns.

### Reading Outer Variables

```rill
10 => $x
[1, 2, 3] -> seq({
  $x + $      # Reads outer $x = 10
})
# Result: list[11, 12, 13]
```

---

## Special Variables

| Variable | Contains | Source |
|----------|----------|--------|
| `$` | Piped value (current block scope) | Grammar |
| `$ARGS` | Positional args (list) | Host, when bound |
| `$ENV.NAME` | Environment variable | Host, when bound |
| `$name` | Named variable | Capture or host |

`$` is a grammar-level construct. Every other variable is bound either by a capture in the script or by the host before the script runs. A host variable behaves as if the outermost scope had bound it.

### `$ARGS`

rill binds neither `$ARGS` nor `$ENV`. They exist only when the host binds them, for example a CLI host passing positional arguments and the environment. Reading one that is unbound halts with `RILL-R005`.

```rill
# Error: RILL-R005
$ENV.HOME
```

When the host binds `$ARGS`:

```text
$ARGS[0]                     # first argument
$ARGS[1]                     # second argument
$ARGS -> seq({ log($) })     # iterate all arguments
```

### `$ENV`

When the host binds `$ENV`:

```text
$ENV.HOME                    # /home/user
$ENV.PATH                    # /usr/bin:...
$ENV.DEPLOY_ENV ?? "dev"     # with default
```

### Runtime-Provided Variables

Named variables like `$file` or `$config` are provided by the host runtime. rill treats them as any other variable in the outer scope:

```text
---
args: file: string, retries: number = 3
---

# $file and $retries available because host parsed frontmatter
process($file, $retries)
```

---

## Inline Capture Pattern

Captures can appear mid-chain for debugging or later reference. Semantically, `=> $a ->` stores the value and returns it unchanged (like `log`):

```rill
"analyze this" => $result -> .upper -> .len
# $result is "analyze this", final result is 12
```

The value flows: `"analyze this"` → stored in `$result` → uppercased → length.

### Debugging Pattern

```rill
"test" => $input -> log -> .upper => $output -> log
# logs "test", then logs "TEST"
# $input is "test", $output is "TEST"
```

---

## Common Patterns

### Capture for Reuse

Capture when you need the value in multiple places:

```rill
"hello" => $greeting
"{$greeting} world" => $message
"{$greeting} there" => $alt
```

### Let Data Flow

Prefer implied `$` when the value flows directly to the next statement:

```text
use<ext:app> => $app

# Verbose — unnecessary capture
$app.prompt("check status") => $status
$status -> .empty ? $app.error("No status")

# Idiomatic — data flows naturally
$app.prompt("check status")
.empty ? $app.error("No status")
```

### Accumulation in Loops

Use `$` for accumulation in while loops:

```rill
"" -> while (.len < 5) do { "{$}x" }   # "xxxxx"
```

---

## See Also

- [Types](topic-types.md) — Type system and type assertions
- [Control Flow](topic-control-flow.md) — Conditionals and loops
- [Functions and Code Blocks](topic-closures.md) — Function scope and late binding
- [Reference](ref-language.md) — Quick reference tables
