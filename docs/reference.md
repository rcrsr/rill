# rill Core Language Specification v0.0.1

*From prompts to workflows*

rill is a pipe-based scripting language for orchestrating workflows.

> **Experimental (v0.0.1).** Active development. Breaking changes until v1.0.

## Overview

rill is an imperative, dynamically-typed scripting language with first-class closures. Type annotations are optional, but types are immutable once assigned. The language is value-based: no references, all copies are deep, all comparisons are by value. Empty values are valid (empty strings, lists, dicts), but null and undefined do not exist. Control flow is singular: no exceptions, no try/catch. Data flows through pipes (`->`), not assignment.

## Design Principles

1. **Pipes over assignment** — Data flows via `->`. No `=` operator exists.
2. **Pattern-driven decisions** — Check response patterns, branch accordingly.
3. **Singular control flow** — No try/catch. Errors halt execution. Recovery requires explicit conditionals.
4. **Value-based** — All values compare by content. No references, no object identity.
5. **No null/undefined** — Empty values are valid, but "no value" cannot be represented.
6. **No magic** — No truthiness, no automatic type conversions. Explicit behavior only.
7. **Expressive and consistent** — Small syntax, coherent semantics. Every construct composes predictably.

## Quick Reference

### Operators

| Category   | Operators                                        |
| ---------- | ------------------------------------------------ |
| Arithmetic | `+`, `-`, `*`, `/`, `%`                          |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=`                 |
| Comparison | `.eq`, `.ne`, `.lt`, `.gt`, `.le`, `.ge` methods |
| Logical    | `!` (unary), `&&`, `||`                          |
| Pipe       | `->`                                             |
| Spread     | `@` (sequential), `*` (tuple), `map`, `filter`   |
| Extraction | `*<>` (destructure), `/<>` (slice) |
| Type       | `:type` (assert), `:?type` (check)               |
| Member     | `.field`, `[index]`                              |
| Default    | `?? value`                                       |
| Existence  | `.?field`, `.?field&type`                        |

### Control Flow

| Syntax                      | Description              |
| --------------------------- | ------------------------ |
| `cond ? then ! else`        | Conditional (if-else)    |
| `$val -> ? then ! else`     | Piped conditional (uses $ as cond) |
| `(cond) @ body`             | While loop (cond is bool)|
| `@ body ? cond`             | Do-while (body first)    |
| `break` / `$val -> break`   | Exit loop                |
| `return` / `$val -> return` | Exit block               |
| `stop()`                    | Exit script (code 0)     |
| `error("msg")`              | Exit script (code 1)     |

### Collection Operators

| Syntax                        | Description              |
| ----------------------------- | ------------------------ |
| `-> each { body }`            | Sequential iteration, returns all results |
| `-> each(init) { body }`      | Sequential with accumulator (`$@`) |
| `-> map { body }`             | Parallel iteration, returns all results |
| `-> fold(init) { body }`      | Sequential reduction, returns final |

See [Collections](collections.md) for detailed documentation.

### Spread Operators

| Syntax                        | Description                              |
| ----------------------------- | ---------------------------------------- |
| `$list -> map $closure`       | Parallel map: apply closure to each element |
| `$list -> map { body }`       | Parallel map with block body                |
| `$list -> filter { cond }`    | Parallel filter: keep truthy elements       |
| `$list -> filter $predicate`  | Parallel filter: keep where pred is true    |
| `$input -> @$closures`        | Sequential fold: chain closures          |
| `$input -> @[$f, $g, $h]`     | Sequential chain: f then g then h        |

### Property Access

| Syntax | Description |
|--------|-------------|
| `$data.field` | Literal field access |
| `$data[0]`, `$data[-1]` | Index access (bracket syntax, negative from end) |
| `$data.$key` | Variable as key |
| `$data.($i + 1)` | Computed expression as key |
| `$data.(a \|\| b)` | Alternatives (try keys left-to-right) |
| `$data.field ?? default` | Default value if missing |
| `$data.?field` | Existence check (returns bool) |
| `$data.?field&type` | Existence + type check (returns bool) |

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

### Key Concept: Implied `$`

When certain constructs appear without explicit input, the current pipe value `$` is used implicitly:

| Written             | Equivalent to         | Context |
| ------------------- | --------------------- | ------- |
| `? { }`             | `$ -> ? { }`         | Piped conditional ($ as condition) |
| `.method()`         | `$ -> .method()`     | Method call without receiver |
| `$fn()`             | `$fn($)`             | Closure call with no explicit args* |

*Closure calls receive `$` only when: no explicit args, first param has no default, and `$` is not a closure.

**When implied `$` applies:**

```text
# Inside blocks, $ flows naturally
prompt("check") -> {
  .contains("ERROR") ? error($)     # $ is prompt result
  log                               # $ is prompt result
}

# In each loops, $ is the current item
[1, 2, 3] -> each {
  $double()   # $double receives current item (1, 2, 3)
}
```

**When implied `$` does NOT apply:**

```text
# Explicit args override implied $
$fn("explicit")           # uses "explicit", not $

# Params with defaults use the default
|x: string = "default"|$x -> $fn
$fn()                     # uses "default", not $

# After capturing a closure, $ is the closure itself
|x|$x -> $fn
$fn()                     # does NOT pass closure to itself
```

This enables concise chaining inside blocks without repeating the piped value.

### Functions

| Syntax                              | Description                    |
| ----------------------------------- | ------------------------------ |
| `|p: type|{ } -> $fn`              | Define and capture function    |
| `|p = default|{ }`                 | Parameter with default (type inferred) |
| `|p: type = default|{ }`           | Parameter with default (type explicit) |
| `$fn(arg)` or `arg -> $fn()`        | Call function                  |

### Special Variables

| Variable    | Contains                          | Source  |
| ----------- | --------------------------------- | ------- |
| `$`        | Piped value (current block scope) | Grammar |
| `$ARGS`     | CLI positional args (list)        | Runtime |
| `$ENV.NAME` | Environment variable              | Runtime |
| `$name`     | Named variable                    | Runtime |

`$` is a grammar-level construct. All other variables (`$ARGS`, `$ENV`, named variables) are runtime-provided outer-scope variables with the same scoping rules as user-defined variables.

`$ARGS` is a list of CLI positional arguments. Access by index (`$ARGS[0]`, `$ARGS[1]`) or iterate with `$ARGS -> each { }`.

Named variables (e.g., `$file`, `$initiative`) are provided by the runtime based on application-specific configuration. rill treats them as any other variable in the outer scope.

### `$` Binding by Context

| Context | `$` contains |
|---------|--------------|
| Inline block `-> { }` | Piped value |
| Each loop `-> each { }` | Current iteration item |
| While-loop `(cond) @ { }` | Accumulated value |
| Do-while `@ { } ? cond` | Accumulated value |
| Conditional `cond ? { }` | Tested value |
| Piped conditional `-> ? { }` | Piped value (also used as condition) |
| Tuple of blocks `[{ }, { }]` | Contextual |
| Stored closure `\|x\|{ }` | N/A — use explicit params |
| Dict closure `\|\|{ $.x }` | Dict self (`this`) — late-bound |

**Key distinction:**
- **Blocks `{ }`** execute immediately with `$` = contextual value
- **Closures `||{ }` or `|params|{ }`** are stored for later invocation
- **Dict closures** (function literals in dicts) have `$` late-bound to containing dict at invocation

## Functions

Functions are first-class values created with function literals and stored in variables. See [Closures](closures.md) for detailed closure semantics including late binding, scope chain, and invocation patterns.

```text
# Define functions by capturing function literals
|target: string|{
  prompt("Check if {$target} is ready") -> .contains("READY") ? true ! false
} -> $check_ready

