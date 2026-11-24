---
id: number.gt
title: number.gt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, number]
tests: [methods.test.ts]
---

# number.gt

`.gt` tests whether a number orders greater than another value.

## Syntax

```text
number.gt(other: any) -> bool
```

## Evaluation

r[number.gt.operator] .gt yields what > yields
`n.gt(x)` MUST yield what `n > x` yields (`number.ordering`), and MUST halt where it halts
(`number.no-coercion`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a number (`number.no-coercion`) | RILL-R002 | Yes |

## Examples

```rill
2 -> .gt(1)
# Result: true
```

```rill
# Error: Cannot compare number with string
1 -> .gt("a")
```
