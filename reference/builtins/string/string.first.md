---
id: string.first
title: string.first
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string, iteration]
tests: [iterators.test.ts]
---

# string.first

`.first` yields an iterator over the code points of a string.

## Syntax

```text
string.first() -> iterator
```

## Evaluation

r[string.first.iterator] .first yields an iterator over code points
`.first` MUST yield an iterator whose values are the receiver's code points in order, each a
one-character string, as `iteration.string` yields them. On `""` the iterator MUST be done.

## Examples

```rill
"abc" -> .first -> .value
# Result: "a"
```

```rill
"" -> .first -> .done
# Result: true
```