|op: string, attempts: number = 3|{
  prompt("{$op}") -> @(.contains("RETRY"), max: $attempts) {
    pause("00:00:05")
    prompt("{$op}")
  }
} -> $retry_operation
```

### Syntax

```text
|param, param: type, param: type = default|{ body } -> $name
```

**Parameters:**
- Untyped: `|x|{ }`
- Typed: `|x: string|{ }`
- With default (type inferred): `|x = "default"|{ }` — type inferred as `string`
- With default (type explicit): `|x: string = "default"|{ }` — type must match default

**Parameter types:** `string`, `number`, `bool`

**Type inference for defaults:** When a default value is provided, the type annotation is optional. If omitted, the type is inferred from the default value. If both are specified, they must be consistent:

```text
|x = 10|{ }            # OK: x is number (inferred)
|x: number = 10|{ }    # OK: x is number (explicit, matches default)
|x: string = 10|{ }    # ERROR: default 10 is number, not string
```

### Calling Functions

```text
$check_ready("build") ? prompt("proceed")

$retry_operation("deploy service")           # uses default attempts=3
$retry_operation("deploy service", 5)        # override attempts

# Pipe-style invocation (equivalent)
"build" -> $check_ready()
```

### Postfix Invocation

Closures can be invoked immediately after any expression that returns them:

```text
# From bracket access
[|x|($x * 2), |x|($x + 1)] -> $fns
$fns[0](5)                    # 10

# Chained invocation
|| { |n|($n * 2) } -> $factory
$factory()(5)                 # 10

# After method access
[double: |n|($n * 2)] -> $math
$math.double(7)               # 14
```

**Note:** Method access after bracket requires grouping: `($list[0]).upper` not `$list[0].upper`. See [Closures](closures.md) for details.

### Scope Rules

Same as blocks:
- **Captures outer scope:** Functions can read outer variables (read-only)
- **Local mutable:** Variables declared inside are local and mutable
- **Cannot modify outer:** Outer scope variables cannot be reassigned

```text
"context" -> $ctx

|item: string|{
  # $ctx IS accessible here (captured from outer scope)
  prompt("process {$item} with {$ctx}")
} -> $process

$process("data")
```

### Inline Functions

For simple transformations, use interpolation or arithmetic directly:

```text
["a", "b", "c"] -> each {
  "item: {$}"                          # direct interpolation
}

[1, 2, 3] -> each {
  $ * 2                                # direct arithmetic
}
```

For reusable logic, define the closure first:

```text
|x: string|"item: {$x}" -> $format
["a", "b", "c"] -> map $format           # parallel map
```

## Types

Primitive types:

| Type    | Syntax          | Example                      |
| ------- | --------------- | ---------------------------- |
| String  | `"text"`        | `"hello"`                    |
| Number  | `123`, `0.5`    | `42`, `0.9`                  |
| Bool    | `true`, `false` | `true`                       |
| List    | `[a, b]`        | `["file.ts", 42]`            |
| Dict    | `[k: v]`        | `[output: "text", code: 0]`  |
| Tuple   | `*[...]`        | `*[1, 2]`, `*[x: 1, y: 2]`   |
| Closure | `\|\|{ }`       | `\|x\|($x * 2)`              |

### Tuples and Dicts

Used for function arguments, options, and return values. Read-only in core—no manipulation or iteration.

**Tuples** — ordered sequences, accessed by index (bracket syntax):

```text
$result[0]                       # first element
$result[1]                       # second element
```

**Dicts** — key-value mappings, accessed by field name:

```text
$result.output                   # field access
$result.exitcode                 # field access
```

**Out-of-bounds access:** Accessing a missing index or key returns an empty string:

```text
[].0                             # "" (empty list)
["a"].5                          # "" (index out of bounds)
[:].missing                      # "" (key not found)
```

**Literals** for function calls:

```text
command("test", ["src/"])                    # list argument
prompt("check", [timeout: "00:05:00"])       # dict options
[0, "Success"]                               # list return value
```

### Tuple Type (Spread Args)

Tuples package values for explicit argument unpacking at closure invocation. Created with the `*` spread operator:

```text
# From list (positional)
*[1, 2, 3] -> $t              # tuple with positional values

# From dict (named)
*[x: 1, y: 2] -> $t           # tuple with named values

# Via pipe target
[1, 2, 3] -> * -> $t          # convert list to tuple
```

**Using tuples at invocation:**

```text
|a, b, c| { "{$a}-{$b}-{$c}" } -> $fmt

# Positional unpacking (from list)
*[1, 2, 3] -> $fmt()          # "1-2-3"

# Named unpacking (from dict) - order doesn't matter
*[c: 3, a: 1, b: 2] -> $fmt() # "1-2-3"
```

**Strict validation:** When invoking with tuples, missing required parameters error, and extra arguments error:

```text
|x, y|($x + $y) -> $fn
*[1] -> $fn()                 # Error: missing argument 'y'
*[1, 2, 3] -> $fn()           # Error: extra positional argument
*[x: 1, z: 3] -> $fn()        # Error: unknown argument 'z'
```

**Parameter defaults with tuples:**

```text
|x, y = 10, z = 20|($x + $y + $z) -> $fn
*[5] -> $fn()                 # 35 (5 + 10 + 20)
*[x: 5, z: 30] -> $fn()       # 45 (5 + 10 + 30)
```

**Auto-unpacking with parallel spread:**

When a closure is invoked with a single tuple argument, the tuple auto-unpacks to match parameters:

```text
# List of tuples with multi-arg closure
[*[1,2], *[3,4]] -> map |x,y|($x * $y)    # [2, 12]

