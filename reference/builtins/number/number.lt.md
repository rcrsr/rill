---
id: number.lt
title: number.lt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, number]
tests: [methods.test.ts]
---

# number.lt

`.lt` tests whether a number orders less than another value.

## Syntax

```text
number.lt(other: any) -> bool
```

## Evaluation

r[number.lt.operator] .lt yields what < yields
`n.lt(x)` MUST yield what `n < x` yields (`number.ordering`), and MUST halt where it halts
(`number.no-coercion`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a number (`number.no-coercion`) | RILL-R002 | Yes |

## Examples

```rill
1 -> .lt(2)
# Result: true
```

```rill
# Error: Cannot compare number with string
1 -> .lt("a")
```
