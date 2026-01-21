# rill Getting Started Guide

*A beginner-friendly introduction to pipe-based scripting*

## What is rill?

rill is a scripting language where data flows through pipes. Instead of assigning values to variables and then using them, you pipe data from one operation to the next.

```rill
"hello" -> .len
# Result: 5
```

rill is designed for orchestrating workflows—sequences of operations where each step transforms or acts on data from the previous step.

## Your First Script

The simplest rill script is just a value:

```rill
"Hello, world!"
```

This evaluates to `"Hello, world!"`. The last value in a script is its result.

## Pipes: The Core Concept

The `->` operator pipes a value to the next operation:

```rill
"hello" -> .trim
# Result: "hello"

42 -> ($ + 8)
# Result: 50
```

The special variable `$` refers to the current piped value. Inside a pipe chain, `$` holds whatever was piped in.

### Chaining Operations

Pipes chain naturally:

```rill
"  hello world  " -> .trim -> .split(" ")
# Result: ["hello", "world"]
```

Methods can also chain directly without `->`:

```rill
"  hello world  ".trim.split(" ")
# Result: ["hello", "world"]
```

Each `->` passes its left side to its right side. The result flows through the chain.

### Statement Flow

Each statement's result automatically becomes `$` for the next statement:

```rill
"hello"          # Result: "hello", $ becomes "hello"
.upper           # Uses $, result: "HELLO", $ becomes "HELLO"
.len             # Uses $, result: 5
```

This enables concise multi-line scripts without explicit piping between statements:

```rill
prompt("analyze this")
.contains("ERROR") ? error($) ! "OK"
```

The second line implicitly operates on the result of the first. This is equivalent to:

```rill
prompt("analyze this") -> $result
$result -> .contains("ERROR") ? error($result) ! "OK"
```

## Variables

Capture values into named variables with `-> $name`:

```rill
"hello" -> $greeting
$greeting -> .len -> $length
$length
# Result: 5
```

Variables start with `$` and hold any value type.

## Data Types

rill has seven value types:

| Type | Example |
|------|---------|
| String | `"hello"` |
| Number | `42`, `3.14`, `-7` |
| Boolean | `true`, `false` |
| List | `[1, 2, 3]` |
| Dict | `[name: "alice", age: 30]` |
| Tuple | `*[1, 2, 3]` |
| Closure | `\|x\|($x + 1)` |

### Strings

Strings support interpolation with `{expression}`. Any valid expression works:

```rill
"alice" -> $name
3 -> $a
5 -> $b
10 -> $count
true -> $ok
"Hello, {$name}!"                    # Variable interpolation
"sum: {$a + $b}"                     # Arithmetic
"valid: {$count > 0}"                # Comparison
"status: {$ok ? \"yes\" ! \"no\"}"   # Conditional
"upper: {$name -> .upper}"           # Method chain
```

Use `{{` and `}}` for literal braces:

```rill
"JSON: {{\"key\": \"value\"}}"       # Produces: JSON: {"key": "value"}
```

Multiline strings use heredoc syntax (also supports interpolation):

```rill
<<EOF
Hello, {$name}!
Line two
EOF
```

### Lists and Dicts

Lists hold ordered values:

```rill
[1, 2, 3] -> $nums
$nums[0]        # 1
$nums[-1]       # 3 (last element)
$nums -> .len   # 3
```

Dicts hold key-value pairs:

```rill
[name: "alice", age: 30] -> $person
$person.name    # "alice"
$person.age     # 30
```

## Methods

Methods are called with `.name()` syntax. The pipe value becomes the implicit first argument:

```rill
"hello world" -> .split(" ")
# Result: ["hello", "world"]

"hello" -> .contains("ell")
# Result: true

[1, 2, 3] -> map |x|($x * 2)
# Result: [2, 4, 6]
```

Common string methods: `.len`, `.trim`, `.split()`, `.contains()`, `.match()`, `.is_match()`, `.lower`, `.upper`, `.replace()`, `.replace_all()`

Common list operations: `.len`, `.head`, `.tail`, `.at()`, `.join()`, `map $fn`, `filter { }`

## Conditionals

Use `?` for if-else decisions:

```rill
# condition ? then-branch ! else-branch
true ? "yes" ! "no"
# Result: "yes"

5 -> ($ > 3) ? "big" ! "small"
# Result: "big"
```

The else branch (`! ...`) is optional:

```rill
# Only runs then-branch if true
true ? "executed"
```

### Piped Conditionals

When you pipe into `?`, the pipe value becomes the condition:

