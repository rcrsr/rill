---
id: list.tail
title: list.tail
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, list, code-block]
tests: [variable-method-calls.test.ts, iterators.test.ts, methods.test.ts]
---

# list.tail

`.tail` yields the last element of a list.

## Syntax

```text
list.tail() -> any
```

## Evaluation

r[list.tail.last] .tail yields the last element
`.tail` MUST yield the receiver's last element.

r[list.tail.empty] .tail on an empty list halts
`.tail` on `list[]` MUST halt with RILL-R002.

## Interactions

A held block at the last position halts the read (`code-block.non-selecting`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The receiver is empty | RILL-R002 | Yes |

## Examples

```rill
list[1, 2, 3] -> .tail
# Result: 3
```

```rill
# Error: Cannot get tail of empty list
list[] -> .tail
```