# Named tuples work too
[*[x:1, y:2], *[x:3, y:4]] -> map |x,y|($x + $y)  # [3, 7]
```

**Converting lists to tuples:**

Use `*` to convert each list element to a tuple. Bare `*` is shorthand for `$ -> *`:

```text
# Convert list of lists to list of tuples
[[1,2], [3,4]] -> each { * }              # [*[1,2], *[3,4]]
[[1,2], [3,4]] -> each { $ -> * }         # equivalent explicit form

# Or with parallel spread
[[1,2], [3,4]] -> map |x|(*$x)            # [*[1,2], *[3,4]]

# Full pipeline: convert then operate
[[1,2], [3,4]] -> each { * } -> map |a,b|($a * $b)  # [2, 12]

# Or destructure directly (no tuple conversion needed)
[[1,2], [3,4]] -> each {
  $ -> *<$a, $b>
  $a * $b
}  # [2, 12]
```

### Strings

Double-quoted text with variable interpolation using `{$var}`:

```text
"hello world"
"Process {$filename} for review"
"Result: {$response}"
```

Escape sequences: `\n`, `\t`, `\\`, `\"`, `{{` (literal `{`), `}}` (literal `}`)

**Heredocs** for multi-line prompts:

```text
prompt(<<EOF
Review this code:
{$code}

Check for security issues.
EOF
)
```

The delimiter (e.g., `EOF`) must not appear on its own line within the content. Choose a unique delimiter if needed (e.g., `<<PROMPT`, `<<END_CODE`).

### Numbers

Used for exit codes and loop limits:

```text
42
0
1
```

### Booleans

Literal `true` and `false`. Bare `?` uses truthy semantics (false, empty string, 0, empty list are falsy).

## Variables

### Declaration

Variables are declared via capture (`->`), not assignment:

```text
prompt("analyze") -> $result
```

### Type-Locked Variables

Variables are type-locked after first assignment. The type is inferred from the value or declared explicitly:

```text
"hello" -> $name              # implicit: locked as string
"world" -> $name              # OK: same type
5 -> $name                    # ERROR: cannot assign number to string

"hello" -> $name:string       # explicit: declare and lock as string
42 -> $count:number           # explicit: declare and lock as number
```

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`

**Inline capture with type:**

```text
"hello" -> $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```text
|x|$x -> $fn             # locked as closure
"text" -> $fn                 # ERROR: cannot assign string to closure
```

### Type Assertions and Checks

Use type assertions to validate values at runtime and type checks to branch on type.

**Type assertion (`:type`)** — error if type doesn't match, returns value unchanged:

```text
# Postfix form (binds tighter than method calls)
42:number                     # passes, returns 42
(1 + 2):number                # passes, returns 3
42:number.str                 # "42" - assertion then method

# Pipe target form
"hello" -> :string            # passes, returns "hello"
"hello" -> :number            # ERROR: expected number, got string
$val -> :dict -> .keys        # assert dict, then get keys
```

**Type check (`:?type`)** — returns boolean, no error:

```text
# Postfix form
42:?number                    # true
"hello":?number               # false

# Pipe target form
"hello" -> :?string           # true
$val -> :?list ? process() ! skip()   # branch on type
```

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`

**In pipe chains:**

```text
# Assert type and continue processing
$data -> :list -> each { process($) }

# Postfix on grouped expression
0 -> (($ < 5) @ ($ + 1)):number -> "result: {$}"

# Multiple assertions in chain
"test" -> :string -> .len -> :number   # 4

# Type check for conditional dispatch
$val -> :?number ? ($val * 2) ! { $val -> :?string ? ($val -> .len) ! 0 }
```

**Use cases:**

```text
# Validate function input
|data| {
  $data -> :list              # assert input is list
  $data -> each { process($) }
} -> $process_items

# Type-safe branching
|val| {
  $val -> :?number ? ($val * 2)
       ! :?string ? ($val -> .len)
       ! 0
} -> $normalize
```

### Inline Capture (Pass-Through)

Captures can appear mid-chain. Semantically, `-> $a ->` is `-> $a.set($) ->` — an implicit `.set()` method that stores the value and returns it unchanged:

```text
prompt("analyze") -> $result -> log -> ?(.contains("ERROR")) { error($result) }
```

The value flows: `prompt` → stored in `$result` → logged → checked for errors.

This mirrors `log` behavior — both have side effects (storing/printing) while passing through the value unchanged.

### The Pipe Variable `$`

`$` holds the piped value in the current scope. The `|` visually indicates "this came through the pipe":

```text
$response -> ?(.contains("ERROR")) {
  "Failed: {$}" -> log
}
```

### Scope

Blocks, loops, conditionals, and grouped expressions create child scopes:

1. **Read from parent:** Variables from outer scopes are accessible
2. **No shadowing:** Cannot assign to a variable name that exists in an outer scope (error)
3. **No leakage:** Variables created inside don't exist outside

```text
"context" -> $ctx

prompt("check") -> .contains("READY") ? {
  prompt("process with {$ctx}")    # OK: read outer variable
  "local" -> $temp                 # OK: new local variable
  "new" -> $ctx                    # ERROR: cannot shadow outer $ctx
}
# $temp not accessible here (created in conditional block)
```

**While loops** use `$` as the accumulator since named variables in the body don't persist:

```text
# Use $ as accumulator (body result becomes next iteration's $)
0 -> ($ < 5) @ { $ + 1 }    # Result: 5

