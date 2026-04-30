# Collection Slicing and Restructuring Operators

*Operators that slice, batch, window, and gate streams and iterators*

## Overview

rill provides eight operators for slicing, restructuring, and gating sequences. These complement the six core iteration operators in [Collection Operators](topic-collections.md).

| Operator | Returns | Primary Use |
|----------|---------|-------------|
| `take(n)` | `list[T]` | First n elements |
| `skip(n)` | `list[T]` | All elements after the first n |
| `cycle` | `iterator[T]` | Repeating iterator over input |
| `batch(n)` | stream of `list[T]` | Non-overlapping chunks of size n |
| `window(n, step?)` | stream of `list[T]` | Sliding windows of size n |
| `start_when(pred)` | stream of `T` | Elements from first match onward |
| `stop_when(pred)` | stream of `T` | Elements up to and including first match |
| `pass` | pipe value unchanged | Reference current piped value `$` |
| `pass { body }` | pipe value unchanged | Side-effect block, no suppression |
| `pass<on_error: #IGNORE> { body }` | pipe value unchanged | Side-effect block with suppressed errors |

All operators chain with `->`. Error contracts apply identically to list and stream inputs.

---

## take

**Signature:** `take(n: int): list[T]`

`take` returns the first `n` elements of a list, iterator, or stream as a list. Input after position `n` is discarded. `take` is eager: it materializes the result immediately.

```rill
range(1, 11) -> take(5)
# Result: [1, 2, 3, 4, 5]
```

```rill
# take from a list
[10, 20, 30, 40, 50] -> take(3)
# Result: [10, 20, 30]
```

```rill
# take more than available — returns all elements
[1, 2, 3] -> take(10)
# Result: [1, 2, 3]
```

### With cycle

`take` is the standard consumer for `cycle`, bounding what would otherwise be an infinite iterator.

```rill
[1, 2, 3] -> cycle -> take(6)
# Result: [1, 2, 3, 1, 2, 3]
```

### Edge Cases and Errors

| Condition | Behavior |
|-----------|----------|
| `n` equals 0 | Returns `[]` |
| `n` exceeds input length | Returns all elements |
| `n` exceeds 10,000 (MAX_ITER) | Clamps to 10,000; no error |
| `n` is negative | Halts with `#INVALID_INPUT` |

```text
# Error: #INVALID_INPUT — negative n
range(1, 11) -> take(-1)
```

---

## skip

**Signature:** `skip(n: int): list[T]`

`skip` discards the first `n` elements and returns the remainder as a list. When `n` exceeds the input length, the result is an empty list.

```rill
range(1, 11) -> skip(3)
# Result: [4, 5, 6, 7, 8, 9, 10]
```

```rill
# skip from a list
[10, 20, 30, 40, 50] -> skip(2)
# Result: [30, 40, 50]
```

```rill
# skip more than available — returns empty
[1, 2, 3] -> skip(10)
# Result: []
```

### Combining take and skip

Use `skip` then `take` to extract a slice by position.

```rill
# Elements at positions 3-5 (0-indexed)
range(1, 11) -> skip(3) -> take(3)
# Result: [4, 5, 6]
```

### Edge Cases and Errors

| Condition | Behavior |
|-----------|----------|
| `n` equals 0 | Returns all elements unchanged |
| `n` exceeds input length | Returns `[]` |
| `n` is negative | Halts with `#INVALID_INPUT` |

```text
# Error: #INVALID_INPUT — negative n
range(1, 11) -> skip(-1)
```

---

## cycle

**Signature:** `cycle: iterator[T]`

`cycle` produces a lazy iterator that repeats the input indefinitely. It takes no arguments and is used with `.` method syntax in a pipe chain. The iterator itself does not execute: a consumer such as `take` or `seq` drives it.

```rill
[1, 2, 3] -> cycle -> take(6)
# Result: [1, 2, 3, 1, 2, 3]
```

```rill
# Repeat a single element
["x"] -> cycle -> take(4)
# Result: ["x", "x", "x", "x"]
```

```rill
# Use in a pipeline
[1, 2] -> cycle -> take(5) -> seq({ $ * 10 })
# Result: [10, 20, 10, 20, 10]
```

### Iteration Ceiling

`cycle` produces elements until the consumer finishes or until the iteration ceiling (MAX_ITER = 10,000) is reached. Consuming past 10,000 elements without a bound halts execution with `#RILL_R010`.

```text
# Error: #RILL_R010 — iteration ceiling exceeded
[1, 2, 3] -> cycle -> seq({ $ })
# Halts on the 10,001st element
```

Always pair `cycle` with `take(n)` or a body containing `break` to stay within bounds.

### Empty Input

`cycle` over an empty collection returns an empty iterator. No elements are ever produced.

```rill
[] -> cycle -> take(5)
# Result: []
```

---

## batch

