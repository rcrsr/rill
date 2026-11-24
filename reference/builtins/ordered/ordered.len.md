---
id: ordered.len
title: ordered.len
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, ordered, code-block]
tests: [ordered-access.test.ts, builtin-collection-methods.test.ts]
---

# ordered.len

`.len` yields the number of keys in an ordered.

## Syntax

```text
ordered.len() -> number
```

## Evaluation

r[ordered.len.count] .len counts keys
`.len` MUST yield the number of keys in the receiver. `ordered[].len` MUST yield 0.

## Interactions

An ordered that holds a code block is counted without running it (`code-block.shape-reads`).

## Examples

```rill
list[ordered[b: 1, a: 2].len, ordered[].len]
# Result: list[2, 0]
```