# Variables inside loop body are local to each iteration
0 -> ($ < 3) @ {
  ($ * 10) -> $temp    # $temp exists only in this iteration
  $ + 1
}
# $temp not accessible here
```

**Reading outer variables:**

```text
10 -> $x
[1, 2, 3] -> each {
  $x + $      # Reads outer $x = 10
}
# Result: [11, 12, 13]
```

## Expressions

### Pipe Operator

`->` passes the left-hand value to the right-hand side:

```text
prompt("analyze") -> $result
$result -> .contains("DONE") ? stop()
```

**Piped value as `$`:** The piped value is available as `$`:

```text
$text -> prompt("summarize: {$}")
```

### Method Syntax

Method calls are sugar for pipes:

```text
$str.contains("x")   # equivalent: $str -> .contains("x")
```

Implicit `$` syntax (`.method()`) works in any expression:

```text
$val -> .empty() ? { }            # $.empty() as condition
$val -> .contains("x") ? { }      # $.contains("x") as condition
```

### Comparison Operators

| Operator | Description      |
| -------- | ---------------- |
| `==`     | Equal            |
| `!=`     | Not equal        |
| `<`      | Less than        |
| `>`      | Greater than     |
| `<=`     | Less or equal    |
| `>=`     | Greater or equal |

### Logical Operators

| Operator | Description |
| -------- | ----------- |
| `&&`     | Logical AND (short-circuit) |
| `||`     | Logical OR (short-circuit)  |
| `!`      | Logical NOT                 |

Logical operators work with any truthy/falsy values and return booleans:

```text
(true && false)             # false
(true || false)             # true
!true                       # false
(1 < 2 && 3 > 2)            # true (with comparisons)
(false && $undefined)       # false (short-circuit: $undefined not evaluated)
(true || $undefined)        # true (short-circuit: $undefined not evaluated)
```

**Note:** Compound expressions like `$a && $b` require grouping in `simple-body` contexts (conditional branches, loop bodies, closure bodies). Use `($a && $b)` or `{ $a && $b }`.

### Arithmetic Expressions

Arithmetic works as standalone expressions and integrates with pipes:

```text
5 + 3                      # 8 (standalone arithmetic)
2 + 3 * 4                  # 14 (precedence: * before +)
(2 + 3) * 4                # 20 (parentheses override precedence)
5 + 3 -> $x                # pipe arithmetic result to capture
$x * 2                     # use variables in expressions
{ 5 + 3 }                  # arithmetic in blocks
(5 + 3)                    # arithmetic in grouped expressions
```

**Arithmetic operators:** `+`, `-`, `*`, `/`, `%` (modulo)

**Expression precedence (high to low):**
- Unary: `-`, `!`
- Multiplicative: `*`, `/`, `%`
- Additive: `+`, `-`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical AND: `&&`
- Logical OR: `||`
- Pipe: `->`

**Unary minus:** `-5`, `-$x`

**Type constraint:** All operands must be numbers. No implicit conversion:

```text
"5" + 1                    # ERROR: Arithmetic requires number, got string
```

**Error handling:**

```text
10 / 0                     # ERROR: Division by zero
10 % 0                     # ERROR: Modulo by zero
```

## Statements

### Conditionals

`?` is the conditional operator. The condition precedes `?`, and `!` introduces the else clause:

```text
condition ? then-body
condition ? then-body ! else-body
$val -> ? then-body ! else-body     # piped form: $ is the condition
```

**Standalone form** — condition precedes `?`:

```text
true ? "yes" ! "no"                 # "yes"
$ready ? prompt("proceed")          # execute if $ready is truthy
(5 > 3) ? "big" ! "small"           # grouped comparison as condition
"hello".contains("ell") ? "found"   # method call as condition
```

**Piped form** — use `$` as condition:

```text
$val -> ? "truthy" ! "falsy"        # bare ?: tests $ for truthiness
$val -> .contains("x") ? "found"    # method result is condition
$val -> ($ > 3) ? "big" ! "small"   # comparison in piped context
```

**Condition forms:**

```text
($ == "expected") ? handle()        # grouped comparison
.eq("expected") ? handle()          # comparison method (cleaner)
.contains("x") ? handle()           # method as condition
!.empty ? handle()                  # negated method
$bool ? handle()                    # variable as condition
```

**Else-if chains:**

```text
$val -> .eq("A") ? "a" ! .eq("B") ? "b" ! "other"
```

**Return value:** Conditionals return the last expression of the executed branch:

```text
$val -> .contains("x") ? "yes" ! "no" -> $result   # "yes" or "no"
```

### While Loop

Pre-condition loop. Condition is evaluated before each iteration:

```text
0 -> $count
($count < 5) @ {
  ($count + 1) -> $count
}
# $count is 5
```

**Condition forms:**

```text
($x < 10) @ { body }                 # comparison condition
($s -> .contains("RETRY")) @ { }     # method call as condition
true @ { body }                       # infinite loop (use break)
```

**Loop limit:** Use `^(limit: N)` annotation (default: 10000):

```text
^(limit: 5) ($count < 100) @ {
  ($count + 1) -> $count
}
# Throws error if loop exceeds 5 iterations
```

### For Loop

Iterates over list, string, or dict. `$` is bound to each element:

```text
$items -> each {
  "Processing: {$}" -> log
}
```

**Dict iteration:** Yields `{ key, value }` objects (keys sorted alphabetically):

```text
[name: "Alice", age: 30] -> each {
  "{$.key}: {$.value}"
}
# => ["age: 30", "name: Alice"]
```

**Distinguish from while:** `each` iterates over collections; `(condition) @` loops while condition is true.

```text
$list -> each { }         # each: iterate elements
(cond) @ { }              # while: repeat while condition
```

**Process lines:**

```text
prompt("list all issues") -> .lines() -> each {
  prompt("fix issue: {$}")
}
```

**Early exit:**

```text
["a", "b", "STOP", "c"] -> each {
  ($ == "STOP") ? "found" -> break
  log
} -> $result    # "found"
```

**Returns:** Last `$` value, or break value if exited early.

### Do-While Loop

Post-condition loop. Body executes first, then condition is checked:

```text
# Execute at least once, continue while condition holds
0 -> $count
@ { ($count + 1) -> $count } ? ($count < 5)
# $count is 5

# With input value that evolves
"" -> $s
@ { "{$s}x" -> $s } ? (($s -> .len) < 3)
# $s is "xxx"
```

**Loop limit:** Use `^(limit: N)` annotation:

```text
^(limit: 100) @ { prompt("try again") } ? (.contains("RETRY"))
```

**When to use do-while vs while:**

```text
# While: condition checked BEFORE body (may execute 0 times)
(condition) @ { body }

# Do-while: condition checked AFTER body (executes at least once)
@ { body } ? (condition)
```

**Practical example — validation loop:**

```text
# Keep prompting until output passes validation
^(limit: 5) @ {
  prompt("Generate valid JSON for a user profile")
} ? (parse_json($) -> type != "dict")

