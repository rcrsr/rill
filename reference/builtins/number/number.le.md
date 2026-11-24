---
id: number.le
title: number.le
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, number]
tests: [methods.test.ts]
---

# number.le

`.le` tests whether a number orders less than or equal to another value.

## Syntax

```text
number.le(other: any) -> bool
```

## Evaluation

r[number.le.operator] .le yields what <= yields
`n.le(x)` MUST yield what `n <= x` yields (`number.ordering`), and MUST halt where it halts
(`number.no-coercion`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a number (`number.no-coercion`) | RILL-R002 | Yes |

## Examples

```rill
2 -> .le(2)
# Result: true
```

```rill
# Error: Cannot compare number with string
1 -> .le("a")
```
