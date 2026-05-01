# Collection Slicing and Restructuring Operators

*Operators that slice, batch, window, and gate streams and iterators*

## Overview

rill provides operators for slicing, restructuring, gating, and time-domain filtering of sequences. These complement the six core iteration operators in [Collection Operators](topic-collections.md).

| Operator | Returns | Primary Use |
|----------|---------|-------------|
| `take(n)` | `list[T]` | First n elements |
| `skip(n)` | `list[T]` | All elements after the first n |
| `cycle` | `iterator[T]` | Repeating iterator over input |
| `batch(n)` | stream of `list[T]` | Non-overlapping chunks of size n |
| `window(n, step?)` | stream of `list[T]` | Sliding windows of size n |
| `start_when(pred)` | stream of `T` | Elements from first match onward |
| `stop_when(pred)` | stream of `T` | Elements up to and including first match |
| `debounce(duration)` | stream of `T` | Suppress rapid emissions; emit latest after silence |
| `throttle(duration)` | stream of `T` | Limit to at most 1 chunk per duration interval |
| `sample(duration)` | stream of `T` | Emit latest chunk at fixed duration intervals |
| `pass` | pipe value unchanged | Reference current piped value `$` |
| `pass { body }` | pipe value unchanged | Side-effect block, no suppression |
| `pass<on_error: #IGNORE> { body }` | pipe value unchanged | Side-effect block with suppressed errors |
| `pass<async: true> { body }` | pipe value unchanged | Fire-and-forget side-effect block; body return value discarded |

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

### Idle Flush (`idle_flush: duration`)

Pass `idle_flush` in the options dict to flush the accumulated buffer early when no new chunk arrives within the given duration.

```text
# Conceptual example: flush early if no chunk arrives within 500 ms
$stream -> batch(10, dict[idle_flush: duration(...dict[ms: 500])])
```

When the idle timer expires and the buffer is non-empty, the partial batch flushes immediately without waiting for `n` elements. When the buffer is empty at idle expiry, no flush is emitted. The timer resets after each chunk or flush.

**Current limitation:** Under the synchronous batch path, `idle_flush` is type-validated (EC-18) but produces no early-flush emissions. All elements are collected before any timer can fire. Async-streaming wire-up is deferred.

```text
# Error: #TYPE_MISMATCH - idle_flush must be a duration value
# [1, 2, 3] -> batch(2, dict[idle_flush: "500ms"])
```

### Edge Cases and Errors

| Condition | Behavior |
|-----------|----------|
| `n` equals 1 | Each element becomes a single-element list |
| Input length is an exact multiple of `n` | No partial chunk; `drop_partial` has no effect |
| Empty input | Returns `[]` (no chunks produced) |
| `n` is 0 or negative | Halts with `#INVALID_INPUT` |
| `idle_flush` is not a duration | Catchable halt: `TYPE_MISMATCH` (EC-18) |
| Applied to a list | Catchable halt: `#INVALID_INPUT` (EC-19) |

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

## debounce

**Signature:** `debounce(duration: duration): stream of T`

`debounce` suppresses rapid emissions and emits only the latest chunk after a period of silence equal to `duration`. When a new chunk arrives before the silence window expires, the previous candidate is discarded and the timer resets.

`debounce` is stream-only. Passing a list halts with `#INVALID_INPUT`.

```text
# Conceptual: only the last chunk in a rapid burst passes
$event_stream -> debounce(duration(...dict[ms: 200]))
# Only the final chunk emits after 200 ms of silence
```

**Sampling strategy:** debounce = latest chunk. The runtime suppresses all but the final emission from each burst.

### Static-clock behavior

The current implementation uses synchronous batch materialization via `getIterableElements`. Because `ctx.nowMs` does not advance between chunks, all chunks share the same virtual timestamp and fall within the same silence window. The result is the last chunk of the input.

```text
# Under sync-batch semantics: debounce returns the last element
# Async wire-up (true silence detection) is deferred
```

### Error Contracts

| Condition | Error |
|-----------|-------|
| Input is a list | Catchable halt: `#INVALID_INPUT` |
| `duration` argument is not a duration | Catchable halt: `RILL-R001` type mismatch |
| Iteration exceeds 10,000 chunks | Non-catchable halt: `RILL_R010` |

```text
# Error: #INVALID_INPUT — list input rejected
[1, 2, 3] -> debounce(duration(...dict[ms: 100]))
```

```text
# Error: #RILL_R001 - duration must be a duration value
$stream -> debounce(500)
```

---

## throttle

**Signature:** `throttle(duration: duration): stream of T`

`throttle` limits output to at most one chunk per `duration` interval. The first chunk in each interval passes through. Subsequent chunks that arrive within the same interval are discarded.

`throttle` is stream-only. Passing a list halts with `#INVALID_INPUT`.

```text
# Conceptual: at most one chunk per 100 ms interval
$event_stream -> throttle(duration(...dict[ms: 100]))
```

**Sampling strategy:** throttle = first chunk. The runtime passes the first emission of each interval and drops the rest until the interval expires.

### Static-clock behavior