# Loop exits when parse_json returns a dict
parse_json($) -> $profile
```

**Early exit:**

```text
0 -> $i
@ {
  ($i + 1) -> $i
  ($i > 3) ? ($i -> break)
  $i
} ? true
# Returns 4
```

### Break and Return

```text
# Exit loop early (infinite loop with break)
prompt("process") -> $result
true @ {
  ($result -> .contains("DONE")) ? break
  ($result -> .contains("FAIL")) ? "failed" -> break
  prompt("continue") -> $result
}

# Exit block early
{
  prompt("step 1") -> $a
  $a -> .contains("SKIP") ? return            # exit block
  prompt("step 2 with {$a}")
} -> $result
```

### Control Flow Summary

| Statement          | Scope  | Effect                       |
| ------------------ | ------ | ---------------------------- |
| `break`            | Loop   | Exit loop with current `$`  |
| `$val -> break`    | Loop   | Exit loop with value         |
| `return`           | Block  | Exit block with current `$` |
| `$val -> return`   | Block  | Exit block with value        |
| `stop()`           | Script | Exit script (code 0)         |
| `error("message")` | Script | Exit script (code 1)         |

## Spread Operators

Spread operators enable parallel and sequential execution of closures.

### Sequential Spread `@`

Chain closures where each receives the previous result (fold pattern).

```text
|x|($x + 1) -> $inc
|x|($x * 2) -> $double
|x|($x + 10) -> $add10

# Chain: (5 + 1) = 6, (6 * 2) = 12, (12 + 10) = 22
5 -> @[$inc, $double, $add10] -> $result    # 22

# With single closure
5 -> @$double -> $result    # 10
```

**Use Cases:**

```text
# Pipeline of transformations
|s|"{$s}-processed" -> $process
|s|"{$s}-validated" -> $validate
|s|"{$s}-complete" -> $complete

"input" -> @[$process, $validate, $complete]
# "input-processed-validated-complete"
```

### Collection Operators (`each`, `map`, `fold`)

> See [Collections](collections.md) for complete documentation.

rill provides three collection operators for common iteration patterns:

| Operator | Behavior | Returns |
|----------|----------|---------|
| `each` | Sequential iteration | List of all results |
| `map` | Parallel iteration | List of all results |
| `fold` | Sequential reduction | Final accumulated value |

**Quick examples:**

```text
[1, 2, 3] -> each { $ * 2 }           # [2, 4, 6] - sequential
[1, 2, 3] -> map { $ * 2 }            # [2, 4, 6] - parallel
[1, 2, 3] -> filter { $ > 1 }         # [2, 3] - keep matching
[1, 2, 3] -> fold(0) { $@ + $ }       # 6 - reduce to final
```

**Accumulator forms:**

```text
[1, 2, 3] -> each(0) { $@ + $ }       # [1, 3, 6] - running sum
[1, 2, 3] -> fold(0) { $@ + $ }       # 6 - final sum only
```

## Extraction Operators

Extraction operators transform collections by extracting elements into variables or new structures.

| Operator | Name | Purpose |
|----------|------|---------|
| `*<...>` | Destructure | Extract elements into variables |
| `/<...>` | Slice | Extract a portion (lists and strings) |

### Destructure `*<>`

Extract elements from lists or dicts into variables. Returns the original value unchanged.

**List destructuring** — pattern count must match list length:

```text
[1, 2, 3] -> *<$a, $b, $c>
# $a = 1, $b = 2, $c = 3

# With type annotations
$result -> *<$status:number, $message:string>

# Skip unwanted elements with _
[1, 2, 3, 4] -> *<$first, _, _, $last>
# $first = 1, $last = 4

# Nested destructuring
[[1, 2], 3] -> *<*<$a, $b>, $c>
# $a = 1, $b = 2, $c = 3
```

**Dict destructuring** — explicit key mapping required:

```text
[name: "test", count: 42] -> *<name: $n, count: $c>
# $n = "test", $c = 42

# With type annotations
$config -> *<host: $h:string, port: $p:number>
```

**Errors:**

```text
[1, 2] -> *<$a, $b, $c>           # Error: pattern has 3 elements, list has 2
[name: "x"] -> *<name: $n, age: $a>  # Error: key 'age' not found
"hello" -> *<$a, $b>              # Error: positional destructure requires list
```

### Slice `/<>`

Extract a portion using Python-style `start:stop:step`. Works on lists and strings.

```text
# Basic slicing
$list -> /<0:3>       # elements 0, 1, 2
$list -> /<1:4>       # elements 1, 2, 3
$str -> /<0:5>         # first 5 characters

# Omitted bounds
$list -> /<:3>        # first 3 elements
$list -> /<2:>        # from index 2 to end
$list -> /<:>         # all elements (copy)

# Negative indices
$list -> /<-1:>       # last element as tuple
$list -> /<-3:>       # last 3 elements
$list -> /<:-1>       # all but last

# Step
$list -> /<::2>       # every 2nd element
$list -> /<::-1>      # reversed

# String slicing
"hello" -> /<1:4>      # "ell"
"hello" -> /<::-1>     # "olleh"

# Dynamic bounds
$list -> /<$start:$end>
$list -> /<0:($len - 1)>
```

**Edge cases:**

```text
[1, 2, 3] -> /<0:100>     # [1, 2, 3] (clamped)
[1, 2, 3] -> /<2:1>       # [] (empty when start >= stop)
[1, 2, 3] -> /<::0>       # Error: step cannot be zero
[a: 1] -> /<0:1>          # Error: slice requires list or string
```

### enumerate()

Transform list or dict into list of dicts with index information. This is a built-in global function.

**List enumeration** — produces `[index, value]` dicts:

```text
enumerate([10, 20, 30])
# [[index: 0, value: 10], [index: 1, value: 20], [index: 2, value: 30]]

# Iterate with index
enumerate($items) @ {
  "[{$.index + 1}/{$items.len}] {$.value}" -> log()
}
```

**Dict enumeration** — produces `[index, key, value]` dicts (keys sorted alphabetically):

```text
enumerate([name: "x", count: 5])
# [[index: 0, key: "count", value: 5], [index: 1, key: "name", value: "x"]]

# Transform dict to string
enumerate($config) @ {
  "{$.key}: {$.value}"
} -> join("\n")
```

## Runtime Limits

rill enforces resource limits to prevent runaway scripts.

### Iteration Limits

Loops have a default maximum of **10,000 iterations**. Override with the `^(limit: N)` annotation:

```text
# Default: 10,000 max iterations
(true) @ { prompt("again") -> .contains("DONE") ? break }

# Custom limit
^(limit: 100) (true) @ { body }

