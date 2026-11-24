---
id: ordered.entries
title: ordered.entries
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, ordered, dict, iteration, code-block]
tests: [ordered-access.test.ts, dict-key-form.test.ts, builtin-collection-methods.test.ts]
---

# ordered.entries

`.entries` yields the entries of an ordered as a list of key and value tuples.

## Syntax

```text
ordered.entries() -> list(tuple(string, any))
```

## Evaluation

r[ordered.entries.order] .entries lists the entries in the ordered's own order
`.entries` MUST yield one tuple per entry (`dict.entries-type`), in the receiver's own order
(`iteration.ordered`). `ordered[].entries` MUST yield `list[]`.

## Interactions

A held block among the values halts the read (`code-block.non-selecting`).

## Examples

```rill
ordered[b: 1, a: 2] -> .entries
# Result: list[tuple["b", 1], tuple["a", 2]]
```
