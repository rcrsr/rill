# rill Collection Operators

*Sequential and parallel iteration with each, map, filter, and fold*

## Overview

rill provides four collection operators for transforming, filtering, and reducing data:

| Operator | Execution | Accumulator | Returns |
|----------|-----------|-------------|---------|
| `each` | Sequential | Optional | List of all results |
| `map` | Parallel | No | List of all results |
| `filter` | Parallel | No | Elements where predicate is true |
| `fold` | Sequential | Required | Final result only |

All four operators share similar syntax but differ in execution model and output.

> **Important:** Loop bodies cannot modify outer-scope variables (see [Variables](topic-variables.md)). Use `fold` or `each(init)` with accumulators instead.

```rill
# Sequential: results in order, one at a time
list[1, 2, 3] -> each { $ * 2 }     # list[2, 4, 6]

# Parallel: results in order, concurrent execution
list[1, 2, 3] -> map { $ * 2 }      # list[2, 4, 6]

# Parallel filter: keep matching elements
list[1, 2, 3, 4, 5] -> filter { $ > 2 }  # list[3, 4, 5]

# Reduction: accumulates to single value
list[1, 2, 3] -> fold(0) { $@ + $ } # 6
```

## Body Forms

Each operator accepts multiple body syntaxes. Choose based on readability and complexity.

| Form | Syntax | When to Use |
|------|--------|-------------|
| Block | `{ body }` | Multi-statement logic; `$` is current element |
| Grouped | `( expr )` | Single expression; `$` is current element |
| Inline closure | `\|x\| body` | Named parameters; reusable logic |
| Variable | `$fn` | Pre-defined closure; maximum reuse |
| Identity | `$` | Return elements unchanged |
| Method | `.method` | Apply method to each element |

### Block Form

Use braces for multi-statement bodies. `$` refers to the current element.

```rill
list[1, 2, 3] -> each {
  $ => $x
  $x * 2
}
# Result: list[2, 4, 6]
```

### Grouped Expression

Use parentheses for single expressions. `$` refers to the current element.

```rill
list[1, 2, 3] -> each ($ + 10)
# Result: list[11, 12, 13]
```

### Inline Closure

Define parameters explicitly. The first parameter receives each element.

```rill
list[1, 2, 3] -> each |x| ($x * 2)
# Result: list[2, 4, 6]
```

### Variable Closure

Reference a pre-defined closure by variable.

```rill
|x| ($x * 2) => $double
list[1, 2, 3] -> each $double
# Result: list[2, 4, 6]
```

### Identity

Use bare `$` to return elements unchanged.

```rill
list[1, 2, 3] -> each $
# Result: list[1, 2, 3]
```

### Method Shorthand

Use `.method` to apply a method to each element. Equivalent to `{ $.method() }`.

```rill
list["hello", "world"] -> each .upper
# Result: list["HELLO", "WORLD"]

list["  hi  ", " there "] -> map .trim
# Result: list["hi", "there"]

list["hello", "", "world"] -> filter .empty
# Result: list[""]
```

Methods can take arguments:

```rill
list["a", "b"] -> map .pad_start(3, "0")
# Result: list["00a", "00b"]
```

Chain multiple methods:

```rill
list["  HELLO  ", "  WORLD  "] -> map .trim.lower
# Result: list["hello", "world"]
```

For negation, use grouped expression:

```rill
list["hello", "", "world"] -> filter (!.empty)
# Result: list["hello", "world"]
```

---

## each — Sequential Iteration

`each` iterates over a collection in order. Each iteration completes before the next begins.

```rill
collection -> each body
collection -> each (init) body   # with accumulator
```

### Basic Usage

```rill
# Double each number
list[1, 2, 3] -> each { $ * 2 }
# Result: list[2, 4, 6]

# Transform strings
list["a", "b", "c"] -> each { "{$}!" }
# Result: list["a!", "b!", "c!"]

# Iterate string characters
"hello" -> each $
# Result: list["h", "e", "l", "l", "o"]
```

### Dict Iteration

When iterating over a dict, `$` contains `key` and `value` fields.

```rill
dict[name: "alice", age: 30] -> each { "{$.key}: {$.value}" }
# Result: list["name: alice", "age: 30"]

dict[a: 1, b: 2, c: 3] -> each { $.value * 2 }
# Result: list[2, 4, 6]
```

### With Accumulator

`each` supports an optional accumulator for stateful iteration. Two syntaxes exist.

