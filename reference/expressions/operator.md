---
id: operator
title: Operators
status: normative
since: 0.24.0
issues: []
grammar: [expression, value-expr, logical-or, logical-and, comparison, comparison-op, additive, multiplicative, unary, postfix-expr, primary, grouped-expr]
errors: [RILL-P001, RILL-R002]
depends: [pipe, number, string, tuple, duration, datetime, equality]
tests: [arithmetic.test.ts, boolean.test.ts, expressions.test.ts]
---

# Operators

An operator expression combines operands with `||`, `&&`, a comparison, `+`, `-`, `*`, `/`, `%`,
unary `-` and `!`, binding by precedence before any pipe.

## Syntax

```ebnf
expression    = pipe-chain ;
value-expr    = logical-or ;
logical-or    = logical-and , { "||" , logical-and } ;
logical-and   = comparison , { "&&" , comparison } ;
comparison    = additive , [ comparison-op , additive ] ;
comparison-op = "==" | "!=" | "<" | ">" | "<=" | ">=" ;
additive      = multiplicative , { ( "+" | "-" ) , multiplicative } ;
multiplicative = unary , { ( "*" | "/" | "%" ) , unary } ;
unary         = [ "-" | "!" ] , postfix-expr ;
postfix-expr  = primary
                        , { ( "." , method-name , [ "(" , [ arguments ] , ")" ] )
                          | annotation-access
                          | invoke
                          | bracket-access
                          | status-probe
                          | existence-check
                          | annotation-existence
                          | postfix-type-op } ;
primary       = declaration
              | literal
              | atom-literal
              | type-constructor
              | type-name
              | variable
              | fn-call
              | host-call
              | conditional
              | loop
              | guard-block
              | retry-block
              | timeout-block
              | block
              | grouped-expr
              | annotated-expr
              | pass-block
              | pass ;
grouped-expr   = "(" , pipe-chain , ")" ;
```

## Static rules

r[operator.precedence] Operators bind by a fixed precedence
From loosest to tightest, the levels MUST be `||`, `&&`, the comparisons, `+` and `-`, `*`, `/`,
and `%`, unary `-` and `!`, then postfix access. `1 + 2 * 3` MUST yield 7, and
`true || false && false` MUST yield true.

r[operator.left] Binary operators of one level group from the left
`10 - 4 - 3` MUST yield 3, and `24 / 4 / 2` MUST yield 3.

r[operator.no-chain] A comparison takes exactly two operands
A comparison whose operand is an unparenthesized comparison, as in `1 < 2 < 3` or
`1 == 1 == true`, MUST be rejected with RILL-P001.

r[operator.group] Parentheses group first
`(expr)` MUST evaluate `expr` before the operator around it, so `(1 + 2) * 3` yields 9. `()`
MUST be rejected with RILL-P001.

r[operator.before-pipe] Operators bind tighter than a pipe
An operator expression MUST be complete before `->` takes it: `1 + 2 -> { $ * 10 }` yields 30.

## Evaluation

r[operator.ordering] Ordering takes numbers, strings, tuples, durations, and datetimes
`<`, `>`, `<=`, and `>=` with an operand that is a list, a dict, an ordered, a map, a function,
a type value, or an iterator MUST halt with RILL-R002 naming both kinds and the operator.

## Interactions

`==` and `!=` are stated in `equality`. The order of each scalar is stated in `number.ordering`,
`string.ordering`, `tuple.order`, `duration.ordering`, and `datetime.ordering`. A bool or an
atom has none (`bool.unordered`, `atom.unordered`). The arithmetic operators are stated in
`arithmetic` and the logical operators in `logical`. A postfix access is stated in `access`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A chained comparison, or empty parentheses | RILL-P001 | No |
| An ordering operand is a collection other than a tuple, a function, a type, or an iterator | RILL-R002 | Yes |

## Examples

```rill
1 + 2 * 3 - 4 / 2
# Result: 5
```

```rill
(true || false) && false
# Result: false
```

```rill
1 + 2 -> { $ * 10 }
# Result: 30
```

```rill
# Error: RILL-P001
1 < 2 < 3
```

```rill
# Error: RILL-R002
list[1] < list[2]
```
