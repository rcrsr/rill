---
id: string.gt
title: string.gt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.gt

`.gt` tests whether a string orders greater than another value.

## Syntax

```text
string.gt(other: any) -> bool
```

## Evaluation

r[string.gt.operator] .gt yields what > yields
`s.gt(x)` MUST yield what `s > x` yields (`string.ordering`), and MUST halt where it halts
(`string.cross-order`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a string (`string.cross-order`) | RILL-R002 | Yes |

## Examples

```rill
"a" -> .gt("b")
# Result: false
```

```rill
# Error: Cannot compare string with number
"a" -> .gt(1)
```