**Signature:** `batch(n: int, options?: dict[drop_partial: bool]): stream of list[T]`

`batch` groups input elements into non-overlapping chunks of size `n`. Each chunk is a `list[T]`. The final chunk may be smaller than `n` if the input length is not a multiple of `n`.

```rill
range(1, 11) -> batch(3)
# Result: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]
```

```rill
range(1, 7) -> batch(2)
# Result: [[1, 2], [3, 4], [5, 6]]
```

### Dropping the Partial Chunk

Pass `dict[drop_partial: true]` to discard any trailing chunk shorter than `n`.

```rill
range(1, 11) -> batch(3, dict[drop_partial: true])
# Result: [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
```

### Combining with Collection Operators

Each chunk is a list. Chain `seq` or `fold` to process chunks.

```rill
range(1, 10) -> batch(3) -> seq({ $ -> fold(0, { $@ + $ }) })
# Result: [6, 15, 24]
```

### Edge Cases and Errors

| Condition | Behavior |
|-----------|----------|
| `n` equals 1 | Each element becomes a single-element list |
| Input length is an exact multiple of `n` | No partial chunk; `drop_partial` has no effect |
| Empty input | Returns `[]` (no chunks produced) |
| `n` is 0 or negative | Halts with `#INVALID_INPUT` |

```rill
[] -> batch(3)
# Result: []
```

```text
# Error: #INVALID_INPUT — n must be positive
[1, 2, 3] -> batch(0)
```

---

## window

**Signature:** `window(n: int, step?: int): stream of list[T]`

`window` produces overlapping or non-overlapping windows of size `n` over the input. The optional `step` argument controls how far the window advances between outputs. When `step` is omitted, it defaults to `n`, producing non-overlapping windows identical to `batch`.

```rill
range(1, 7) -> window(3)
# Result: [[1, 2, 3], [4, 5, 6]]
```

```rill
# Overlapping windows: step smaller than n
range(1, 7) -> window(3, 2)
# Result: [[1, 2, 3], [3, 4, 5], [5, 6]]
```

### Step Behaviors

| `step` vs `n` | Effect |
|---------------|--------|
| `step == n` (default) | Non-overlapping, equivalent to `batch(n)` |
| `step < n` | Overlapping windows; adjacent windows share elements |
| `step > n` | Gaps between windows; elements are skipped |

```rill
# step > n: gaps between windows
range(1, 11) -> window(2, 4)
# Result: [[1, 2], [5, 6], [9, 10]]
```

### Partial Windows at the End

When the remaining elements are fewer than `n`, they form a partial window. Use `batch(n, dict[drop_partial: true])` instead of `window` if you need to discard incomplete trailing windows.

### Edge Cases and Errors

| Condition | Behavior |
|-----------|----------|
| Empty input | Returns `[]` |
| Input shorter than `n` | Returns one partial window containing all elements |
| `n` is 0 or negative | Halts with `#INVALID_INPUT` |
| `step` is 0 | Halts with `#INVALID_INPUT` |
| `step` is negative | Halts with `#INVALID_INPUT` |

```rill
[1, 2] -> window(5)
# Result: [[1, 2]]
```

```text
# Error: #INVALID_INPUT — n must be positive
[1, 2, 3] -> window(0)
```

---

## start_when

**Signature:** `start_when(predicate: closure): stream of T`

`start_when` discards elements before the first item where `predicate` returns `true`. Once the predicate matches, that item and all subsequent items pass through unchanged.

```rill
range(1, 8) -> start_when({ $ > 4 })
# Result: [5, 6, 7]
```

```rill
["a", "b", "START", "c", "d"] -> start_when({ $ == "START" })
# Result: ["START", "c", "d"]
```

### Using a Named Closure

```rill
|x| ($x > 3) => $threshold
range(1, 8) -> start_when($threshold)
# Result: [4, 5, 6, 7]
```

### When the Predicate Never Matches

If no element satisfies the predicate, `start_when` returns an empty result.

```rill
[1, 2, 3] -> start_when({ $ > 100 })
# Result: []
```

### Combining with stop_when

Chain `start_when` and `stop_when` to extract a slice gated by content conditions.

```rill
range(1, 11) -> start_when({ $ >= 3 }) -> stop_when({ $ >= 7 })
# Result: [3, 4, 5, 6, 7]
```

### Error Contracts

| Condition | Error |
|-----------|-------|
| `predicate` is not callable | `#RILL_R040` |
| `predicate` returns a non-bool value | `#TYPE_MISMATCH` |

```text
# Error: #RILL_R040 — predicate must be callable
[1, 2, 3] -> start_when(42)
```

---

## stop_when

**Signature:** `stop_when(predicate: closure): stream of T`

`stop_when` yields elements up to and including the first item where `predicate` returns `true`. After that match, all remaining elements are discarded.

```rill
range(1, 11) -> stop_when({ $ >= 5 })
# Result: [1, 2, 3, 4, 5]
```

