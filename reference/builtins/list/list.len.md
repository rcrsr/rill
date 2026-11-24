---
id: list.len
title: list.len
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, list, code-block]
tests: [variable-method-calls.test.ts, builtin-collection-methods.test.ts]
---

# list.len

`.len` yields the number of elements in a list.

## Syntax

```text
list.len() -> number
```

## Evaluation

r[list.len.count] .len counts elements
`.len` MUST yield the number of elements in the receiver. A nested list MUST count as one
element, and `list[].len` MUST yield 0.

## Interactions

A list that holds a code block is counted without running it (`code-block.shape-reads`).

## Examples

```rill
list[list[1, 2, 3].len, list[list[1, 2], 3].len, list[].len]
# Result: list[3, 2, 0]
```