```rill
"hello" -> .contains("ell") ? "found it"
# Result: "found it"

"" -> .empty ? "nothing here" ! "has content"
# Result: "nothing here"
```

## Loops

### For-Each Loop

Iterate over a list with `each { body }`:

```rill
[1, 2, 3] -> each { $ * 2 }
# Result: [2, 4, 6]
```

Inside the loop body, `$` is the current element. The loop collects all body results into a new list.

### While Loop

When the left side of `@` is a boolean, it's a while loop. Use `$` as the accumulator:

```rill
0 -> ($ < 5) @ { $ + 1 }
# Result: 5
```

The body's result becomes the next iteration's `$`. The loop exits when the condition becomes false.

**Note:** Variables created inside the loop body exist only within that iteration (block scoping). Use `$` for accumulation.

### Breaking Out

Use `break` to exit a loop early:

```rill
[1, 2, 3, 4, 5] -> each {
  ($ == 3) ? break
  $
}
# Result: 3
```

## Closures (Functions)

Define reusable logic with closure syntax `|params| body`. See [Closures](closures.md) for advanced patterns including late binding and dict-bound closures.

```rill
|x|($x * 2) -> $double

5 -> $double()
# Result: 10

[1, 2, 3] -> map $double
# Result: [2, 4, 6]
```

### Multiple Parameters

```rill
|a, b|($a + $b) -> $add

$add(3, 4)
# Result: 7
```

### Type Annotations

Optional type hints help catch errors:

```rill
|name: string, age: number| "Name: {$name}, Age: {$age}"
```

## Property Access

Access dict fields and list indices:

```rill
[name: "alice", scores: [85, 92, 78]] -> $data

$data.name           # "alice"
$data.scores[0]      # 85
$data.scores[-1]     # 78 (last)
```

### Safe Access

Use `??` for default values when a field might be missing:

```rill
$data.nickname ?? "anonymous"
# Result: "anonymous" (if no nickname field)
```

Use `.?` to check existence:

```rill
$data.?nickname      # false
$data.?name          # true
```

## Blocks

Group multiple statements in braces. The last value is the block's result:

```rill
{
  "hello" -> $greeting
  $greeting -> .upper -> $shouted
  "{$shouted}!"
}
# Result: "HELLO!"
```

Use `return` to exit a block early:

```rill
{
  5 -> $x
  ($x > 3) ? ("big" -> return)
  "small"
}
# Result: "big"
```

## Annotations

Annotations modify how statements execute. The most common is `limit` for loops:

```rill
# Limit loop to 100 iterations max ($ flows through as accumulator)
^(limit: 100) false -> ($ == false) @ {
  check_status()
}
```

Without a limit, while loops default to 10,000 max iterations.

## Putting It Together

Here's a complete example that processes a list of names:

```rill
["alice", "bob", "charlie"] -> $names
$names -> map |name| { "{$name}: {$name -> .len} chars" } -> $descriptions
$descriptions -> .join(", ")
```

## Key Differences from Other Languages

1. **No `=` assignment** — Use `->` to pipe values into variables
2. **No null/undefined** — Empty strings and lists are valid; "no value" doesn't exist
3. **No exceptions** — Errors halt execution; use conditionals for error handling
4. **Immutable types** — Once a variable holds a string, it always holds strings
5. **Value semantics** — All comparisons are by value, all copies are deep

## Next Steps

- [Reference](reference.md) — Complete language specification
- [Closures](closures.md) — Late binding, dict-bound, and invocation patterns
- [Collections](collections.md) — `each`, `map`, `filter`, `fold` operators
- [Examples](examples.md) — Workflow patterns

## Quick Reference Card

```text
# Pipes
value -> operation          # pipe value to operation
value -> $var               # capture into variable
$                           # current pipe value

# Types
"string"                    # string
42, 3.14                    # number
true, false                 # boolean
[1, 2, 3]                   # list
[a: 1, b: 2]                # dict
|x|($x + 1)                 # closure

# Conditionals
cond ? then ! else          # if-else
value -> ? then             # piped if (value is condition)

# Loops
list -> each { body }       # for-each
(bool) @ { body }           # while
@ { body } ? cond           # do-while
break                       # exit loop
return                      # exit block

# Collection Operators
-> each { body }            # sequential, all results
-> each(init) { $@ + $ }    # with accumulator
-> map { body }             # parallel, all results
-> fold(init) { $@ + $ }    # reduction, final only

# Access
$data.field                 # dict field
$list[0]                    # list index
$data.field ?? default      # with default
$data.?field                # existence check

# Annotations
^(limit: 100) statement     # set iteration limit
```
