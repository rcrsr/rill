---
id: list.first
title: list.first
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, list, iteration]
tests: [iterators.test.ts]
---

# list.first

`.first` yields an iterator over the elements of a list.

## Syntax

```text
list.first() -> iterator
```

## Evaluation

r[list.first.iterator] .first yields an iterator over elements
`.first` MUST yield an iterator whose values are the receiver's elements in order, as
`iteration.list` yields them. On `list[]` the iterator MUST be done.

## Examples

```rill
list[1, 2] -> .first -> .value
# Result: 1
```

```rill
list[] -> .first -> .done
# Result: true
```