#### Block Form with `$@`

Place initial value in parentheses before the block. Access accumulator via `$@`.

```rill
# Running sum (scan pattern)
list[1, 2, 3] -> each(0) { $@ + $ }
# Result: list[1, 3, 6]

# String concatenation
list["a", "b", "c"] -> each("") { "{$@}{$}" }
# Result: list["a", "ab", "abc"]
```

#### Inline Closure Form

Define accumulator as the last parameter with a default value.

```rill
# Running sum
list[1, 2, 3] -> each |x, acc = 0| ($acc + $x)
# Result: list[1, 3, 6]
```

### Early Termination

Use `break` to exit `each` early. Returns partial results collected before the break.

```rill
list[1, 2, 3, 4, 5] -> each {
  ($ == 3) ? break
  $ * 2
}
# Result: list[2, 4] (partial results before break)
```

### Empty Collections

`each` returns `[]` for empty collections. The body never executes.

```rill
list[] -> each { $ * 2 }
# Result: list[]

# With accumulator, still returns [] (not the initial value)
list[] -> each(0) { $@ + $ }
# Result: list[]
```

---

## map — Parallel Iteration

`map` iterates concurrently using `Promise.all`. Order is preserved despite parallel execution.

```rill
collection -> map body
```

### Basic Usage

```rill
# Map with closure parameter
list["a", "b", "c"] -> map |x| { "{$x}!" }
# Result: list["a!", "b!", "c!"]

# Block expression (implicit $)
list[1, 2, 3] -> map { $ * 2 }
# Result: list[2, 4, 6]

# Grouped expression
list[1, 2, 3] -> map ($ * 2)
# Result: list[2, 4, 6]
```

### Key Differences from each

1. **No accumulator**: Parallel execution has no "previous" value
2. **No break**: Cannot exit early from concurrent operations
3. **Concurrent execution**: All iterations start immediately

### When to Use map

Use `map` when:
- Operations are independent (no shared state)
- Order of execution doesn't matter (results still ordered)
- I/O-bound operations benefit from concurrency

```rill
# CPU-bound: same result as each, but runs in parallel
list[1, 2, 3, 4, 5] -> map { $ * $ }
# Result: list[1, 4, 9, 16, 25]
```

### Empty Collections

`map` returns `[]` for empty collections. The body never executes.

```rill
list[] -> map { $ * 2 }
# Result: list[]
```

---

## filter — Parallel Filtering

`filter` keeps elements where the predicate returns `true`. Predicates must return boolean values. Executes concurrently using `Promise.all`.

```rill
collection -> filter body
```

### Basic Usage

```rill
# Keep numbers greater than 2
list[1, 2, 3, 4, 5] -> filter { $ > 2 }
# Result: list[3, 4, 5]

# Keep non-empty strings
list["hello", "", "world", ""] -> filter { !.empty }
# Result: list["hello", "world"]

# Keep even numbers
list[1, 2, 3, 4, 5, 6] -> filter { ($ % 2) == 0 }
# Result: list[2, 4, 6]
```

### All Body Forms

`filter` accepts the same body forms as `map`:

```rill
# Block form
list[1, 2, 3, 4, 5] -> filter { $ > 2 }

# Grouped expression
list[1, 2, 3, 4, 5] -> filter ($ > 2)

# Inline closure
list[1, 2, 3, 4, 5] -> filter |x| ($x > 2)

# Variable closure
|x| ($x > 2) => $gtTwo
list[1, 2, 3, 4, 5] -> filter $gtTwo
```

### Dict Filtering

When filtering a dict, `$` contains `key` and `value` fields. Returns list of matching entries.

```rill
dict[a: 1, b: 5, c: 3] -> filter { $.value > 2 }
# Result: list[dict[key: "b", value: 5], dict[key: "c", value: 3]]
```

### String Filtering

Filters characters in a string.

```rill
"hello" -> filter { $ != "l" }
# Result: ["h", "e", "o"]
```

### Chaining with Other Operators

```rill
# Filter then transform
list[1, 2, 3, 4, 5] -> filter { $ > 2 } -> map { $ * 2 }
# Result: list[6, 8, 10]

# Transform then filter
list[1, 2, 3, 4, 5] -> map { $ * 2 } -> filter { $ > 5 }
# Result: list[6, 8, 10]

# Filter, transform, reduce
list[1, 2, 3, 4, 5] -> filter { $ > 2 } -> map { $ * 2 } -> fold(0) { $@ + $ }
# Result: 24
```

