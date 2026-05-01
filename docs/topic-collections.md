# rill Collection Operators

*Six core iteration operators: seq, fan, filter, fold, acc, and sort (slicing and restructuring live in a companion file)*

## Overview

rill provides six core collection operators for transforming, filtering, reducing, and ordering data. Slicing, batching, windowing, and gating operators live in [Collection Slicing and Restructuring Operators](topic-collection-slicing.md). Source iterators (`range`, `repeat`, and the infinite-stream `iterate`) are documented in [Iterators](topic-iterators.md).

| Operator | Execution | Accumulator | Returns | Catches break? |
|----------|-----------|-------------|---------|----------------|
| `seq` | Sequential | No | List of all results | Yes |
| `fan` | Parallel | No | List of all results | No |
| `filter` | Parallel | No | Elements where predicate is true | No |
| `fold` | Sequential | Required | Final result only | No |
| `acc` | Sequential | Required | List of all intermediate results | Yes |
| `sort` | Eager | No | Sorted list or ordered | No |

All six operators are host-callable functions. They share similar invocation patterns but differ in execution model and output.

> **Important:** Loop bodies cannot modify outer-scope variables (see [Variables](topic-variables.md)). Use `fold` or `acc` with accumulators instead.

```rill
# Sequential: results in order, one at a time
[1, 2, 3] -> seq({ $ * 2 })
# Result: [2, 4, 6]

# Parallel: results in order, concurrent execution
[1, 2, 3] -> fan({ $ * 2 })
# Result: [2, 4, 6]

# Parallel filter: keep matching elements
[1, 2, 3, 4, 5] -> filter({ $ > 2 })
# Result: [3, 4, 5]

# Reduction: accumulates to single value
[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6

# Scan: accumulates, returns all intermediate values
[1, 2, 3] -> acc(0, { $@ + $ })
# Result: [1, 3, 6]
```

---

## seq — Sequential Iteration

**Signature:** `seq(list: list[T], body: (item: T) => U): list[U]`

`seq` iterates over a collection in order. Each iteration completes before the next begins. Returns a list of all body results.

**Invocation forms:** Both produce identical results. The pipe form auto-prepends the piped value as the first argument.

```rill
# Auto-prepend form (pipe supplies the list)
[1, 2, 3] -> seq({ $ * 2 })
# Result: [2, 4, 6]

# Explicit form (list slot filled explicitly)
seq([1, 2, 3], { $ * 2 })
# Result: [2, 4, 6]
```

> **Backward compatibility:** Existing `$list -> seq({...})` forms continue to work via auto-prepend. No migration needed.

```rill
# Transform strings
["a", "b", "c"] -> seq({ "{$}!" })
# Result: ["a!", "b!", "c!"]

# Iterate string characters
"hello" -> seq({ $ })
# Result: ["h", "e", "l", "l", "o"]
```

### Dict Iteration

When iterating over a dict, `$` contains `key` and `value` fields.

```rill
[name: "alice", age: 30] -> seq({ "{$.key}: {$.value}" })
# Result: ["name: alice", "age: 30"]

[a: 1, b: 2, c: 3] -> seq({ $.value * 2 })
# Result: [2, 4, 6]
```

### Variable Closure

Pass a pre-defined closure by reference.

```rill
|x| ($x * 2) => $double
[1, 2, 3] -> seq($double)
# Result: [2, 4, 6]
```

### Early Termination

`seq` catches `break`. Returns partial results collected before the break.

```rill
[1, 2, 3, 4, 5] -> seq({
  ($ == 3) ? break
  $ * 2
})
# Result: [2, 4]
```

### Empty Collections

`seq` returns `[]` for empty collections. The body never executes.

```rill
[] -> seq({ $ * 2 })
# Result: []
```

### Streams with seq

```text
use<ext:app> => $app

# Stream: each chunk is one call
$app.lines("file.txt") -> seq({ $ -> .upper })
# Returns list of uppercased lines
```

An empty stream returns `[]` without executing the body.

---

## fan — Parallel Iteration

