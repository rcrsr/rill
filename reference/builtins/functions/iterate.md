---
id: iterate
title: iterate
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [iteration, pipe, break, slicing-limit]
tests: [iterate.test.ts, builtin-functions-slicing.test.ts]
---

# iterate

`iterate` yields an unbounded iterator that starts at a seed and steps by calling a function on
the previous element.

## Syntax

```text
iterate(seed, body) -> iterator
seed -> iterate(body)
```

## Evaluation

r[iterate.sequence] iterate yields the seed, then each body result
`iterate(s, f)` MUST yield an iterator whose first element is `s` and whose each later element
is the result of calling `f` with the element before it. The iterator MUST never report done.

r[iterate.lazy] The body runs only when a later element is read
Creating the iterator MUST NOT call `f`. Reading the first `k` elements MUST call `f` `k - 1`
times, so `take(1)` yields the seed without calling `f`.

## Interactions

`seed -> iterate(f)` passes the seed as the first argument (`pipe.call-operand`). The body's
arity is stated in `iteration.arity-single`, `break` in it in `break.other-operators`, and a
halt in it propagates as `iteration.halt` states. Reads are bounded by `slicing-limit` and
`iteration.expansion`.

## Examples

```rill
list[iterate(1, { $ * 2 }) -> take(4), 0 -> iterate({ $ + 3 }) -> take(3)]
# Result: list[list[1, 2, 4, 8], list[0, 3, 6]]
```

```rill
iterate(0, fn(x: string) { $x }) -> take(1)
# Result: list[0]
```

## Notes

A `body` that is not callable halts RILL-R006 when `iterate` is called, not `#TYPE_MISMATCH` as
`iteration.callable` states for the operators: see INCONSISTENCIES.md.
