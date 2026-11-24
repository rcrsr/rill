---
id: list.reverse
title: list.reverse
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, list, value, code-block]
tests: [sort.test.ts, builtin-collection-methods.test.ts]
---

# list.reverse

`.reverse` yields a list holding the elements of a list in reverse order.

## Syntax

```text
list.reverse() -> list
```

## Evaluation

r[list.reverse.order] .reverse yields the elements last to first
`.reverse` MUST yield a new list holding the receiver's elements from last to first.
`list[].reverse` MUST yield `list[]`.

## Interactions

The receiver is left as it was (`value.immutable`). A held block among the elements halts the
read (`code-block.non-selecting`).

## Examples

```rill
list[1, 2, 3] -> .reverse
# Result: list[3, 2, 1]
```