**Signature:** `fan(list: list[T], body: (item: T) => list[U], options?: dict): list[U]`

`fan` iterates concurrently. Order is preserved despite parallel execution. Does not catch `break`.

> **Backward compatibility:** Existing `$list -> fan({...})` forms continue to work via auto-prepend. No migration needed.

**Invocation forms:** Both produce identical results. The pipe form auto-prepends the piped value as the first argument.

```rill
# Auto-prepend form (pipe supplies the list)
["a", "b", "c"] -> fan({ "{$}!" })
# Result: ["a!", "b!", "c!"]

# Explicit form (list slot filled explicitly)
fan(["a", "b", "c"], { "{$}!" })
# Result: ["a!", "b!", "c!"]
```

```rill
# Block expression (implicit $)
[1, 2, 3] -> fan({ $ * 2 })
# Result: [2, 4, 6]
```

### Concurrency Limit

Pass an options dict as the second argument to cap concurrent operations.

```rill
[1, 2, 3, 4, 5] -> fan({ $ * $ }, [concurrency: 2])
# Result: [1, 4, 9, 16, 25]
```

### Key Differences from seq

1. **No accumulator**: Parallel execution has no "previous" value
2. **No break**: `break` in a `fan` body bubbles up as a halt signal
3. **Concurrent execution**: All iterations start immediately

### When to Use fan

Use `fan` when:
- Operations are independent (no shared state)
- Order of execution does not matter (results still ordered)
- I/O-bound operations benefit from concurrency

```rill
# CPU-bound: same result as seq, but runs in parallel
[1, 2, 3, 4, 5] -> fan({ $ * $ })
# Result: [1, 4, 9, 16, 25]
```

### Empty Collections

`fan` returns `[]` for empty collections. The body never executes.

```rill
[] -> fan({ $ * 2 })
# Result: []
```

### Streams with fan

```text
use<ext:app> => $app

# Each stream chunk is transformed; result is a list
$app.stream_numbers() -> fan({ $ * 2 })
# Returns list[...] — not a stream
```

An empty stream returns `[]`.

---

## filter — Parallel Filtering

**Signature:** `filter(list: list[T], body: (item: T) => bool, options?: dict): list[T]`

`filter` keeps elements where the predicate returns `true`. Predicates must return boolean values. Executes concurrently. Does not catch `break`.

> **Backward compatibility:** Existing `$list -> filter({...})` forms continue to work via auto-prepend. No migration needed.

**Invocation forms:** Both produce identical results. The pipe form auto-prepends the piped value as the first argument.

```rill
# Auto-prepend form (pipe supplies the list)
[1, 2, 3, 4, 5] -> filter({ $ > 2 })
# Result: [3, 4, 5]

# Explicit form (list slot filled explicitly)
filter([1, 2, 3, 4, 5], { $ > 2 })
# Result: [3, 4, 5]
```

```rill
# Keep numbers greater than 2
[1, 2, 3, 4, 5] -> filter({ $ > 2 })
# Result: [3, 4, 5]

# Keep non-empty strings
["hello", "", "world", ""] -> filter({ !.empty })
# Result: ["hello", "world"]

# Keep even numbers
[1, 2, 3, 4, 5, 6] -> filter({ ($ % 2) == 0 })
# Result: [2, 4, 6]
```

### Variable Closure

Pass a pre-defined closure by reference.

```rill
|x| ($x > 2) => $gtTwo
[1, 2, 3, 4, 5] -> filter($gtTwo)
# Result: [3, 4, 5]
```

### Dict Filtering

When filtering a dict, `$` contains `key` and `value` fields. Returns list of matching entries.

```rill
[a: 1, b: 5, c: 3] -> filter({ $.value > 2 })
# Result: [[key: "b", value: 5], [key: "c", value: 3]]
```

### String Filtering

Filters characters in a string.

```rill
"hello" -> filter({ $ != "l" })
# Result: ["h", "e", "o"]
```

### Chaining with Other Operators

