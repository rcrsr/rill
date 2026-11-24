---
id: dict.len
title: dict.len
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, dict, code-block]
tests: [variable-method-calls.test.ts, builtin-collection-methods.test.ts]
---

# dict.len

`.len` yields the number of keys in a dict.

## Syntax

```text
dict.len() -> number
```

## Evaluation

r[dict.len.count] .len counts keys
`.len` MUST yield the number of keys in the receiver. `dict[].len` MUST yield 0.

## Interactions

A dict that holds a code block is counted without running it (`code-block.shape-reads`).

## Examples

```rill
list[dict[b: 1, a: 2].len, dict[].len]
# Result: list[2, 0]
```
