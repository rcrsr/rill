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
| `assert cond` / `assert cond "msg"` | Validate condition, halt on failure |
| `error "msg"` / `$val -> error` | Halt execution with error message |

---

## Conditionals

`?` is the conditional operator. The condition precedes `?`, and `!` introduces the else clause.

### Syntax Forms

```text
condition ? then-body
condition ? then-body ! else-body
$val -> ? then-body ! else-body     # piped form: $ is the condition

# Multi-line forms (? and ! work as line continuations)
condition
  ? then-body
  ! else-body

value -> is_valid
  ? "ok"
  ! "error"
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
"B" => $val
$val -> .eq("A") ? "a" ! .eq("B") ? "b" ! "other"   # "b"
```

Multi-line else-if chains improve readability:

```rill
"B" => $val
$val -> .eq("A") ? "a"
  ! .eq("B") ? "b"
  ! "other"
# Result: "b"
```

### Return Value

Conditionals return the last expression of the executed branch:

```rill
true -> ? "yes" ! "no" => $result   # "yes"
false -> ? "yes" ! "no" => $result  # "no"
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

Block bodies work with multi-line conditionals:

```rill
"data" => $input
$input -> .empty
  ? { error "Empty input" }
  ! { $input -> .upper }
# Result: "DATA"
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
    $.iter + 1 => $i
    app::process($.text) => $result
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

```rill
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
  5 => $x
  ($x > 3) ? ("big" -> return)
  "small"
}
# Returns "big"
```

### Multi-Phase Pipeline

```rill
{
  "content" => $data
  $data -> .contains("ERROR") ? ("Read failed" -> return)
  "processed: {$data}"
}
# Returns "processed: content" or "Read failed"
```

---

## Assert

Validate conditions during execution. Halts the script with a clear error if the assertion fails.

### Syntax

```text
assert condition
assert condition "error message"
$value -> assert condition
```

### Basic Usage

Assert halts execution when the condition evaluates to `false`. If the condition is `true`, the piped value passes through unchanged.

```rill
5 -> assert ($ > 0)              # Returns 5 (condition true)
-1 -> assert ($ > 0)             # Error: Assertion failed
```

### Custom Error Messages

Provide a descriptive message as the second argument:

```rill
"" -> assert !.empty "Empty input not allowed"
# Error: Empty input not allowed

[1, 2, 3] -> assert (.len > 0) "List cannot be empty"
# Returns [1, 2, 3] (assertion passes)
```

### Type Assertions

Combine with type checks to validate input:

```rill
"hello" -> assert $:?string      # Returns "hello" (type check passes)
42 -> assert $:?string           # Error: Assertion failed
```

### In Loops

Assert validates each iteration. The loop halts on the first failing assertion:

```rill
[1, 2, 3] -> each {
  assert ($ > 0) "Must be positive"
}
# Returns [1, 2, 3] (all elements valid)

[1, 0, 3] -> each {
  assert ($ > 0) "Must be positive"
}
# Error: Must be positive
```

### Pipe Passthrough

When the assertion passes, the piped value flows through unchanged:

```rill
"data" => $input
$input
  -> assert !.empty "Input required"
  -> .upper
  -> assert (.len > 0) "Processed value required"
# Returns "DATA"
```

### Error Behavior

Assert throws `RuntimeError` when:

| Condition | Error Code | Message |
|-----------|-----------|---------|
| Condition is `false` | `RUNTIME_ASSERTION_FAILED` | Custom message or "Assertion failed" |
| Condition is not boolean | `RUNTIME_TYPE_ERROR` | "assert requires boolean condition, got {type}" |

```rill
# Non-boolean condition
"test" -> assert $               # Error: assert requires boolean condition, got string

# Failed assertion with location
-1 -> assert ($ > 0)             # Error: Assertion failed
```

### Validation Patterns

Guard clauses at function start:

```rill
|data| {
  assert $data:?list "Expected list"
  assert !$data.empty "List cannot be empty"
  $data -> each { $ * 2 }
} => $process
```

Multi-step validation:

```rill
$input
  -> assert $:?string "Input must be string"
  -> .trim
  -> assert !.empty "Trimmed input cannot be empty"
  -> assert (.len >= 5) "Input too short (min 5 chars)"
  -> app::process()
```

---

## Error

Halt execution immediately with a custom error message. Unlike `assert`, which validates a condition, `error` always halts.

### Syntax

```text
error "message"              # Direct form
$value -> error              # Piped form
```

### Basic Usage

Use `error` with a string literal to halt with a message:

```text
error "Something went wrong"
# Halts execution with: Something went wrong
```

The message argument accepts string literals or piped string values (see Piped Form below).

### Piped Form

Pipe a string value to `error` to use dynamic error messages:

```text
"Operation failed" -> error
# Halts with: Operation failed
```

The piped value must be a string:

```text
"Error occurred" => $msg
$msg -> error
# Halts with: Error occurred

"Status: " => $prefix
404 => $code
"{$prefix}{$code}" -> error
# Halts with: Status: 404
```