# Also applies to iterator expansion
^(limit: 5000) $items -> each { process($) }
```

Exceeding the limit throws `RuntimeError` with code `RUNTIME_LIMIT_EXCEEDED`.

### Timeout

Async host functions can be time-limited via `RuntimeOptions.timeout`:

```typescript
const ctx = createRuntimeContext({
  timeout: 30000, // 30 seconds per async call
  functions: {
    slowOp: async () => { /* ... */ },
  },
});
```

- **Default:** No timeout (undefined)
- **Scope:** Applied to each async host function call individually
- **Error:** `TimeoutError` with code `RUNTIME_TIMEOUT`

### Recursion

No explicit recursion limit. Recursive closures are constrained by JavaScript's call stack (typically ~10,000 frames). Deep recursion throws a JavaScript `RangeError`.

### Memory

No explicit memory limits. Memory is constrained by the JavaScript runtime.

### Concurrency Limits

The `^(limit: N)` annotation also controls parallel concurrency in `map` operations:

```text
# Process 10 items, max 3 concurrent
^(limit: 3) $items -> map { slowProcess($) }
```

See [Host Integration](host-integration.md) for timeout and cancellation configuration.

## Host-Provided Functions

rill is a vanilla scripting language. The host application registers domain-specific functions via `RuntimeContext`. rill provides no built-in integrations—all external capabilities come from the host.

**Registering functions:**

```typescript
import { createRuntimeContext, execute, parse, callable } from '@rcrsr/rill';

const controller = new AbortController();

const ctx = createRuntimeContext({
  // Custom functions: called as functionName(args)
  functions: {
    prompt: async (args, ctx, location) => {
      // location contains line/column for error reporting
      return await callLLM(args[0]);
    },
    exec: async (args) => { /* spawn process */ },
  },

  // Initial variables (can include callables)
  variables: {
    utils: {
      uppercase: callable((args) => String(args[0]).toUpperCase()),
    },
  },

  // Cancellation support
  signal: controller.signal,

  // Timeout for async functions (ms)
  timeout: 30000,
});

// To cancel execution:
// controller.abort();

const result = await execute(parse(script), ctx);
```

**Function signature:**

```typescript
type CallableFn = (
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation  // call site for error reporting
) => RillValue | Promise<RillValue>;
```

**Cancellation:**

Pass an `AbortSignal` via `signal` option. When aborted, execution throws `AbortError` at the next safe point (before function calls, at loop iterations, before statements).

**Example: Using host functions in scripts:**

```text
# Functions provided by the host
fetch("https://api.example.com/status")
.contains("ERROR") ? $utils.uppercase($) -> exec("notify", ["admin", $])
```

## Core Methods

Essential methods for workflow orchestration. See [Strings](strings.md) for detailed string method documentation.

### Conversion Methods

| Method     | Input  | Output | Description                        |
| ---------- | ------ | ------ | ---------------------------------- |
| `.str`     | Any    | String | Convert to string                  |
| `.num`     | Any    | Number | Convert to number (0 if invalid)   |
| `.len`     | Any    | Number | Length of string, array, or object |
| `.trim`    | String | String | Remove leading/trailing whitespace |

### Element Access Methods

| Method     | Input        | Output   | Description                          |
| ---------- | ------------ | -------- | ------------------------------------ |
| `.head`    | String/List  | Any      | First character or element (errors on empty) |
| `.tail`    | String/List  | Any      | Last character or element (errors on empty)  |
| `.at(idx)` | String/List  | Any      | Element at index (0-based)           |
| `.first()` | Any iterable | Iterator | Return iterator at first position    |

### String Operations

| Method                    | Input  | Output | Description                            |
| ------------------------- | ------ | ------ | -------------------------------------- |
| `.split(sep)`             | String | Tuple  | Split by separator (default: `\n`)     |
| `.join(sep)`              | Tuple  | String | Join with separator (default: `,`)     |
| `.lines`                  | String | Tuple  | Split on newlines (same as .split)     |
| `.lower`                  | String | String | Convert to lowercase                   |
| `.upper`                  | String | String | Convert to uppercase                   |
| `.replace(pat, repl)`     | String | String | Replace first regex match              |
| `.replace_all(pat, repl)` | String | String | Replace all regex matches              |
| `.repeat(n)`              | String | String | Repeat string n times                  |
| `.pad_start(len, fill)`   | String | String | Pad start to length (fill default: ` `) |
| `.pad_end(len, fill)`     | String | String | Pad end to length (fill default: ` `)   |
| `.index_of(substr)`       | String | Number | Position of first match (-1 if none)   |

### Pattern Methods

| Method               | Input  | Output | Description                           |
| -------------------- | ------ | ------ | ------------------------------------- |
| `.contains("text")`  | String | Bool   | Check if string contains text         |
| `.starts_with(pre)`  | String | Bool   | True if string starts with prefix     |
| `.ends_with(suf)`    | String | Bool   | True if string ends with suffix       |
| `.match("regex")`    | String | Dict   | First match info, or `[:]` if none    |
| `.is_match("regex")` | String | Bool   | True if regex matches anywhere        |
| `.empty`             | Any    | Bool   | True if empty or falsy                |

## Global Functions

Global functions are invoked without a receiver, typically at the end of a pipe:

| Function   | Input | Output   | Description                           |
| ---------- | ----- | -------- | ------------------------------------- |
| `type`     | Any   | String   | Returns type name of value            |
| `log`      | Any   | Same     | Print to console, pass through        |
| `json`     | Any   | String   | Convert to JSON string (see below)    |
| `identity` | Any   | Same     | Returns input unchanged               |
| `range`    | start, end, step? | Iterator | Generate number sequence     |
| `repeat`   | value, count | Iterator | Repeat value n times              |

**`json` closure handling:**

- Direct closure → error: `|x|{ $x } -> json` throws "Cannot serialize closure to JSON"
- Closures in dicts → skipped: `[a: 1, fn: ||{ 0 }] -> json` returns `'{"a":1}'`
- Closures in lists → skipped: `[1, ||{ 0 }, 2] -> json` returns `'[1,2]'`

### Content Parsing Functions

| Function           | Input  | Output | Description                           |
| ------------------ | ------ | ------ | ------------------------------------- |
| `parse_auto`       | String | Dict   | Auto-detect and parse structured data |
| `parse_json`       | String | Any    | Parse JSON (with error repair)        |
| `parse_xml`        | String, tag? | String/Dict | Extract XML tag content      |
| `parse_fence`      | String, lang? | String | Extract fenced code block       |
| `parse_fences`     | String | List   | Extract all fenced code blocks        |
| `parse_frontmatter`| String | Dict   | Parse YAML frontmatter and body       |
| `parse_checklist`  | String | List   | Parse checklist items                 |

```text
42 -> type              # "number"
"hello" -> type         # "string"
[1, 2] -> type          # "list"
*[1, 2] -> type         # "tuple"
||{ } -> $fn
$fn -> type             # "closure"

