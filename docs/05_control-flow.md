# rill Control Flow

*Conditionals, loops, break, and return*

## Overview

rill provides singular control flow—no exceptions, no try/catch. Errors halt execution. Recovery requires explicit conditionals.

| Syntax | Description |
|--------|-------------|
| `cond ? then ! else` | Conditional (if-else) |
| `$val -> ? then ! else` | Piped conditional (uses $ as cond) |
| `(cond) @ body` | While loop (cond is bool) |
| `@ body ? cond` | Do-while (body first) |
| `break` / `$val -> break` | Exit loop |
| `return` / `$val -> return` | Exit block |

---

## Conditionals

`?` is the conditional operator. The condition precedes `?`, and `!` introduces the else clause.

### Syntax Forms

```text
condition ? then-body
condition ? then-body ! else-body
$val -> ? then-body ! else-body     # piped form: $ is the condition
```

### Standalone Form

Condition precedes `?`:

```rill
true ? "yes" ! "no"                 # "yes"
false ? "yes" ! "no"                # "no"
(5 > 3) ? "big" ! "small"           # grouped comparison as condition
```

### Piped Form

Use `$` as condition:

```rill
true -> ? "yes" ! "no"              # "yes" (pipe value must be bool)
5 -> ($ > 3) ? "big" ! "small"      # "big"
```

### Method Conditions

Methods that return booleans work directly as conditions:

```rill
"hello" -> .contains("ell") ? "found" ! "missing"    # "found"
"abc" -> !.empty ? "has content" ! "empty"           # "has content"
```

### Condition Forms

```rill
"test" -> ($ == "test") ? "match" ! "no"   # grouped comparison
"test" -> .eq("test") ? "match" ! "no"     # comparison method
"xyz" -> .contains("x") ? "found" ! "no"   # method as condition
```

### Optional Else

The else branch (`! ...`) is optional:

```rill
true ? "executed"                   # only runs if true
false ? "skipped"                   # returns empty string
```

### Else-If Chains

```rill
"B" :> $val
$val -> .eq("A") ? "a" ! .eq("B") ? "b" ! "other"   # "b"
```

### Return Value

Conditionals return the last expression of the executed branch:

```rill
true -> ? "yes" ! "no" :> $result   # "yes"
false -> ? "yes" ! "no" :> $result  # "no"
```

### Block Bodies

Use braces for multi-statement branches:

```rill
true -> ? {
  "step 1" -> log
  "step 2" -> log
  "done"
} ! {
  "skipped"
}
```

---

## While Loop

Pre-condition loop. Condition is evaluated before each iteration. The body result becomes the next iteration's `$`.

> **Note:** There is no `while` keyword. Use `(condition) @ { body }` syntax. Loop bodies cannot modify outer-scope variables—use `$` to carry all state. For multiple values, pack them in a dict.

### Syntax

```text
initial -> (condition) @ { body }
```

### Basic Usage

```rill
# Count to 5
0 -> ($ < 5) @ { $ + 1 }            # Result: 5

# String accumulation
"" -> (.len < 5) @ { "{$}x" }       # Result: "xxxxx"
```

### Condition Forms

```rill
0 -> ($ < 10) @ { $ + 1 }           # comparison condition
"" -> (.len < 5) @ { "{$}x" }       # method call condition
```

### Infinite Loop with Break

```rill
0 -> (true) @ {
  $ + 1 -> ($ > 5) ? break ! $
}  # Result: 6
```

### Loop Limits

Use `^(limit: N)` annotation to set maximum iterations (default: 10,000):

```rill
^(limit: 100) 0 -> ($ < 10) @ { $ + 1 }   # Runs 10 iterations, returns 10
```

Exceeding the limit throws `RuntimeError` with code `RUNTIME_LIMIT_EXCEEDED`.

### Multiple State Values

When you need to track multiple values across iterations, use `$` as a state dict:

```text
# Track iteration count, text, and done flag
[iter: 0, text: $input, done: false]
  -> (!$.done && $.iter < 3) @ {
    $.iter + 1 :> $i
    app::process($.text) :> $result
    $result.finished
      ? [iter: $i, text: $.text, done: true]
      ! [iter: $i, text: $result.text, done: false]
  }
# Access final state: $.text, $.iter
```

