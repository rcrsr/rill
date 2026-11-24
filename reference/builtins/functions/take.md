---
id: take
title: take
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [slicing, slicing-limit]
tests: [collection-operators.test.ts, iterate.test.ts, builtin-functions-slicing.test.ts]
---

# take

`take` yields the first `n` elements of a source.

## Syntax

```text
take(source, n: number) -> list
```

## Evaluation

r[take.first] take yields the first n elements in order
`take(n)` MUST yield a list of the source's first `n` elements, in source order.

r[take.short] A shorter source yields all its elements
A source with fewer than `n` elements MUST yield all of them. `take(0)` MUST yield `list[]`.

r[take.negative] A negative count halts
A negative `n` MUST halt with `#INVALID_INPUT`.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, and a
fractional `n` in `slicing.integer`. `take` reads an iterator one element at a time
(`slicing-limit.step-walk`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `n` is negative | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[range(1, 100) -> take(3), list[1, 2] -> take(5), "abc" -> take(0)]
# Result: list[list[1, 2, 3], list[1, 2], list[]]
```

```rill
# Error: take: n cannot be negative
list[1, 2] -> take(-1)
```