"debug" -> log          # prints "debug", returns "debug"
[a: 1] -> json   # '{"a":1}'
'{"a":1}' -> parse_json -> $dict   # [a: 1]
```

### Dict Methods

| Method     | Input | Output | Description                          |
| ---------- | ----- | ------ | ------------------------------------ |
| `.keys`    | Dict  | Tuple  | All keys as strings                  |
| `.values`  | Dict  | Tuple  | All values                           |
| `.entries` | Dict  | Tuple  | Tuple of `[key, value]` pairs        |

```text
[name: "test", count: 42] -> .keys      # ["name", "count"]
[name: "test", count: 42] -> .values    # ["test", 42]
[a: 1, b: 2] -> .entries                # [["a", 1], ["b", 2]]
[a: 1, b: 2] -> json          # '{"a":1,"b":2}' (global function)
```

**Reserved methods** (`keys`, `values`, `entries`) cannot be used as dict keys:

```text
[keys: "value"]    # Error: Cannot use reserved method name 'keys'
```

### Dict Closures

Function literals in dicts have `$` late-bound to the containing dict (like `this` in other languages). See [Closures](closures.md) for full dict-bound closure documentation.

**Zero-arg closures auto-invoke on access:**

```text
[
  name: "toolkit",
  count: 3,
  str: ||"{$.name}: {$.count} items"
] -> $obj

$obj.str    # "toolkit: 3 items" (auto-invoked)
```

**Parameterized closures must be extracted then called:**

```text
[
  name: "tools",
  process: |x|"{$.name}: {$x}"
] -> $obj

$obj.process -> $fn    # extract closure
$fn("hello")           # "tools: hello"
```

**Reusable closures** can be defined once and placed in multiple dicts:

```text
||"{$.name}: {$.count} items" -> $describer

[name: "tools", count: 3, str: $describer] -> $obj1
[name: "actions", count: 5, str: $describer] -> $obj2

$obj1.str    # "tools: 3 items"
$obj2.str    # "actions: 5 items"
```

**Blocks vs closures in dicts:**

```text
[
  immediate: { "computed" },     # Block: executes NOW, stores result
  deferred: ||"computed"    # Closure: stored, invokes on access
]
```

### Comparison Methods

| Method     | Input  | Output | Description            |
| ---------- | ------ | ------ | ---------------------- |
| `.eq(val)` | Any    | Bool   | Equal (`==`)           |
| `.ne(val)` | Any    | Bool   | Not equal (`!=`)       |
| `.lt(val)` | Number | Bool   | Less than (`<`)        |
| `.gt(val)` | Number | Bool   | Greater than (`>`)     |
| `.le(val)` | Number | Bool   | Less or equal (`<=`)   |
| `.ge(val)` | Number | Bool   | Greater or equal (`>=`)|

Comparison methods provide readable alternatives to operators in conditionals:

```text
$val -> .eq("A") ? "a" ! .eq("B") ? "b" ! "other"
$count -> .gt(10) ? "many" ! .ge(5) ? "some" ! "few"
```

### Pattern Checking

```text
$response -> .contains("READY") ? prompt("proceed")
$response -> !.empty ? prompt("process {$}")
```

### Pattern Extraction

`.match("regex")` returns a dict with `matched`, `index`, and `groups` fields. Empty dict means no match:

```text
# Extract error message from response
$response -> .match("Error: (.+)") -> $m
$m -> !.empty ? error("Found error: {$m.groups[0]}")

# Multiple capture groups
"v1.2.3" -> .match("v(\\d+)\\.(\\d+)\\.(\\d+)") -> $m
# $m is [matched: "v1.2.3", index: 0, groups: ["1", "2", "3"]]

# Access match info
"abc123xyz" -> .match("[0-9]+")
# Returns [matched: "123", index: 3, groups: []]

# No match returns empty dict
"hello" -> .match("xyz")
# Returns [:]

# Use .is_match for simple boolean check
"hello123" -> .is_match("[0-9]+")  # true
"hello" -> .is_match("[0-9]+")     # false
```

### Logging

`log` prints the piped value to console and returns it unchanged, enabling inline debugging:

```text
"Starting process" -> log
$response -> log -> ?(.contains("ERROR")) { error("failed") }
```

## Parsing Functions

rill provides built-in parsing for structured content commonly found in LLM responses. These functions auto-detect format, extract data, and repair common errors.

### The `parse_auto` Function

Auto-detect and extract structured content from text. Returns a dict with parsing results.

```text
$response -> parse_auto -> $result
# $result contains:
#   type: "json" | "xml" | "yaml" | "frontmatter" | "fence" | "checklist" | "text"
#   data: <parsed structured data>
#   raw: <original extracted content>
#   confidence: <0.0-1.0 detection confidence>
#   repaired: <true if error recovery applied>
```

**Detection priority (most specific first):**

| Priority | Format | Detection Signal |
|----------|--------|------------------|
| 1 | frontmatter | Starts with `---\n` |
| 2 | fence (json/yaml) | ` ```json ` or ` ```yaml ` blocks |
| 3 | fence (other) | ` ```lang ` blocks |
| 4 | xml | `<tag>...</tag>` structure |
| 5 | json | `{...}` or `[...]` with balanced braces |
| 6 | checklist | `- [ ]` or `- [x]` patterns |
| 7 | yaml | `key: value` line patterns (2+ lines) |
| 8 | text | Fallback (returns trimmed input) |

**Examples:**

