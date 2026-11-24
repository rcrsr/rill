---
id: dict.values
title: dict.values
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, dict, iteration, inference, code-block]
tests: [dict-key-form.test.ts, builtin-collection-methods.test.ts]
---

# dict.values

`.values` yields the values of a dict as a list.

## Syntax

```text
dict.values() -> list
```

## Evaluation

r[dict.values.order] .values lists the values in key order
`.values` MUST yield a list holding each of the receiver's values, in the key order
`iteration.dict` states. `dict[].values` MUST yield `list[]`.

## Interactions

The result's element type is inferred as any built list's is (`inference.union-element`). A held
block among the values halts the read (`code-block.non-selecting`).

## Examples

```rill
dict[b: 1, a: 2] -> .values
# Result: list[2, 1]
```
