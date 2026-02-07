# rill Design Principles

*Code that embraces pipes, explicit booleans, sealed scopes, and value semantics*

---

## Core Model: Data Flows, Not State Mutates

Mainstream languages center on variables that hold and mutate state. rill centers on data flowing left-to-right through transformations.

### Mainstream mental model

1. Read variable
2. Modify variable
3. Write variable

### rill mental model

1. Data enters pipeline
2. Transformations shape it
3. Result emerges at the end


Every rill program answers one question: "What happens to this data as it moves through the pipe?"

---

## Six Principles That Break Mainstream Habits

### 1. Pipes Replace Assignment

No `=` operator exists. Data moves via `->`, values captured via `=>`.

```rill
# Data flows through transformations
"  hello world  " -> .trim -> .upper -> .split(" ")
# Result: ["HELLO", "WORLD"]

# Capture only when a value appears more than once
app::prompt("analyze") => $result
$result -> log
$result -> .contains("ERROR") ? { error "Analysis failed: {$result}" }
```

**Mainstream habit to break:** Creating intermediate variables for each step. In rill, let data flow. Capture only for reuse.

### 2. Null Does Not Exist

No null, undefined, nil, or None. Missing values produce errors. Use `??` for defaults and `.?` for existence checks.

```rill
[name: "alice"] => $user
$user.name ?? "anonymous"   # Default if missing
$user.?email                # Returns true or false
```

**Mainstream habit to break:** Checking for null before access. In rill, decide upfront what the default is, or let the error surface.

### 3. No Truthiness

Conditions must evaluate to boolean. Empty strings, zero, and empty lists are not "falsy."

```rill
# These are errors — conditions must be boolean:
# "" ? "yes"          ERROR
# 0 ? "yes"           ERROR
# [] ? "yes"          ERROR

# Explicit boolean conversion required:
"" -> .empty ? "empty"
0 -> ($ == 0) ? "zero"
[] -> .empty ? "no items"
```

**Mainstream habit to break:** Using values directly as conditions. In rill, convert to boolean explicitly with `.empty`, comparisons, or `:?type`.

### 4. No Exceptions

Errors halt execution. No try/catch, no error recovery stack. Validate before acting.

```text
# Guard early
$input -> .empty ? error("Input required")

# Assert constraints
$data -> assert :?list "Expected list"

# Check patterns in results
$response -> .contains("ERROR") ? error("Failed: {$response}")
```

**Mainstream habit to break:** Wrapping operations in try/catch. In rill, validate inputs and check outputs with conditionals.

### 5. Scopes Are Sealed

Inner scopes cannot read or modify outer variables created after the scope opens. Loop bodies cannot mutate variables from the enclosing scope.

```text
# This does NOT work — inner => creates a local:
0 => $count
[1, 2, 3] -> each { $count + 1 => $count }
$count  # Still 0

# Use accumulators instead:
[1, 2, 3] -> fold(0) { $@ + 1 }            # Final: 3
[1, 2, 3] -> each(0) { $@ + $ }            # Running: [1, 3, 6]
0 -> ($ < 5) @ { $ + 1 }                   # While: 5
[result: "", done: false] -> (!.done) @ {  # While: "aaaaa"
  [result: "a{.result}", .result.len == 5]
}
```

**Mainstream habit to break:** Mutating a counter or accumulator variable from inside a loop. In rill, `$` carries state forward through iterations, and `$@` holds the accumulator in fold/each(init).

### 6. Everything Is a Value

No references. All copies are deep. All comparisons are by value. Types lock on first assignment.

```rill
[1, 2, 3] == [1, 2, 3]    # true — content equality
[1, 2] => $a
$a => $b                   # $b is an independent deep copy
```

**Mainstream habit to break:** Expecting two variables to point at the same object. In rill, every binding holds its own copy.

### 7. Variables Have `$` Prefix

All variables start with `$`: `$name`, `$result`, `$config`. This is a deliberate design choice, not syntactic sugar.