```text
# JSON in fenced code block
"Here's the data:\n```json\n{\"count\": 42}\n```" -> parse_auto
# type: "json", data: [count: 42], confidence: 0.98

# XML tags
"<thinking>Step 1</thinking><answer>42</answer>" -> parse_auto
# type: "xml", data: [thinking: "Step 1", answer: "42"]

# Raw JSON with preamble
"The result is {\"status\": \"ok\"}." -> parse_auto
# type: "json", data: [status: "ok"], confidence: 0.85

# Checklist
"- [ ] Todo\n- [x] Done" -> parse_auto
# type: "checklist", data: [[false, "Todo"], [true, "Done"]]

# Frontmatter
"---\ntitle: Doc\n---\nBody" -> parse_auto
# type: "frontmatter", data: [meta: [title: "Doc"], body: "Body"]
```

**JSON repair:** The parser auto-repairs common LLM formatting errors:

| Error | Repair |
|-------|--------|
| Trailing commas | Removed |
| Single quotes | Converted to double quotes |
| Unquoted keys | Quoted |
| Unclosed braces | Closed (best effort) |

### Format-Specific Functions

Extract specific formats without auto-detection.

| Function | Input | Output | Description |
|----------|-------|--------|-------------|
| `parse_json(text)` | String | Any | Parse JSON (with repair) |
| `parse_xml(text, tag?)` | String | String/Dict | Extract content from XML tags |
| `parse_fence(text, lang?)` | String | String | Extract fenced code block content |
| `parse_fences(text)` | String | List | Extract all fenced blocks |
| `parse_frontmatter(text)` | String | Dict | Parse `---` delimited frontmatter |
| `parse_checklist(text)` | String | List | Parse `- [ ]` and `- [x]` items |

**`parse_json(text)`** — Parse JSON with error recovery:

```text
"{name: 'test', count: 42,}" -> parse_json
# Returns [name: "test", count: 42]
# Repairs: unquoted keys, single quotes, trailing comma
```

**`parse_xml(text, tag?)`** — Extract content from XML tags:

```text
$response -> parse_xml("thinking")
# Returns content between <thinking>...</thinking>

$response -> parse_xml("answer") -> parse_json
# Extract <answer> tag, parse as JSON

$response -> parse_xml
# Without tag: returns dict of all tags
```

**`parse_fence(text, lang?)`** — Extract content from fenced code blocks:

```text
$response -> parse_fence("json") -> parse_json
# Extracts ```json block, then parses as JSON

$response -> parse_fence
# Returns first fenced block content (any language)
```

**`parse_fences(text)`** — Extract all fenced code blocks:

```text
$response -> parse_fences
# Returns list of [lang: "...", content: "..."] dicts
```

**`parse_frontmatter(text)`** — Parse YAML frontmatter:

```text
$doc -> parse_frontmatter
# Returns [meta: [...], body: "..."]

$doc -> parse_frontmatter -> *<meta: $m, body: $b>
# Destructure into variables
```

**`parse_checklist(text)`** — Parse task list items:

```text
"- [ ] Buy milk\n- [x] Call mom" -> parse_checklist
# Returns [[false, "Buy milk"], [true, "Call mom"]]

# Filter completed items
$tasks -> parse_checklist -> filter { $.0 }
```

See [Parsing](parsing.md) for detailed usage and [Examples](examples.md) for workflow patterns.

## Comments

Single-line comments start with `#`:

```text
# Check if ready
prompt("status check")  # inline comment
```

## Script Frontmatter

rill supports optional YAML frontmatter between `---` markers. **Frontmatter is opaque to rill**—it is passed through to the runtime/caller for interpretation. The specific fields and their meanings are **application-defined**.

```text
---
# Application-specific configuration
# rill does not interpret these fields
---

# Script body starts here
prompt("hello")
```

### Runtime-Provided Variables

Named variables like `$file` or `$initiative` are **not** extracted from frontmatter by rill. Instead:

1. The **caller/runtime** parses frontmatter according to its own schema
2. The caller maps CLI arguments to named variables
3. The caller passes those variables to the rill context

From rill's perspective, named variables simply exist in the context—how they got there is the caller's responsibility.

**Example** (host-defined convention):

```text
---
args: file: string, retries: number = 3
---

# $file and $retries are available because the host runtime
# parsed the frontmatter and mapped CLI args to variables
process($file, $retries)
```

## Script Return Values

Scripts return their last expression:

- **Bool/String:** Exit code 0 for `true`/non-empty, 1 for `false`/empty
- **Tuple `[code, message]`:** First element is exit code, second is message

```text
true                              # exit 0
false                             # exit 1
"done"                            # exit 0
[0, "Success"]                    # exit 0, prints "Success"
[1, "Failed"]                     # exit 1, prints "Failed"
```

## Idiomatic Patterns

### Let Data Flow

Prefer implied `$` over explicit captures when the value flows directly to the next statement:

```text
# Verbose — unnecessary capture
prompt("check status") -> $status
$status -> .empty ? error("No status")

# Idiomatic — data flows naturally
prompt("check status")
.empty ? error("No status")
```

The previous statement's result becomes `$` for the next statement. Only capture to a named variable when you need to reference it later by name.

### Chain Control Flow

Control flow operators (`?`, `@`) at statement start consume `$` implicitly:

```text
prompt("run tests")

.contains("FAIL") ? {
  @(!.empty, max: 3) {
    "Fixing..." -> log
    prompt("fix and retest")
  }
  .empty ? [0, "Fixed"] ! [1, "Failed"]
} ! {
  [0, "Pass"]
}
```

### Capture for Reuse

Capture when you need the value in multiple places or in interpolation after other statements:

```text
prompt("analyze {$file}") -> $analysis    # need $analysis twice below

.contains("ERROR") ? error("Analysis failed: {$analysis}")

prompt("Apply these suggestions:\n{$analysis}")
```

### Inline Logging

`log` passes through unchanged—use it inline for debugging:

```text
prompt("check") -> log -> .contains("READY") ? proceed()
```

### Pipe to Methods

Prefer pipe syntax over dot-access for method calls:

```text
# Verbose
$result.contains("ERROR")
$ -> .empty()

# Idiomatic
$result -> .contains("ERROR")
.empty()
```

Bare `.method()` implies `$` as receiver—no need to write it explicitly.

### Bare Conditionals

When piping a boolean, use bare `?`:

```text
# Verbose
($ready == true) ? proceed()
$ready ? proceed()

# Idiomatic (piped form)
$ready -> ? proceed()
```

## Grammar

The complete formal grammar is in [grammar.ebnf](grammar.ebnf). See [Closures](closures.md) for closure semantics.

**Key rules:**

- Statements separated by newlines
- Whitespace between tokens is insignificant
- Comments start with `#` and extend to end of line
- Conditionals: `cond ? then ! else` — condition precedes `?`, `!` introduces else
- Piped conditionals: `-> ? then ! else` — bare `?` uses `$` as condition
- Implied `$`: when `@` loop lacks a preceding `expression ->`, the pipe variable `$` is implied