### Empty Collections

`filter` returns `[]` for empty collections or when nothing matches.

```rill
list[] -> filter { $ > 0 }
# Result: list[]

list[1, 2, 3] -> filter { $ > 10 }
# Result: list[]
```

---

## fold — Sequential Reduction

`fold` reduces a collection to a single value. Requires an accumulator.

Syntax forms:
- Block form: `collection -> fold(init) { body }`
- Closure form: `collection -> fold |x, acc = init| (body)`
- Variable closure: `collection -> fold $fn`

### Basic Usage

```rill
# Sum numbers
list[1, 2, 3] -> fold(0) { $@ + $ }
# Result: 6

# Same with inline closure
list[1, 2, 3] -> fold |x, sum = 0| ($sum + $x)
# Result: 6
```

### Common Patterns

#### Sum

```rill
list[1, 2, 3, 4, 5] -> fold(0) { $@ + $ }
# Result: 15
```

#### Product

```rill
list[1, 2, 3, 4] -> fold(1) { $@ * $ }
# Result: 24
```

#### Maximum

```rill
list[3, 1, 4, 1, 5, 9] -> fold(0) {
  ($@ > $) ? $@ ! $
}
# Result: 9
```

#### Count

```rill
list[1, 2, 3, 4, 5] -> fold(0) { $@ + 1 }
# Result: 5
```

#### String Join

```rill
list["a", "b", "c"] -> fold("") { "{$@}{$}" }
# Result: "abc"

# With separator
list["a", "b", "c"] -> fold |x, acc = ""| {
  ($acc -> .empty) ? $x ! "{$acc},{$x}"
}
# Result: "a,b,c"
```

### Dict Reduction

When folding over a dict, `$` contains `key` and `value` fields.

```rill
dict[a: 1, b: 2, c: 3] -> fold |entry, sum = 0| ($sum + $entry.value)
# Result: 6
```

### Reusable Reducers

Define closures for common reductions.

```rill
# Define reusable reducers
|x, sum = 0| ($sum + $x) => $summer
|x, max = 0| (($x > $max) ? $x ! $max) => $maxer

# Use with different data
list[1, 2, 3] -> fold $summer => $r1     # 6
list[3, 7, 2] -> fold $maxer => $r2      # 7
list[9, 1, 5] -> fold $maxer => $r3      # 9
```

### Empty Collections

`fold` returns the initial value for empty collections. The body never executes.

```rill
list[] -> fold(0) { $@ + $ }
# Result: 0

list[] -> fold(42) { $@ + $ }
# Result: 42

list[] -> fold |x, acc = 100| ($acc + $x)
# Result: 100
```

---

## Comparison: each vs fold

Both `each` and `fold` support accumulators. The difference is in what they return.

| Feature | each | fold |
|---------|------|------|
| Returns | List of ALL results | Final result ONLY |
| Use case | Scan/prefix-sum | Reduce/aggregate |

### Side-by-Side Example

```rill
# each: returns every intermediate result
list[1, 2, 3] -> each(0) { $@ + $ }
# Result: list[1, 3, 6]  (running totals)

# fold: returns only the final result
list[1, 2, 3] -> fold(0) { $@ + $ }
# Result: 6  (final sum)
```

### When to Choose

Use `each` with accumulator when you need intermediate states (scan pattern):

```rill
# Running balance
list[100, -50, 200, -75] -> each(0) { $@ + $ }
# Result: list[100, 50, 250, 175]
```

Use `fold` when you only need the final result:

```rill
# Final balance
list[100, -50, 200, -75] -> fold(0) { $@ + $ }
# Result: 175
```

---

## Chaining Operators

Combine operators for multi-stage transformations.

```rill
# Double each element, then sum
list[1, 2, 3] -> map { $ * 2 } -> fold(0) { $@ + $ }
# Result: 12

# Filter even numbers (using parallel filter)
list[1, 2, 3, 4, 5] -> filter { ($ % 2) == 0 }
# Result: list[2, 4]

# Complex pipeline: filter, then transform
list[1, 2, 3, 4, 5] -> filter { $ > 2 } -> map { $ * 10 }
# Result: list[30, 40, 50]
```

---

## Closure Arity Rules

For inline closures with accumulators, specific rules apply.

### Requirements

