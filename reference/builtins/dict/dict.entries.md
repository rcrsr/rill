---
id: dict.entries
title: dict.entries
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, dict, iteration, code-block]
tests: [dict-key-form.test.ts, builtin-collection-methods.test.ts]
---

# dict.entries

`.entries` yields the entries of a dict as a list of key and value tuples.

## Syntax

```text
dict.entries() -> list(tuple(string, any))
```

## Evaluation

r[dict.entries.order] .entries lists the entries in key order
`.entries` MUST yield one tuple per entry (`dict.entries-type`), in the key order
`iteration.dict` states. `dict[].entries` MUST yield `list[]`.

## Interactions

A held block among the values halts the read (`code-block.non-selecting`).

## Examples

```rill
dict[b: 1, a: 2] -> .entries
# Result: list[tuple["a", 2], tuple["b", 1]]
```
