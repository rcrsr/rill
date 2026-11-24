---
id: number.ge
title: number.ge
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, number]
tests: [methods.test.ts]
---

# number.ge

`.ge` tests whether a number orders greater than or equal to another value.

## Syntax

```text
number.ge(other: any) -> bool
```

## Evaluation

r[number.ge.operator] .ge yields what >= yields
`n.ge(x)` MUST yield what `n >= x` yields (`number.ordering`), and MUST halt where it halts
(`number.no-coercion`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a number (`number.no-coercion`) | RILL-R002 | Yes |

## Examples

```rill
1 -> .ge(2)
# Result: false
```

```rill
# Error: Cannot compare number with string
1 -> .ge("a")
```