**Why `$` exists:**

The `$` prefix enables **single-pass, unambiguous parsing** without a symbol table. The parser can distinguish constructs at tokenization:

| Syntax | Meaning |
|--------|---------|
| `name()` | Host function call |
| `$name()` | Closure invocation |
| `$name` | Variable reference |
| `name` in dict | Key literal |

Without `$`, `process(data)` is ambiguous: is `process` a host function or a stored closure? Is `data` a variable or a key? Resolving this requires tracking all declarations—turning a simple parser into a multi-pass compiler.

**Additional disambiguation:**

- **Capture syntax:** `=> $x` requires `$` for lookahead. Without it, slice syntax `/<1:>` becomes ambiguous.
- **Destructuring:** `*<$a, $b>` uses `$` to mark variables vs. skip patterns or dict keys.
- **Dynamic field access:** `$data.$key` distinguishes variable-as-key from literal field.
- **Visual clarity:** Code is readable without context. `$total` is always a variable.

**Alternatives considered:**

| Approach | Problem |
|----------|---------|
| Different prefix (`@name`) | Same complexity, no improvement |
| Type annotations required | Doubles verbosity, needs type registry at parse |
| `var` keyword | Still can't distinguish `fn()` (host) from `$fn()` (closure) |
| Context-aware parsing | 3-5x slower, requires symbol table |

The `$` prefix follows rill's "no magic" principle: syntax communicates intent without requiring context or implicit rules.

**Mainstream habit to break:** Expecting bare identifiers for variables. In rill, `$` makes the distinction between variables, functions, and dict keys explicit and unambiguous.

---

## Rillistic Idioms

### Flow, Don't Store

```text
# Not rillistic: unnecessary intermediates
"hello" => $step1
$step1 -> .upper => $step2
$step2 -> .len => $step3
$step3

# Rillistic: let data flow
"hello" -> .upper -> .len
```

### Shorthand in Collection Operators

```rill
# Not rillistic: verbose closure
["hello", "world"] -> map |x| { $x.upper() }

# Rillistic: method shorthand
["hello", "world"] -> map .upper
```

### Defaults Over Conditionals

```text
# Not rillistic: verbose existence check
$dict.?field ? $dict.field ! "default"

# Rillistic: default operator
$dict.field ?? "default"
```

### Accumulators Over Mutation

```text
# Not rillistic: trying to mutate outer scope
"" => $result
["a", "b", "c"] -> each { $result + $ => $result }

# Rillistic: fold produces the value
["a", "b", "c"] -> fold("") { $@ + $ }
```

### Explicit Booleans Over Coercion

```rill
"hello" => $str
$str -> .empty ? "no" ! "yes"
```

### `$` in Context, Parameters in Closures

```text
# Rillistic: $ in inline pipes and loops
"hello" -> { .upper }
[1, 2, 3] -> each { $ * 2 }
0 -> ($ < 5) @ { $ + 1 }

# Rillistic: named params in stored closures
|x| ($x * 2) => $double
5 -> $double
```

`$` binds to the current pipe context. Stored closures use named parameters because `$` is undefined when called later.

---

## Summary Table

| Mainstream concept | rill replacement |
|---|---|
| `x = value` | `value => $x` or `value -> transform` |
| `null` / `undefined` | `??` default, `.?` existence check |
| Truthiness (`if ""`) | `.empty`, `== 0`, `:?type` |
| `try { } catch { }` | `assert`, conditionals, `error()` |
| `for (i = 0; ...)` | `each`, `map`, `filter`, `fold` |
| `count += 1` in loop | `fold(0) { $@ + 1 }` or `$` accumulator |
| `a === b` (reference) | `==` always compares by value |
| `a = b` (shared ref) | `=>` always deep-copies |

---

## See Also

- [Guide](guide-getting-started.md) — Beginner-friendly introduction
- [Reference](ref-language.md) — Language specification
- [Conventions](guide-conventions.md) — Naming and best practices
