---
id: dict.first
title: dict.first
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, dict, iteration, code-block]
tests: [iterators.test.ts, builtin-collection-methods.test.ts]
---

# dict.first

`.first` yields an iterator over the entries of a dict.

## Syntax

```text
dict.first() -> iterator
```

## Evaluation

r[dict.first.iterator] .first yields an iterator over entry dicts
`.first` MUST yield an iterator whose values are `dict[key: k, value: v]` for each entry, in the
key order `iteration.dict` states. On `dict[]` the iterator MUST be done.

## Interactions

A held block among the values halts the read (`code-block.non-selecting`).

## Examples

```rill
dict[b: 1, a: 2] -> .first -> .value
# Result: dict[key: "a", value: 2]
```

```rill
dict[] -> .first -> .done
# Result: true
```