Piping non-string values throws a type error:

```text
42 -> error                      # Error: error requires string, got number
```

### String Interpolation

Use interpolation for dynamic error messages:

```text
404 => $code
error "Unexpected status: {$code}"
# Halts with: Unexpected status: 404
```

```text
3 => $step
"timeout" => $reason
error "Failed at step {$step}: {$reason}"
# Halts with: Failed at step 3: timeout
```

### Conditional Usage

Combine `error` with conditionals for guard clauses:

```rill
5 => $x
($x < 0) ? { error "Number must be non-negative" } ! $x
# Returns 5 (condition false, proceeds with else branch)
```

```rill
$data -> .empty ? { error "Data cannot be empty" } ! $data
# Proceeds with $data if not empty
```

### In Blocks

Use `error` in blocks for multi-step validation:

```rill
|age| {
  ($age < 0) ? { error "Age cannot be negative: {$age}" }
  ($age > 150) ? { error "Age out of range: {$age}" }
  "Valid age: {$age}"
} => $validate_age
```

### Error Behavior

Error throws `RuntimeError` with code `RUNTIME_ERROR_RAISED`:

| Pattern | Halts With | Message Source |
|---------|-----------|----------------|
| `error "msg"` | RUNTIME_ERROR_RAISED | String literal |
| `$val -> error` | RUNTIME_ERROR_RAISED | Piped value (must be string) |
| `error ""` | RUNTIME_ERROR_RAISED | Empty message |
| `error 123` | Parse error | PARSE_INVALID_SYNTAX |

All error responses include the source location from the error statement.

### Multiline Messages

Use triple-quoted strings for formatted error messages:

```text
error """
Error occurred:
- Line 1
- Line 2
"""
```

### Comparison with Assert

| Statement | Condition | Behavior |
|-----------|-----------|----------|
| `assert cond "msg"` | Validates condition | Halts if condition is false, passes through if true |
| `error "msg"` | None | Always halts with message |

Use `assert` when you need to validate a condition. Use `error` when you've already determined that execution cannot continue.

### In Loops

Error halts the loop immediately:

```text
[1, 2, 3] -> each {
  ($ == 2) ? { error "Halted at 2" }
  $ * 2
}
# Halts on second iteration with: Halted at 2
```

---

## Pass

The `pass` keyword returns the current pipe value (`$`) unchanged. Use it for explicit identity pass-through in conditional branches and dict values.

### In Conditionals

Use `pass` when one branch should preserve the piped value:

```rill
"input" -> .contains("in") ? pass ! "fallback"
# Returns "input" (condition true, pass preserves $)
```

```rill
"data" -> .empty ? { error "Empty input" } ! pass
# Returns "data" (condition false, pass preserves $)
```

### In Dict Values

Use `pass` to include the piped value in dict construction:

```rill
"success" -> { [status: pass, code: 0] }
# Returns [status: "success", code: 0]
```

### In Collection Operators

Preserve elements conditionally:

```rill
[1, -2, 3, -4] -> map { ($ > 0) ? pass ! 0 }
# Returns [1, 0, 3, 0]
```

### Why Use Pass?

The `pass` keyword provides clearer intent than bare `$`:

```text
# Less clear - what does $ mean here?
$cond ? do_something() ! $

# More explicit - reader knows this is intentional no-op
$cond ? do_something() ! pass
```

### Pass Behavior

| Pattern | Returns | Context |
|---------|---------|---------|
| `cond ? pass ! alt` | `$` if true, `alt` if false | Conditional branch |
| `cond ? alt ! pass` | `alt` if true, `$` if false | Conditional branch |
| `[key: pass]` | Dict with `$` as value | Dict construction |
| `-> { pass }` | `$` | Block body |

**Note:** `pass` requires pipe context. Using `pass` without `$` bound throws an error.

---

## Control Flow Summary

| Statement | Scope | Effect |
|-----------|-------|--------|
| `break` | Loop | Exit loop with current `$` |
| `$val -> break` | Loop | Exit loop with value |
| `return` | Block/Script | Exit block or script with current `$` |
| `$val -> return` | Block/Script | Exit block or script with value |
| `pass` | Any | Returns current `$` unchanged |
| `assert cond` | Any | Halt if condition false, pass through on success |
| `assert cond "msg"` | Any | Halt with custom message if condition false |
| `error "msg"` | Any | Always halt with error message |
| `$val -> error` | Any | Always halt with piped error message (must be string) |

---

## Patterns

### Guard Clauses

Exit early on invalid conditions (assumes host provides `error()`):

```rill
|data| {
  $data -> .empty ? app::error("Empty input")
  $data -> :?list ? $ ! app::error("Expected list")
  $data -> each { $ * 2 }
} => $process
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

- [Variables](topic-variables.md) — Scope rules and `$` binding
- [Collections](topic-collections.md) — `each`, `map`, `filter`, `fold` iteration
- [Operators](topic-operators.md) — Comparison and logical operators
- [Reference](ref-language.md) — Quick reference tables