1. At least 2 parameters — first receives element, last is accumulator
2. Last parameter must have default — the default is the initial value
3. Parameters between first and last must have defaults — no gaps
4. Incoming args must exactly fill params before accumulator

### Valid Closures

| Closure | Element Params | Accumulator | Notes |
|---------|---------------|-------------|-------|
| `\|x, acc = 0\|` | 1 required | `acc` | Standard case |
| `\|x = 1, acc = 0\|` | 1 optional | `acc` | Element overrides default |
| `\|a, b = 0, acc = 0\|` | 1 required, 1 optional | `acc` | `b` unused |

### Invalid Closures

| Closure | Problem |
|---------|---------|
| `\|x\|` | No accumulator parameter |
| `\|acc = 0\|` | Only 1 param; element overwrites accumulator |
| `\|x, acc\|` | Accumulator has no default |
| `\|a, b, acc = 0\|` | Gap: `b` has no default |

---

## Error Cases

| Case | Example | Error |
|------|---------|-------|
| fold without accumulator | `[1,2] -> fold { $ }` | fold requires accumulator |
| fold closure missing default | `[1,2] -> fold \|x, acc\| body` | accumulator requires default |
| break in map | `[1,2] -> map { break }` | break not supported in map |
| break in fold | `[1,2] -> fold(0) { break }` | break not supported in fold |

---

## Iterating Different Types

### Lists

```rill
list[1, 2, 3] -> each { $ * 2 }
# Result: list[2, 4, 6]
```

### Strings

Iterates over characters.

```rill
"abc" -> each { "{$}!" }
# Result: list["a!", "b!", "c!"]
```

### Dicts

Iterates over entries with `key` and `value` fields.

```rill
dict[a: 1, b: 2] -> each { "{$.key}={$.value}" }
# Result: list["a=1", "b=2"]
```

---

## Nested Collections

Process nested structures with nested operators.

```rill
# Double nested values
list[list[1, 2], list[3, 4]] -> map |inner| { $inner -> map { $ * 2 } }
# Result: list[list[2, 4], list[6, 8]]

# Sum all nested values
list[list[1, 2], list[3, 4]] -> fold(0) |inner, total = 0| { $total + ($inner -> fold(0) { $@ + $ }) }
# Result: 10
```

---

## Performance Considerations

### Sequential vs Parallel

| Scenario | Recommendation |
|----------|----------------|
| CPU-bound computation | `each` or `map` (similar performance) |
| I/O-bound operations | `map` (concurrent benefits) |
| Order-dependent logic | `each` (guaranteed order) |
| Stateful accumulation | `each` or `fold` (no parallel option) |

### Memory

- `each` and `map` allocate result lists proportional to input size
- `fold` maintains constant memory (accumulator only)

---

## Quick Reference

```text
# each - sequential, all results
list[1, 2, 3] -> each { $ * 2 }           # list[2, 4, 6]
list[1, 2, 3] -> each(0) { $@ + $ }       # list[1, 3, 6] (running sum)

# map - parallel, all results
list[1, 2, 3] -> map { $ * 2 }            # list[2, 4, 6]
list["a", "b"] -> map |x| { "{$x}!" }     # list["a!", "b!"]

# filter - parallel, matching elements
list[1, 2, 3, 4, 5] -> filter { $ > 2 }   # list[3, 4, 5]
|x| { $x % 2 == 0 } => $isEven
list[1, 2, 3, 4, 5] -> filter $isEven     # list[2, 4]

# fold - sequential, final result only
list[1, 2, 3] -> fold(0) { $@ + $ }       # 6
list[1, 2, 3] -> fold |x, s = 0| ($s + $x) # 6

# Dict iteration
dict[a: 1, b: 2] -> each { $.key }        # list["a", "b"]
dict[a: 1, b: 2] -> each { $.value }      # list[1, 2]

# Break (each only)
list[1, 2, 3] -> each { ($ > 2) ? break ! $ }  # list[1, 2] (partial results)

# Empty collections
list[] -> each { $ }      # list[]
list[] -> map { $ }       # list[]
list[] -> filter { $ }    # list[]
list[] -> fold(42) { $ }  # 42
```

---

## See Also

- [Iterators](topic-iterators.md) — Lazy sequences with `range`, `repeat`, `.first()`
- [Reference](ref-language.md) — Complete language specification
- [Closures](topic-closures.md) — Closure semantics and patterns
- [Guide](guide-getting-started.md) — Beginner introduction
- [Examples](guide-examples.md) — Workflow examples
