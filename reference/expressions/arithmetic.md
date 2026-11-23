---
id: arithmetic
title: Arithmetic
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [operator, number]
tests: [arithmetic.test.ts, closure-auto-invoke.test.ts]
---

# Arithmetic

The arithmetic operators `+`, `-`, `*`, `/`, `%`, and unary `-` compute a number from numbers.

## Evaluation

r[arithmetic.basic] +, -, *, and / compute on two numbers
`a + b`, `a - b`, `a * b`, and `a / b` MUST yield the sum, the difference, the product, and the
quotient. `/` MUST NOT truncate: `10 / 4` yields 2.5.

r[arithmetic.modulo] % yields the remainder with the sign of the dividend
`a % b` MUST yield `a` minus the largest whole multiple of `b` toward zero, so `7 % 3` yields 1,
`-7 % 3` yields -1, `7 % -3` yields 1, and `7.5 % 2` yields 1.5.

r[arithmetic.negate] Unary minus negates a number
`-x` MUST yield the number `x` negated. `--2` MUST yield 2, and `-(2 + 3)` MUST yield -5.

r[arithmetic.number-only] Every arithmetic operand is a number
An arithmetic operand that is a bool, a list, a dict, a tuple, an ordered, a map, a function, a
type value, or an iterator MUST halt with RILL-R002 `Arithmetic requires number, got <kind>`, for
the binary operators and for unary `-`.

## Interactions

Precedence and grouping are stated in `operator`. Division and modulo by zero, and overflow, are
stated in `number.finite`. A string, an atom, a datetime, and a duration are not arithmetic
operands (`string.no-arithmetic`, `atom.no-arithmetic`, `datetime.no-arithmetic`,
`duration.no-arithmetic`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An operand is not a number | RILL-R002 | Yes |
| Division or modulo by zero (`number.finite`) | RILL-R002 | Yes |

## Examples

```rill
list[10 / 4, -7 % 3, --2]
# Result: list[2.5, -1, 2]
```

```rill
# Error: RILL-R002 Arithmetic requires number, got list
list[1] + list[2]
```
