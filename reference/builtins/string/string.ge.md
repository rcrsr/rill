---
id: string.ge
title: string.ge
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.ge

`.ge` tests whether a string orders at least another value.

## Syntax

```text
string.ge(other: any) -> bool
```

## Evaluation

r[string.ge.operator] .ge yields what >= yields
`s.ge(x)` MUST yield what `s >= x` yields (`string.ordering`), and MUST halt where it halts
(`string.cross-order`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a string (`string.cross-order`) | RILL-R002 | Yes |

## Examples

```rill
"B" -> .ge("a")
# Result: false
```

```rill
# Error: Cannot compare string with number
"a" -> .ge(1)
```
