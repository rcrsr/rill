---
id: fold
title: fold
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R044]
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

r[fold.named] A named parameter receives only the element
A function with named parameters MUST receive the element as its first argument and no
accumulator argument. A second named parameter without a default MUST halt with RILL-R044.

r[fold.seed-required] The seed is required
`fold` with only a function argument MUST halt with RILL-R044.

## Interactions

`break` inside `fold` halts (`break.unsupported`). `acc` threads the same accumulator and
yields every step (`acc.result`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| No seed, or a second named parameter without a default | RILL-R044 | No |
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
list[1, 2, 3] -> fold(0, |number, number| { $@ + $ })
# Result: 6
```
