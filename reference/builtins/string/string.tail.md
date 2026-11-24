---
id: string.tail
title: string.tail
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [iterators.test.ts, methods.test.ts, builtin-string.test.ts]
---

# string.tail

`.tail` yields the last code point of a string.

## Syntax

```text
string.tail() -> string
```

## Evaluation

r[string.tail.last] .tail yields the last code point
`.tail` MUST yield a string holding the receiver's last code point. `"a😀".tail` MUST yield
`"😀"`.

r[string.tail.empty] .tail on an empty string halts
`.tail` on `""` MUST halt with RILL-R002.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The receiver is empty | RILL-R002 | Yes |

## Examples

```rill
"abc" -> .tail
# Result: "c"
```

```rill
# Error: Cannot get tail of empty string
"" -> .tail
```
