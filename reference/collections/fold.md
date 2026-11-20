---
id: fold
title: fold
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R044, RILL-R045]
depends: [iteration]
tests: [collection-operators.test.ts]
---

# fold

`fold` threads an accumulator through one call per element, in order, and yields the final
accumulator.

## Syntax

```text
source -> fold(seed, fn)
fold(source, seed, fn)
```

## Evaluation

r[fold.accumulator] Each call sees the accumulator as $@
Each call MUST bind the element to `$` and the accumulator to `$@`. The first call's
accumulator MUST be `seed`, and each later call's MUST be the previous call's result.

r[fold.order] Calls run one at a time, in source order
`fold` MUST start each call only after the previous call completes, in source order.

r[fold.result] fold yields the last accumulator
`fold` MUST yield the last call's result. An empty source MUST yield `seed`.

r[fold.unnamed] Two unnamed parameters type the element and the accumulator
A function with two unnamed parameters MUST check the element against the first and the
accumulator against the second. A mismatch MUST halt with RILL-R001.

r[fold.arity] fold calls its function with the element and the accumulator
`fold` MUST call its function with two arguments, the element and then the accumulator, whether
its parameters are named or unnamed. A function with fewer than two parameters MUST halt with
RILL-R045, and a function with a third required parameter MUST halt with RILL-R044.

r[fold.seed-required] The seed is required
`fold` with only a function argument MUST halt with RILL-R044.

## Interactions

`break` inside `fold` halts (`break.unsupported`). `acc` threads the same accumulator and
yields every step (`acc.result`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| No seed | RILL-R044 | No |
| The function takes fewer than two parameters | RILL-R045 | No |
| The function requires a third parameter | RILL-R044 | No |
| An element or accumulator fails its unnamed parameter type | RILL-R001 | No |

## Examples

```rill
list[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6
```

```rill
list[] -> fold(42, { $@ + $ })
# Result: 42
```

```rill
"abc" -> fold("", { "{$}{$@}" })
# Result: "cba"
```

```rill
list[1, 2, 3] -> fold(0, fn(number, number) { $@ + $ })
# Result: 6
```

## Notes

Superseded: `fold.named`, now `fold.arity`. On 0.23.0 a function with named parameters receives
only the element, and a second named parameter without a default halts RILL-R044.
