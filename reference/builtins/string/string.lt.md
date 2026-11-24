---
id: string.lt
title: string.lt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.lt

`.lt` tests whether a string orders less than another value.

## Syntax

```text
string.lt(other: any) -> bool
```

## Evaluation

r[string.lt.operator] .lt yields what < yields
`s.lt(x)` MUST yield what `s < x` yields (`string.ordering`), and MUST halt where it halts
(`string.cross-order`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a string (`string.cross-order`) | RILL-R002 | Yes |

## Examples

```rill
"a" -> .lt("b")
# Result: true
```

```rill
# Error: Cannot compare string with number
"a" -> .lt(1)
```
