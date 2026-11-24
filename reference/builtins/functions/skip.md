---
id: skip
title: skip
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [slicing, slicing-limit]
tests: [collection-operators.test.ts, collection-slicing.test.ts]
---

# skip

`skip` yields the elements of a source after the first `n`.

## Syntax

```text
skip(source, n: number) -> list
```

## Evaluation

r[skip.rest] skip yields the elements after the first n
`skip(n)` MUST yield a list of the source's elements after its first `n`, in source order.

r[skip.past-end] A count at or past the end yields an empty list
`skip(n)` with `n` at least the element count MUST yield `list[]`. `skip(0)` MUST yield every
element.

r[skip.negative] A negative count halts
A negative `n` MUST halt with `#INVALID_INPUT`.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, and a
fractional `n` in `slicing.integer`. Reading an iterator is bounded by `slicing-limit.step-walk`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `n` is negative | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[range(1, 6) -> skip(3), list[1, 2] -> skip(5), list[1, 2] -> skip(0)]
# Result: list[list[4, 5], list[], list[1, 2]]
```

```rill
# Error: skip: n cannot be negative
list[1, 2] -> skip(-1)
```
