---
id: ordered.values
title: ordered.values
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, ordered, iteration, inference, code-block]
tests: [ordered-access.test.ts, builtin-collection-methods.test.ts]
---

# ordered.values

`.values` yields the values of an ordered as a list.

## Syntax

```text
ordered.values() -> list
```

## Evaluation

r[ordered.values.order] .values lists the values in the ordered's own order
`.values` MUST yield a list holding each of the receiver's values, in the receiver's own order
(`iteration.ordered`). `ordered[].values` MUST yield `list[]`.

## Interactions

The result's element type is inferred as any built list's is (`inference.union-element`). A held
block among the values halts the read (`code-block.non-selecting`).

## Examples

```rill
ordered[b: 1, a: 2] -> .values
# Result: list[1, 2]
```