```rill
["a", "b", "STOP", "c", "d"] -> stop_when({ $ == "STOP" })
# Result: ["a", "b", "STOP"]
```

### The Matching Element is Included

`stop_when` is inclusive: the element that triggers the predicate appears in the output. Use `take` with a known index if you need exclusive stopping behavior.

### When the Predicate Never Matches

If no element satisfies the predicate, `stop_when` returns all elements.

```rill
[1, 2, 3] -> stop_when({ $ > 100 })
# Result: [1, 2, 3]
```

### Using a Named Closure

```rill
|x| ($x == 5) => $atFive
range(1, 11) -> stop_when($atFive)
# Result: [1, 2, 3, 4, 5]
```

### Error Contracts

| Condition | Error |
|-----------|-------|
| `predicate` is not callable | `#RILL_R040` |
| `predicate` returns a non-bool value | `#TYPE_MISMATCH` |

```text
# Error: #TYPE_MISMATCH — predicate must return bool
[1, 2, 3] -> stop_when({ $ + 1 })
```

---

## pass body forms

`pass` has three distinct forms:

| Form | Syntax | Behavior |
|------|--------|----------|
| Bare `pass` | `pass` | References current pipe value `$`; halts `RILL_R005` if unbound |
| Body form | `pass { body }` | Runs body for side effects; returns pipe value unchanged; does NOT suppress halts |
| Body form with suppression | `pass<on_error: #IGNORE> { body }` | Runs body; suppresses catchable halts in body; returns pipe value unchanged |

Both body forms discard the body's result. The value before `pass` continues down the pipe.

```rill
5 -> pass { log($) }
# Result: 5
```

```rill
range(1, 4) -> seq({ $ * 10 }) -> pass { log($) }
# Result: [10, 20, 30]
```

### Error Suppression

Use `pass<on_error: #IGNORE> { body }` when the body may produce catchable errors that should not halt the pipeline.

```rill
10 -> pass<on_error: #IGNORE> { 1 / 0 }
# Result: 10
```

Without `on_error: #IGNORE`, a catchable halt in the body propagates normally:

```rill
5 -> pass { log($) }
# Result: 5
```

### What Is Not Suppressed

`pass<on_error: #IGNORE>` suppresses catchable halts only. Two categories always propagate out of the body:

| Signal | Behavior |
|--------|----------|
| Non-catchable halts (`catchable: false`) | Re-thrown; execution halts |
| `ControlSignal` instances (`break`, `return`) | Re-thrown; propagate to enclosing construct |

### Bare pass vs pass body forms

These are three distinct constructs:

- **Bare `pass`** — an expression that references the current piped value `$`. Appears inside blocks and conditions, not as a standalone pipe stage. Halts `RILL_R005` if `$` is unbound.
- **`pass { body }`** — a pipe stage that runs the body for side effects and returns the pipe value unchanged. Does not suppress halts.
- **`pass<on_error: #IGNORE> { body }`** — same as `pass { body }` but suppresses catchable halts that occur inside the body.

```rill
# Bare pass in expression — references the piped value inside a conditional
[1, -2, 3, -4] -> fan({ ($ > 0) ? pass ! 0 })
# Result: [1, 0, 3, 0]
```

```rill
# pass { body } — side effect only, no suppression
5 -> pass { log($) }
# Result: 5
```

```rill
# pass<on_error: #IGNORE> { body } — side effect with catchable-halt suppression
5 -> pass<on_error: #IGNORE> { log($) }
# Result: 5
```

### Use in Pipelines

`pass` body forms are useful for inserting logging or diagnostics into a pipeline without changing the data flow.

```rill
range(1, 6) -> filter({ ($ % 2) == 0 }) -> pass { log($) } -> seq({ $ * 100 })
# Result: [200, 400]
```

### Error Contracts

The `on_error` option accepts only `#IGNORE`. Empty `pass<>`, unknown option keys, and `on_error` values other than `#IGNORE` are parse errors (`RILL-P004`). Use `pass { body }` for the no-options form.

```text
# Error: RILL-P004 — empty pass<> is a parse error; use pass { body }
pass<> { log($) }
```

```text
# Error: RILL-P004 — unknown option key
pass<on_warn: #IGNORE> { log($) }
```

```text
# Error: RILL-P004 — on_error value must be #IGNORE
pass<on_error: #SKIP> { log($) }
```

---

## See Also

- [Collection Operators](topic-collections.md) — `seq`, `fan`, `filter`, `fold`, `acc`, `sort` with stream iteration
- [Iterators](topic-iterators.md) — Lazy sequences with `range`, `repeat`, `.first()`; iterator vs stream comparison
- [Error Handling](topic-error-handling.md) — `.!`, `.?`, `guard`, `retry`, and error recovery patterns (relevant for `pass` body form suppression semantics)
