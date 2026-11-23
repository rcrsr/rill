---
id: logical
title: Logical operators
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P004, RILL-R002]
depends: [operator, bool]
tests: [boolean.test.ts, parser-syntax-errors.test.ts, closure-auto-invoke.test.ts]
---

# Logical operators

`&&`, `||`, and `!` combine and negate bools.

## Static rules

r[logical.not-operand] ! takes an operand
A `!` with no operand after it, as in `"x" -> !`, MUST be rejected with RILL-P004.

## Evaluation

r[logical.and] && is true when both operands are true
`a && b` MUST yield true when `a` and `b` are both true, and false otherwise.

r[logical.or] || is true when either operand is true
`a || b` MUST yield true when `a` or `b` is true, and false otherwise.

r[logical.not] ! negates a bool
`!a` MUST yield false for true and true for false.

r[logical.short-circuit] The right operand runs only when it decides the result
`false && b` and `true || b` MUST NOT evaluate `b`, so `false && $undefined` yields false.

r[logical.bool-operands] Each evaluated operand of && and || is a bool
An evaluated operand of `&&` or `||` that is not a bool MUST halt with RILL-R002, and MUST NOT be
coerced. An operand that `logical.short-circuit` skips is not evaluated, so `false && 1` yields
false.

## Interactions

Precedence is stated in `operator`. A non-bool operand of `!` is stated in `bool.no-truthiness`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `!` with no operand | RILL-P004 | No |
| An evaluated operand of a binary logical operator is not a bool | RILL-R002 | Yes |

## Examples

```rill
list[true && false, false || true, !false]
# Result: list[false, true, true]
```

```rill
false && $undefined
# Result: false
```

```rill
# Error: RILL-R002
true && 1
```