Under the synchronous batch path, `ctx.nowMs` does not advance between chunks. All chunks fall within the first interval window. The result is the first chunk of the input.

```text
# Under sync-batch semantics: throttle returns the first element
# Async wire-up (true interval tracking) is deferred
```

### Error Contracts

| Condition | Error |
|-----------|-------|
| Input is a list | Catchable halt: `#INVALID_INPUT` |
| `duration` argument is not a duration | Catchable halt: `RILL-R001` type mismatch |
| Iteration exceeds 10,000 chunks | Non-catchable halt: `RILL_R010` |

```text
# Error: #INVALID_INPUT — list input rejected
[1, 2, 3] -> throttle(duration(...dict[ms: 100]))
```

---

## sample

**Signature:** `sample(duration: duration): stream of T`

`sample` emits the latest chunk seen at each fixed `duration` interval. Chunks arriving between checkpoints update the "latest seen" value. Each checkpoint emits that latest value if any chunk arrived since the last checkpoint.

`sample` is stream-only. Passing a list halts with `#INVALID_INPUT`.

```text
# Conceptual: emit latest chunk every 250 ms
$sensor_stream -> sample(duration(...dict[ms: 250]))
```

**Sampling strategy:** sample = latest at interval. Unlike `debounce`, `sample` emits on a fixed clock rather than after a silence window. Unlike `throttle`, `sample` emits the most recent chunk rather than the first.

### Static-clock behavior

Under the synchronous batch path, `ctx.nowMs` does not advance between chunks. All chunks fall in the first interval window and the last chunk is emitted as a single sample.

```text
# Under sync-batch semantics: sample returns the last element
# Async wire-up (true periodic emission) is deferred
```

### Comparing the Three Time Operators

| Operator | Emits | When |
|----------|-------|------|
| `debounce` | Last chunk of a burst | After `duration` of silence |
| `throttle` | First chunk of an interval | At the start of each interval |
| `sample` | Latest chunk seen | At the end of each interval |

### Error Contracts

| Condition | Error |
|-----------|-------|
| Input is a list | Catchable halt: `#INVALID_INPUT` |
| `duration` argument is not a duration | Catchable halt: `RILL-R001` type mismatch |
| Iteration exceeds 10,000 chunks | Non-catchable halt: `RILL_R010` |

```text
# Error: #INVALID_INPUT — list input rejected
[1, 2, 3] -> sample(duration(...dict[ms: 100]))
```

---

## pass body forms

`pass` has four distinct forms:

| Form | Syntax | Behavior |
|------|--------|----------|
| Bare `pass` | `pass` | References current pipe value `$`; halts `#RILL_R005` if unbound |
| Body form | `pass { body }` | Runs body for side effects; returns pipe value unchanged; does NOT suppress halts |
| Body form with suppression | `pass<on_error: #IGNORE> { body }` | Runs body; suppresses catchable halts in body; returns pipe value unchanged |
| Async body form | `pass<async: true> { body }` | Dispatches body as fire-and-forget; returns pipe value immediately; body return value discarded |

All body forms discard the body's result. The value before `pass` continues down the pipe.

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

```text
# Error: #RILL_R002 — body halt propagates
10 -> pass { 1 / 0 }
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

### Async Fire-and-Forget (`pass<async: true>`)

`pass<async: true> { body }` dispatches the body without blocking. The runtime registers the body's promise via `trackInflight` and returns control immediately. The pipe-entry value flows downstream unchanged.

```rill
42 -> pass<async: true> { $ }
# Result: 42
```

The body's return value is always discarded. Downstream operators never see it:

```rill
10 -> pass<async: true> { $ * 100 }
# Result: 10
```

Downstream operators chain on the original pipe value, not the body result:

```rill
5 -> pass<async: true> { $ + 1 } -> { $ * 2 }
# Result: 10
```

#### Body completion order is unobservable

`pass<async: true>` bodies may complete after downstream operators run. Scripts must not depend on body completion order relative to downstream execution.

#### Compose `async` with `on_error`

`async: true` and `on_error: #IGNORE` are independent options that compose:

```rill
"data" -> pass<async: true, on_error: #IGNORE> { 1 / 0 }
# Result: "data"
```

With both options, the runtime dispatches the body asynchronously and suppresses any catchable halt the body produces. Without `on_error: #IGNORE`, a catchable halt in the async body surfaces at disposal time.

#### Shutdown behavior

`dispose()` awaits all in-flight `trackInflight` promises with a 5000 ms ceiling before completing. Bodies still running at the ceiling boundary are abandoned; a warning is logged via the `onLog` callback.

#### `async` accepts only `bool`

```text
# Error: catchable halt — async value must be a bool
pass<async: 1> { log($) }
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
- [Iterators](topic-iterators.md) — Lazy sequences with `range`, `repeat`, `iterate`, `.first()`; iterator vs stream comparison
- [Types](topic-types.md) — `duration` construction and properties
- [Error Handling](topic-error-handling.md) — `.!`, `.?`, `guard`, `retry`, and error recovery patterns (relevant for `pass` body form suppression semantics)
