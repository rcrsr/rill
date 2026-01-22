# rill Iterators

*Lazy sequence generation with the iterator protocol*

## Overview

Iterators provide lazy sequence generation in rill. They produce values on demand rather than materializing entire collections upfront.

**Built-in iterators:**

| Function | Description |
|----------|-------------|
| `range(start, end, step?)` | Generate number sequence |
| `repeat(value, count)` | Repeat value n times |
| `.first()` | Get iterator for any collection |

**Key characteristics:**

- Value-based: `.next()` returns a new iterator, original unchanged
- Lazy: Elements generated on demand
- Composable: Work with all collection operators (`each`, `map`, `filter`, `fold`)

```rill
range(0, 5) -> each { $ * 2 }           # [0, 2, 4, 6, 8]
repeat("x", 3) -> each { $ }            # ["x", "x", "x"]
[1, 2, 3] -> .first() -> each { $ }     # [1, 2, 3]
```

---

## Iterator Protocol

Iterators are dicts with three fields:

| Field | Type | Description |
|-------|------|-------------|
| `value` | any | Current element (absent when done) |
| `done` | bool | True if exhausted |
| `next` | closure | Returns new iterator at next position |

```rill
# Iterator structure
[
  value: 0,
  done: false,
  next: || { ... }   # returns new iterator
]
```

Collection operators automatically recognize and expand iterators:

```rill
range(1, 4) -> map { $ * 10 }     # [10, 20, 30]
range(0, 10) -> filter { $ > 5 }  # [6, 7, 8, 9]
range(1, 6) -> fold(0) { $@ + $ } # 15
```

---

## Built-in Iterators

### `range(start, end, step?)`

Generate a sequence of numbers from `start` (inclusive) to `end` (exclusive).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | number | required | First value |
| `end` | number | required | Stop value (exclusive) |
| `step` | number | 1 | Increment (can be negative) |

```rill
range(0, 5)           # 0, 1, 2, 3, 4
range(1, 6)           # 1, 2, 3, 4, 5
range(0, 10, 2)       # 0, 2, 4, 6, 8
range(5, 0, -1)       # 5, 4, 3, 2, 1
range(-3, 2)          # -3, -2, -1, 0, 1
range(0, 1, 0.25)     # 0, 0.25, 0.5, 0.75
```

**Edge cases:**

```rill
range(5, 5)           # empty (start == end)
range(5, 3)           # empty (start > end with positive step)
range(0, 5, -1)       # empty (wrong direction)
range(0, 5, 0)        # ERROR: step cannot be zero
```

### `repeat(value, count)`

Generate a value repeated n times.

| Parameter | Type | Description |
|-----------|------|-------------|
| `value` | any | Value to repeat |
| `count` | number | Number of repetitions |

```rill
repeat("x", 3)        # "x", "x", "x"
repeat(0, 5)          # 0, 0, 0, 0, 0
repeat([a: 1], 2)     # [a: 1], [a: 1]
```

**Edge cases:**

```rill
repeat("x", 0)        # empty
repeat("x", -1)       # ERROR: count cannot be negative
```

---

## The `.first()` Method

Returns an iterator for any collection. Provides a consistent interface for manual iteration.

| Input Type | `.first()` Returns |
|------------|-------------------|
| list | Iterator over elements |
| string | Iterator over characters |
| dict | Iterator over `[key: k, value: v]` entries |
| iterator | Returns itself (identity) |

```rill
[1, 2, 3] -> .first()        # iterator at 1
"abc" -> .first()            # iterator at "a"
[a: 1, b: 2] -> .first()     # iterator at [key: "a", value: 1]
range(0, 5) -> .first()      # iterator at 0 (identity)
```

**Empty collections** return a done iterator:

```rill
[] -> .first()               # [done: true, next: ...]
"" -> .first()               # [done: true, next: ...]
```

**Using `.first()` with collection operators:**

```rill
[1, 2, 3] -> .first() -> each { $ * 2 }    # [2, 4, 6]
"hello" -> .first() -> each { $ }          # ["h", "e", "l", "l", "o"]
```