```rill
# Filter then transform
[1, 2, 3, 4, 5] -> filter({ $ > 2 }) -> fan({ $ * 2 })
# Result: [6, 8, 10]

# Transform then filter
[1, 2, 3, 4, 5] -> fan({ $ * 2 }) -> filter({ $ > 5 })
# Result: [6, 8, 10]

# Filter, transform, reduce
[1, 2, 3, 4, 5] -> filter({ $ > 2 }) -> fan({ $ * 2 }) -> fold(0, { $@ + $ })
# Result: 24
```

### Empty Collections

`filter` returns `[]` for empty collections or when nothing matches.

```rill
[] -> filter({ $ > 0 })
# Result: []

[1, 2, 3] -> filter({ $ > 10 })
# Result: []
```

### Streams with filter

```text
use<ext:app> => $app

# Each stream chunk is tested; result is a list
$app.stream_numbers() -> filter({ $ > 0 })
# Returns list[...] of matching chunks — not a stream
```

An empty stream returns `[]`.

---

## fold — Sequential Reduction

**Signature:** `fold(list: list[T], init: U, body: (acc: U, item: T) => U): U`

`fold` reduces a collection to a single value. Requires a seed and a body callable. Does not catch `break`.

> **Backward compatibility:** Existing `$list -> fold(init, {...})` forms continue to work via auto-prepend. No migration needed.

**Invocation forms:** Both produce identical results. The pipe form auto-prepends the piped value as the first argument.

```rill
# Auto-prepend form (pipe supplies the list)
[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6

# Explicit form (list slot filled explicitly)
fold([1, 2, 3], 0, { $@ + $ })
# Result: 6
```

```rill
# Sum numbers
[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6

# Same with inline closure
[1, 2, 3] -> fold(0, |item|($@ + $item))
# Result: 6
```

### Common Patterns

#### Sum

```rill
[1, 2, 3, 4, 5] -> fold(0, { $@ + $ })
# Result: 15
```

#### Product

```rill
[1, 2, 3, 4] -> fold(1, { $@ * $ })
# Result: 24
```

#### Maximum

```rill
[3, 1, 4, 1, 5, 9] -> fold(0, {
  ($@ > $) ? $@ ! $
})
# Result: 9
```

#### Count

```rill
[1, 2, 3, 4, 5] -> fold(0, { $@ + 1 })
# Result: 5
```

#### String Join

```rill
["a", "b", "c"] -> fold("", { "{$@}{$}" })
# Result: "abc"
```

### Typed Accumulator Closure

Use a two-type anonymous closure to declare element and accumulator types.

```rill
[1, 2, 3] -> fold(0, |number, number|{ $@ + $ })
# Result: 6
```

### Dict Reduction

When folding over a dict, `$` contains `key` and `value` fields.

```rill
[a: 1, b: 2, c: 3] -> fold(0, { $@ + $.value })
# Result: 6
```

### Reusable Reducers

Define closures for common reductions.

```rill
|x| ($@ + $x) => $summer
|x| (($x > $@) ? $x ! $@) => $maxer

[1, 2, 3] -> fold(0, $summer) => $r1
[3, 7, 2] -> fold(0, $maxer) => $r2
[9, 1, 5] -> fold(0, $maxer) => $r3
$r1
# Result: 6
```

### Empty Collections

`fold` returns the initial value for empty collections. The body never executes.

```rill
[] -> fold(0, { $@ + $ })
# Result: 0

[] -> fold(42, { $@ + $ })
# Result: 42
```

### Streams with fold

```text
use<ext:app> => $app

# Reduce all stream chunks to a single value
$app.stream_numbers() -> fold(0, { $@ + $ })
# Returns the sum of all chunks
```

An empty stream returns the initial value without executing the body.

---

## acc — Sequential Scan

**Signature:** `acc(list: list[T], init: U, body: (acc: U, item: T) => U): list[U]`

`acc` iterates sequentially with a running accumulator. Unlike `fold`, it returns a list of all intermediate accumulator values, not just the final one. Catches `break`.

> **Backward compatibility:** Existing `$list -> acc(init, {...})` forms continue to work via auto-prepend. No migration needed.