This pattern replaces the common (but invalid) approach of trying to modify outer variables from inside the loop.

---

## Do-While Loop

Post-condition loop. Body executes first, then condition is checked. Use when you want at least one execution.

### Syntax

```text
initial -> @ { body } ? (condition)
```

### Basic Usage

```rill
# Execute at least once, continue while condition holds
0 -> @ { $ + 1 } ? ($ < 5)          # Returns 5

# String accumulation
"" -> @ { "{$}x" } ? (.len < 3)     # Returns "xxx"
```

### When to Use

- **While** `(condition) @ { body }`: condition checked BEFORE body (may execute 0 times)
- **Do-while** `@ { body } ? (condition)`: condition checked AFTER body (executes at least once)

### Retry Pattern

Do-while is ideal for retry patterns:

```text
^(limit: 5) @ {
  app::prompt("Perform operation")
} ? (.contains("RETRY"))
# Loop exits when result doesn't contain RETRY
```

### Loop Limit

```rill
^(limit: 100) 0 -> @ { $ + 1 } ? ($ < 10)   # Returns 10
```

---

## Break

Exit a loop early. Returns the value piped to `break`, or current `$` if bare.

### Syntax

```text
break                    # exit with current $
$value -> break          # exit with value
```

### In Each Loop

```rill
[1, 2, 3, 4, 5] -> each {
  ($ > 3) ? ("found {$}" -> break)
  $
}
# Returns "found 4"
```

### In While Loop

```rill
0 -> (true) @ {
  ($ + 1) -> ($ > 3) ? break ! $
}
# Returns 4
```

### Break Value

In `each`, break returns partial results collected before the break:

```rill
["a", "b", "STOP", "c"] -> each {
  ($ == "STOP") ? break
  $
}
# Returns ["a", "b"] (partial results before break)
```

### Break Not Allowed

`break` is not supported in `map`, `filter`, or `fold` (parallel operations):

```text
[1, 2, 3] -> map { break }    # ERROR: break not supported in map
```

---

## Return

Exit a block early. Returns the value piped to `return`, or current `$` if bare.

### Syntax

```text
return                   # exit with current $
$value -> return         # exit with value
```

### In Blocks

```rill
{
  5 :> $x
  ($x > 3) ? ("big" -> return)
  "small"
}
# Returns "big"
```

### Multi-Phase Pipeline

```text
{
  "content" :> $data
  $data -> .contains("ERROR") ? ("Read failed" -> return)
  "processed: {$data}"
}
# Returns "processed: content" or "Read failed"
```

---

## Control Flow Summary

| Statement | Scope | Effect |
|-----------|-------|--------|
| `break` | Loop | Exit loop with current `$` |
| `$val -> break` | Loop | Exit loop with value |
| `return` | Block/Script | Exit block or script with current `$` |
| `$val -> return` | Block/Script | Exit block or script with value |

> **Note:** Script-level exit functions like `error()` or `stop()` must be provided by the host application. See [Host Integration](14_host-integration.md).

---

## Patterns

### Guard Clauses

Exit early on invalid conditions (assumes host provides `error()`):

```text
|data| {
  $data -> .empty ? app::error("Empty input")
  $data -> :?list ? $ ! app::error("Expected list")
  $data -> each { $ * 2 }
} :> $process
```

### Retry with Limit

```text
^(limit: 3) @ {
  app::prompt("Try operation")
} ? (.contains("RETRY"))

.contains("SUCCESS") ? [0, "Done"] ! [1, "Failed"]
```

### State Machine

```rill
"start" -> ($ != "done") @ {
  ($ == "start") ? "processing" ! ($ == "processing") ? "validating" ! ($ == "validating") ? "done" ! $
}
# Walks through states: start -> processing -> validating -> done
```

### Find First Match

```rill
[1, 2, 3, 4, 5] -> each {
  ($ > 3) ? ($ -> break)
  $
}
# Returns 4 (first element > 3)
```

---

## See Also

- [Variables](03_variables.md) — Scope rules and `$` binding
- [Collections](07_collections.md) — `each`, `map`, `filter`, `fold` iteration
- [Operators](04_operators.md) — Comparison and logical operators
- [Reference](11_reference.md) — Quick reference tables
