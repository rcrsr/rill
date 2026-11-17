---
id: bool
title: Booleans
status: normative
since: 0.24.0
issues: []
grammar: [bool]
errors: [RILL-R002, RILL-R036, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [boolean.test.ts, literals.test.ts, conditionals.test.ts, type-assertions.test.ts]
---

# Booleans

A bool is one of the two values `true` and `false`, the only values a condition accepts.

## Syntax

```ebnf
bool          = "true" | "false" ;
```

## Static rules

r[bool.literal] The words true and false are the bool literals
The lowercase words `true` and `false` MUST yield the two bool values.

r[bool.case] A differently cased word is not a bool literal
A word such as `TRUE` MUST NOT be a bool literal.

## Evaluation

r[bool.print] A bool prints as its word
A bool MUST print as `true` or `false`. Interpolating a bool inserts that word.

r[bool.equality] Two bools are equal when they are the same value
`==` between two bools MUST yield true exactly when both are `true` or both are `false`.

r[bool.unordered] Bools have no order
`<`, `>`, `<=`, and `>=` with a bool operand MUST halt with RILL-R002.

## Interactions

Equality against a non-bool value follows `equality.no-overlap`.

r[bool.no-truthiness] No other type stands in for a bool
A non-bool operand of `!` MUST halt with RILL-R002, and MUST NOT be coerced.

r[bool.condition] A condition must be a bool
A non-bool condition of `?` MUST halt with RILL-R002, and MUST NOT be coerced.

r[bool.from-number] The numbers zero and one convert to bools
`0 -> bool` MUST yield `false` and `1 -> bool` MUST yield `true`.

r[bool.from-string] The words true and false convert to bools
`"true" -> bool` MUST yield `true` and `"false" -> bool` MUST yield `false`.

r[bool.no-route] Any other number has no route
A number other than `0` and `1` piped into `bool` MUST halt with RILL-R036. `2 -> bool` halts.

r[bool.no-route-string] Any other string has no route
A string other than `"true"` and `"false"` piped into `bool` MUST halt with RILL-R036.
`"True" -> bool` halts.

r[bool.no-route-type] A value of any other type has no route
A value that is neither a bool, a number, nor a string, piped into `bool`, MUST halt with
RILL-R036.

r[bool.membership] Only a bool satisfies bool
A bool MUST satisfy `:bool`. A value of any other type MUST halt `:bool` with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A bool is ordered with `<`, `>`, `<=`, or `>=` | RILL-R002 | Yes |
| `!` or a `?` condition receives a non-bool | RILL-R002 | Yes |
| A value outside the bool routes is converted to bool | RILL-R036 | Yes |
| A non-bool is asserted as `:bool` | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
(5 > 3) -> "is {$}"
# Result: "is true"
```

```rill
true != false
# Result: true
```

```rill
# Error: a number is not a condition
1 ? "yes" ! "no"
```

## Notes

The `&&` and `||` operands follow the same no-truthiness rule; the operators chapter states them.