**Invocation forms:** Both produce identical results. The pipe form auto-prepends the piped value as the first argument.

```rill
# Auto-prepend form (pipe supplies the list)
[1, 2, 3] -> acc(0, { $@ + $ })
# Result: [1, 3, 6]

# Explicit form (list slot filled explicitly)
acc([1, 2, 3], 0, { $@ + $ })
# Result: [1, 3, 6]
```

```rill
# Running sum (scan pattern)
[1, 2, 3] -> acc(0, { $@ + $ })
# Result: [1, 3, 6]

# String concatenation scan
["a", "b", "c"] -> acc("", { "{$@}{$}" })
# Result: ["a", "ab", "abc"]
```

### Typed Accumulator Closure

Use a two-type anonymous closure to declare element and accumulator types.

```rill
[1, 2, 3] -> acc(0, |number, number|{ $@ + $ })
# Result: [1, 3, 6]
```

### Early Termination

`acc` catches `break`. Returns partial intermediate results collected before the break.

```rill
[1, 2, 3, 4, 5] -> acc(0, {
  ($ == 3) ? break
  $@ + $
})
# Result: [1, 3]
```

### Empty Collections

`acc` returns `[]` for empty collections. The body never executes.

```rill
[] -> acc(0, { $@ + $ })
# Result: []
```

### Streams with acc

```text
use<ext:app> => $app

# Accumulator persists across stream chunks
$app.stream_numbers() -> acc(0, { $@ + $ })
# Returns running totals across all chunks
```

An empty stream returns `[]`.

---

## sort — Stable Ordering

**List signature:** `sort(list: list[T], key_fn?: (item: T) => Comparable) -> list[T]`

**Dict signature:** `sort(dict: dict[K, V], key_fn?: (entry: [key: K, value: V]) => Comparable) -> ordered[[key: K, value: V]]`

`sort` orders a list or dict using a stable sort (`Array.prototype.sort`, ES2019+). Equal elements preserve their original relative order. Iterators are eagerly materialized before sorting.

### List Form

```rill
# Default: sort ascending by element value
[3, 1, 2] -> sort
# Result: [1, 2, 3]

# With key extractor: sort strings by length
["banana", "fig", "apple"] -> sort({ $ -> .len })
# Result: ["fig", "apple", "banana"]
```

### Dict Form

Dict sort returns an `ordered` collection. The default key is the entry key string.

```rill
# Default: sort by key (alphabetical)
[c: 3, a: 1, b: 2] -> sort
# Result: ordered[a: 1, b: 2, c: 3]

# Explicit key_fn: sort entries by their numeric value
[c: 3, a: 1, b: 2] -> sort({ $.value })
# Result: ordered[a: 1, b: 2, c: 3]
```

### Multi-Key Sorting

Use a `tuple[...]` projection to sort by multiple keys. Tuple comparison is lexicographic left to right.

```rill
# Sort by score ascending, then name ascending as tiebreaker
list[dict[name: "alice", score: 90], dict[name: "bob", score: 85], dict[name: "carol", score: 90]] -> sort({ tuple[$.score, $.name] })
# Result: list[dict[name: "bob", score: 85], dict[name: "alice", score: 90], dict[name: "carol", score: 90]]
```

### Stability

Equal keys preserve original relative order.

```rill
# alice and carol share score 90; original order alice then carol is preserved
list[dict[name: "alice", score: 90], dict[name: "carol", score: 90], dict[name: "bob", score: 85]] -> sort({ $.score })
# Result: list[dict[name: "bob", score: 85], dict[name: "alice", score: 90], dict[name: "carol", score: 90]]
```

### Descending Order

Pipe through `.reverse` after sorting to get descending order. `.reverse` is a zero-parameter, pure list method. Dict sort returns `ordered`, which does not support `.reverse`.

```rill
[3, 1, 2] -> sort -> .reverse
# Result: [3, 2, 1]
```

### Iterator Materialization

`range(...)` iterators are structurally dicts in rill. A direct `range -> sort` takes the dict path. Use `seq({ $ })` to materialize as a list first.

