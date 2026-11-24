---
id: string.head
title: string.head
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [iterators.test.ts, methods.test.ts, builtin-string.test.ts]
---

# string.head

`.head` yields the first code point of a string.

## Syntax

```text
string.head() -> string
```

## Evaluation

r[string.head.first] .head yields the first code point
`.head` MUST yield a string holding the receiver's first code point. `"😀a".head` MUST yield
`"😀"`.

r[string.head.empty] .head on an empty string halts
`.head` on `""` MUST halt with RILL-R002.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The receiver is empty | RILL-R002 | Yes |

## Examples

```rill
"abc" -> .head
# Result: "a"
```

```rill
# Error: Cannot get head of empty string
"" -> .head
```
