---
id: slicing-limit
title: Slicing limits
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R010]
depends: [halt, iteration]
tests: [limits.test.ts, collection-operators.test.ts, iterate.test.ts]
---

# Slicing limits

The slicing functions `take`, `skip`, `batch`, `window`, `start_when`, and `stop_when` build their
result under the 10,000-element ceiling that bounds iteration.

## Evaluation

r[slicing-limit.output] A slicing result holds at most 10,000 elements
`take`, `batch`, `window`, `start_when`, and `stop_when` MUST halt with RILL-R010 when their
result would hold more than 10,000 elements. An element of a `batch` result is one chunk, and of
a `window` result one window. A result of exactly 10,000 elements MUST be returned.

r[slicing-limit.step-walk] take and skip read at most 10,000 steps of an iterator
`take(n)` and `skip(n)` MUST read an iterator or a stream one element at a time. When they have
read 10,000 elements and still need more, they MUST halt with RILL-R010. A source that ends first
MUST NOT halt: `range(0, 5) -> take(10001)` yields five elements.

r[slicing-limit.list-source] A list source is not capped by its length
A list source holding more than 10,000 elements MUST NOT halt a slicing function by its length
alone. Only `slicing-limit.output` bounds the result: `skip(19998)` on a 20,000-element list
yields its last two elements.

## Interactions

`skip` on an iterator or a stream reads the elements past `n` as a list, bounded by
`iteration.expansion`. Reading an iterator that a slicing function returns is bounded by
`iteration.expansion` too. The operators of `iteration` apply `iteration.limit-first` to a list
source, which `slicing-limit.list-source` does not.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A slicing result would hold more than 10,000 elements (`slicing-limit.output`) | RILL-R010 | Undecided |
| `take` or `skip` reads 10,000 elements and needs more (`slicing-limit.step-walk`) | RILL-R010 | Undecided |

## Examples

```rill
range(0, 20000) -> take(10000) -> .len
# Result: 10000
```

```rill
# Error: Iterator/stream exceeded 10000 step limit
range(0, 20000) -> take(10001)
```

## Notes

`guard` catches each halt in the Errors table, while it cannot catch RILL-R010 from
`iteration.expansion`. Whether these halts are catchable is undecided: see INCONSISTENCIES.md.

`iterate` also counts the calls of its function and halts RILL-R010 "iterate: iteration exceeded
10000 limit" on the 10,001st, which `iteration.expansion` already bounds for a single read.
