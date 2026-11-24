---
id: cycle
title: cycle
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R045]
depends: [slicing, iteration, invocation]
tests: [collection-operators.test.ts, collection-slicing.test.ts, builtin-functions-slicing.test.ts]
---

# cycle

`cycle` yields an iterator that repeats the elements of a source without end.

## Syntax

```text
cycle(source) -> iterator
```

## Evaluation

r[cycle.repeat] cycle repeats the source's elements in order
`cycle` MUST yield an iterator whose elements are the source's elements in source order,
starting again from the first after the last, and which never reports done.

r[cycle.empty] An empty source cycles to an empty iterator
`cycle` over a source with no elements MUST yield an iterator that is done at once.

## Interactions

The sources are stated in `slicing.sources`. `cycle` takes only its source; another argument
halts as `invocation.excess` states. Reading the iterator without a bound halts at
`iteration.expansion`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An argument after the source (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
list["a" -> cycle -> take(3), list[] -> cycle -> take(3), range(0, 2) -> cycle -> take(3)]
# Result: list[list["a", "a", "a"], list[], list[0, 1, 0]]
```

```rill
list[1, 2] -> cycle -> .^type.signature
# Result: "iterator"
```