```rill
range(0, 5) -> seq({ $ }) -> sort
# Result: [0, 1, 2, 3, 4]
```

### Empty Input

Empty list returns `[]`. Empty dict returns an empty `ordered`.

```rill
[] -> sort
# Result: []
```

### Error Cases

| Error | Cause | Reference |
|-------|-------|-----------|
| `#TYPE_MISMATCH` | Key extractor returns mixed types (e.g., number and string) | See [Error Handling](topic-error-handling.md) |
| `#INVALID_INPUT` | Key extractor returns a vacant value | See [Error Handling](topic-error-handling.md) |
| `#TYPE_MISMATCH` | `key_fn` argument is not callable | See [Error Handling](topic-error-handling.md) |

---

## Comparison: acc vs fold

Both `acc` and `fold` support accumulators. The difference is what they return.

| Feature | acc | fold |
|---------|-----|------|
| Returns | List of ALL intermediate results | Final result ONLY |
| Catches break | Yes | No |
| Use case | Scan / prefix-sum | Reduce / aggregate |

### Side-by-Side Example

```rill
# acc: returns every intermediate result
[1, 2, 3] -> acc(0, { $@ + $ })
# Result: [1, 3, 6]
```

```rill
# fold: returns only the final result
[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6
```

### When to Choose

Use `acc` when you need intermediate states (scan pattern):

```rill
# Running balance
[100, -50, 200, -75] -> acc(0, { $@ + $ })
# Result: [100, 50, 250, 175]
```

Use `fold` when you only need the final result:

```rill
# Final balance
[100, -50, 200, -75] -> fold(0, { $@ + $ })
# Result: 175
```

---

## Stream Iteration

Streams produce chunks over time. Collection operators consume all chunks before returning. All stream examples use `text` fences because stream host functions are unavailable in the test harness.

### break in Stream Operators

`break` stops iteration immediately. The host cleanup function (`dispose`) runs to release stream resources.

```text
use<ext:app> => $app

# Stop after the first matching chunk; host disposes the stream
$app.log_stream() -> seq({
  ($ -> .contains("ERROR")) ? break
  $
})
```

### Stream Chunk Limits

The `^(limit: N)` annotation is not valid inside collection operator calls. The parser rejects it with RILL-R081.

```text
use<ext:app> => $app

# Rejected — RILL-R081: ^(limit: N) is not accepted inside seq()
$app.events() -> seq(^(limit: 100) { $ })
```

To stop early, use `break` inside the operator body. Inner scopes cannot reassign outer variables, so use the incoming value `$` or an `acc`/`fold` accumulator for stateful conditions:

```text
use<ext:app> => $app

$app.events() -> seq({
  ($ > 100) ? break
  $
})
```

### Iteration Ceiling

Exactly 10,000 chunks complete without error. The 10,001st chunk triggers RILL-R010 and halts execution. Use `break` inside the body to consume at most N chunks and stay within bounds.

```text
use<ext:app> => $app

# Error: exceeds iteration ceiling
$app.infinite_stream() -> seq({ $ })
# RILL-R010: halts on the 10,001st chunk
```

### Re-iteration Halt

A consumed stream cannot be re-iterated. Passing a consumed stream to a second operator halts execution with an error.

```text
use<ext:app> => $app

# Error: stream already consumed
$app.stream_numbers() => $s
$s -> seq({ $ })
$s -> seq({ $ })   # Halts: stream is consumed
```

---

## Chaining Operators

Combine operators for multi-stage transformations.

```rill
# Double each element, then sum
[1, 2, 3] -> fan({ $ * 2 }) -> fold(0, { $@ + $ })
# Result: 12

# Filter even numbers (using parallel filter)
[1, 2, 3, 4, 5] -> filter({ ($ % 2) == 0 })
# Result: [2, 4]

# Complex pipeline: filter, then transform
[1, 2, 3, 4, 5] -> filter({ $ > 2 }) -> fan({ $ * 10 })
# Result: [30, 40, 50]
```

---

## Error Cases

