---
id: list.head
title: list.head
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, list, code-block]
tests: [variable-method-calls.test.ts, iterators.test.ts, methods.test.ts]
---

# list.head

`.head` yields the first element of a list.

## Syntax

```text
list.head() -> any
```

## Evaluation

r[list.head.first] .head yields the first element
`.head` MUST yield the receiver's first element.

r[list.head.empty] .head on an empty list halts
`.head` on `list[]` MUST halt with RILL-R002.

## Interactions

A held block at the first position halts the read (`code-block.non-selecting`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The receiver is empty | RILL-R002 | Yes |

## Examples

```rill
list[1, 2, 3] -> .head
# Result: 1
```

```rill
# Error: Cannot get head of empty list
list[] -> .head
```