---

## Manual Iteration

Traverse an iterator by accessing `.value`, `.done`, and calling `.next()`:

```rill
[1, 2, 3] -> .first() :> $it

# Check if done
$it.done                     # false

# Get current value
$it.value                    # 1

# Advance to next position
$it.next() :> $it
$it.value                    # 2
```

**Loop pattern (using $ as accumulator):**

```text
"hello" -> .first() -> !$.done @ {
  $.value -> log
  $.next()
}
# logs: h, e, l, l, o
```

**Preferred: use `each` for iteration:**

```rill
"hello" -> each { log($) }
# logs: h, e, l, l, o
```

**Check before access:**

```rill
$list -> .first() :> $it
$it.done ? "empty" ! $it.value
```

---

## Custom Iterators

Create custom iterators by implementing the protocol:

```rill
# Counter from start to max
|start, max| [
  value: $start,
  done: ($start > $max),
  next: || { $counter($.value + 1, $max) }
] :> $counter

$counter(1, 5) -> each { $ }    # [1, 2, 3, 4, 5]
```

**Fibonacci sequence:**

```text
|a, b, max| [
  value: $a,
  done: ($a > $max),
  next: || { $fib($.b, $.a + $.b, $max) }
] :> $fib

$fib(0, 1, 50) -> each { $ }    # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

**Infinite iterator (use with limit):**

```text
|n| [
  value: $n,
  done: false,
  next: || { $naturals($.value + 1) }
] :> $naturals

# Take first 5 using fold with compound accumulator
$naturals(1) -> .first() -> fold([list: [], it: $]) {
  ($@.list -> .len >= 5) ? $@ -> break ! [
    list: [...$@.list, $@.it.value],
    it: $@.it.next()
  ]
} -> $.list    # [1, 2, 3, 4, 5]
```

---

## Element Access: `.head` and `.tail`

For direct element access (not iteration), use `.head` and `.tail`:

| Method | Description |
|--------|-------------|
| `.head` | First element (errors on empty) |
| `.tail` | Last element (errors on empty) |

```rill
[1, 2, 3] -> .head    # 1
[1, 2, 3] -> .tail    # 3
"hello" -> .head      # "h"
"hello" -> .tail      # "o"
```

**Empty collections error** (no null in rill):

```rill
[] -> .head           # ERROR: Cannot get head of empty list
"" -> .tail           # ERROR: Cannot get tail of empty string
```

**Comparison with `.first()`:**

| Method | Returns | On Empty |
|--------|---------|----------|
| `.head` | Element directly | Error |
| `.first()` | Iterator | Done iterator |

---

## Examples

### Sum of squares

```rill
range(1, 11) -> map { $ * $ } -> fold(0) { $@ + $ }
# 385 (1 + 4 + 9 + ... + 100)
```

### Generate index markers

```rill
range(0, 5) -> each { "Item {$}" }
# ["Item 0", "Item 1", "Item 2", "Item 3", "Item 4"]
```

### Retry pattern

```rill
repeat(1, 3) -> each {
  attempt() :> $result
  ($result.success == true) ? ($result -> break)
  pause("00:00:01")
  $result
}
```

### Filter even numbers

```rill
range(0, 20) -> filter { ($ % 2) == 0 }
# [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
```

### Nested iteration

```rill
range(1, 4) -> each { $ :> $row -> range(1, 4) -> each { $row * $ } }
# [[1, 2, 3], [2, 4, 6], [3, 6, 9]]
```

---

## Limits

Iterators are expanded eagerly when passed to collection operators. A default limit of 10000 elements prevents infinite loops:

```rill
# This would error after 10000 elements
|n| [value: $n, done: false, next: || { $inf($.value + 1) }] :> $inf
$inf(0) -> each { $ }    # ERROR: Iterator exceeded 10000 elements
```

---

## See Also

- [Collections](07_collections.md) — `each`, `map`, `filter`, `fold` operators
- [Closures](06_closures.md) — Closure semantics for custom iterators
- [Reference](11_reference.md) — Complete language specification