| Case | Example | Error |
|------|---------|-------|
| Non-callable body | `[1,2] -> seq(42)` | RILL-R040 |
| Non-iterable input | `42 -> seq({ $ })` | RILL-R002 |
| Vector input | `$vec -> seq({ $ })` | RILL-R003 |
| Iteration exceeds 10,000 | `range(0, 10001) -> seq({ $ })` | RILL-R010 |
| Options not a dict | `[1] -> filter({ $ > 0 }, 42)` | RILL-R001 |
| Concurrency not positive integer | `[1] -> fan({ $ }, [concurrency: -1])` | RILL-R001 |
| Typed closure type violation | `[1,2,3] -> fold(0, \|string, number\|{ $@ + $ })` | RILL-R001 |

---

## Iterating Different Types

### Lists

```rill
[1, 2, 3] -> seq({ $ * 2 })
# Result: [2, 4, 6]
```

### Strings

Iterates over characters.

```rill
"abc" -> seq({ "{$}!" })
# Result: ["a!", "b!", "c!"]
```

### Dicts

Iterates over entries with `key` and `value` fields.

```rill
[a: 1, b: 2] -> seq({ "{$.key}={$.value}" })
# Result: ["a=1", "b=2"]
```

---

## Nested Collections

Process nested structures with nested operators.

```rill
# Double nested values
[list[1, 2], list[3, 4]] -> fan({ $ -> seq({ $ * 2 }) })
# Result: [[2, 4], [6, 8]]
```

```rill
# Sum all nested values
[list[1, 2], list[3, 4]] -> fold(0, { $@ + ($ -> fold(0, { $@ + $ })) })
# Result: 10
```

---

## Performance Considerations

### Sequential vs Parallel

| Scenario | Recommendation |
|----------|----------------|
| CPU-bound computation | `seq` or `fan` (similar performance) |
| I/O-bound operations | `fan` (concurrent benefits) |
| Order-dependent logic | `seq` (guaranteed order) |
| Stateful accumulation | `acc` or `fold` (no parallel option) |

### Memory

- `seq`, `fan`, `acc` allocate result lists proportional to input size
- `fold` maintains constant memory (accumulator only)

---

## Quick Reference

```text
# seq - sequential, all results
[1, 2, 3] -> seq({ $ * 2 })            # [2, 4, 6]

# fan - parallel, all results
[1, 2, 3] -> fan({ $ * 2 })            # [2, 4, 6]
[1, 2, 3] -> fan({ $ * 2 }, [concurrency: 2])   # concurrency cap

# filter - parallel, matching elements
[1, 2, 3, 4, 5] -> filter({ $ > 2 })   # [3, 4, 5]

# fold - sequential, final result only
[1, 2, 3] -> fold(0, { $@ + $ })       # 6

# acc - sequential, all intermediate results
[1, 2, 3] -> acc(0, { $@ + $ })        # [1, 3, 6]

# Dict iteration
[a: 1, b: 2] -> seq({ $.key })         # ["a", "b"]
[a: 1, b: 2] -> seq({ $.value })       # [1, 2]

# Break (seq and acc only)
[1, 2, 3] -> seq({ ($ > 2) ? break ! $ })  # [1, 2]

# Empty collections
[] -> seq({ $ })       # []
[] -> fan({ $ })       # []
[] -> filter({ $ })    # []
[] -> fold(42, { $ })  # 42
[] -> acc(0, { $ })    # []
```

---

## See Also

- [Collection Slicing and Restructuring Operators](topic-collection-slicing.md) — `take`, `skip`, `cycle`, `batch`, `window`, `start_when`, `stop_when`, `debounce`, `throttle`, `sample`, `pass<>` body form
- [Iterators](topic-iterators.md) — Lazy sequences with `range`, `repeat`, `iterate` (infinite source stream), `.first()`
- [Reference](ref-language.md) — Complete language specification
- [Closures](topic-closures.md) — Closure semantics and patterns
- [Guide](guide-getting-started.md) — Beginner introduction
- [Examples](guide-examples.md) — Workflow examples
