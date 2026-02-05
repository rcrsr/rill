# rill Variables and Scope

*Variable declaration, type locking, and scope rules*

## Overview

rill uses capture (`=>`) instead of assignment. Variables are type-locked after first assignment and follow strict scoping rules.

**Key principles:**
- **Capture, not assign**: Use `=>` to capture values into variables
- **Type-locked**: Variables lock type on first assignment
- **No shadowing**: Cannot redeclare a variable name from outer scope
- **No leakage**: Variables created inside blocks don't exist outside

---

## Variable Declaration

Variables are declared via capture (`=>`), not assignment:

```rill
"hello" => $greeting
42 => $count
[1, 2, 3] => $items
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
| Each loop `-> each { }` | Current iteration item |
| While-loop `(cond) @ { }` | Accumulated value |
| Do-while `@ { } ? cond` | Accumulated value |
| Conditional `cond ? { }` | Tested value |
| Piped conditional `-> ? { }` | Piped value (also used as condition) |
| Stored closure `\|x\|{ }` | N/A — use explicit params |
| Dict closure `\|\|{ $.x }` | Dict self (`this`) — late-bound |

### Implied `$`

When certain constructs appear without explicit input, `$` is used implicitly:

| Written | Equivalent to | Context |
|---------|---------------|---------|
| `? { }` | `$ -> ? { }` | Piped conditional ($ as condition) |
| `.method()` | `$ -> .method()` | Method call without receiver |
| `$fn()` | `$fn($)` | Closure call with no explicit args* |

*Closure calls receive `$` only when: no explicit args, first param has no default, and `$` is not a closure.

```rill
# Inside blocks, $ flows naturally
"test value" -> {
  .upper -> log           # $ is "test value"
}

# In each loops, $ is the current item
|x| { $x * 2 } => $double
[1, 2, 3] -> each { $double() }   # $double receives 1, 2, 3
```

**When implied `$` does NOT apply:**

```rill
# Explicit args override implied $
|x| { $x } => $fn
$fn("explicit")           # uses "explicit", not $

# Params with defaults use the default
|x: string = "default"| { $x } => $fn2
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

### Explicit Type Annotations

Declare type explicitly with `:type`:

```rill
"hello" => $name:string       # declare and lock as string
42 => $count:number           # declare and lock as number
```

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`

### Inline Capture with Type

```rill
"hello" => $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```rill
|x|$x => $fn:closure          # locked as closure
```

```text
"text" => $fn                 # ERROR: cannot assign string to closure
```

---

## Scope Rules

Blocks, loops, conditionals, and grouped expressions create child scopes.

### Three Rules

1. **Read from parent:** Variables from outer scopes are accessible (read-only)
2. **No shadowing:** Cannot assign to a variable name that exists in an outer scope
3. **No leakage:** Variables created inside don't exist outside

```rill
"context" => $ctx

"check" -> .contains("c") ? {
  "process with {$ctx}" -> log   # OK: read outer variable
  "local" => $temp               # OK: new local variable
}
# $temp not accessible here
```

```text
"context" => $ctx
"check" -> .contains("c") ? {
  "new" => $ctx                  # ERROR: cannot shadow outer $ctx
}
```

### While Loops and `$`

While loops use `$` as the accumulator since named variables in the body don't persist across iterations:

```rill
# Use $ as accumulator (body result becomes next iteration's $)
0 -> ($ < 5) @ { $ + 1 }    # Result: 5

# Variables inside loop body are local to each iteration
0 -> ($ < 3) @ {
  ($ * 10) => $temp    # $temp exists only in this iteration
  $ + 1
}
# $temp not accessible here
```

> **Common Mistake:** Attempting to modify outer-scope variables from inside loops. This pattern NEVER works:
>
> ```text
> 0 => $count
> [1, 2, 3] -> each { $count + 1 => $count }  # Creates LOCAL $count!
> $count                                       # Still 0!
> ```
>
> Use `fold` for reductions, or pack multiple values into `$` as a dict. See [Collections](07_collections.md) for accumulator patterns.

### Reading Outer Variables

```rill
10 => $x
[1, 2, 3] -> each {
  $x + $      # Reads outer $x = 10
}
# Result: [11, 12, 13]
```

---

## Special Variables

| Variable | Contains | Source |
|----------|----------|--------|
| `$` | Piped value (current block scope) | Grammar |
| `$ARGS` | CLI positional args (list) | Runtime |
| `$ENV.NAME` | Environment variable | Runtime |
| `$name` | Named variable | Runtime |

`$` is a grammar-level construct. All other variables are runtime-provided with the same scoping rules as user-defined variables.

### `$ARGS`

Access CLI positional arguments:

```text
$ARGS[0]                     # first argument
$ARGS[1]                     # second argument
$ARGS -> each { log($) }     # iterate all arguments
```

### `$ENV`

Access environment variables:

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
# Verbose — unnecessary capture
app::prompt("check status") => $status
$status -> .empty ? app::error("No status")

# Idiomatic — data flows naturally
app::prompt("check status")
.empty ? app::error("No status")
```

### Accumulation in Loops

Use `$` for accumulation in while loops:

```rill
"" -> (.len < 5) @ { "{$}x" }   # "xxxxx"
```

---

## See Also

- [Types](02_types.md) — Type system and type assertions
- [Control Flow](05_control-flow.md) — Conditionals and loops
- [Closures](06_closures.md) — Closure scope and late binding
- [Reference](11_reference.md) — Quick reference tables
