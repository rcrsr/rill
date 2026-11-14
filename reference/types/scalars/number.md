---
id: number
title: Numbers
status: normative
since: 0.24.0
issues: [560]
grammar: [number]
errors: [RILL-L003, RILL-P001, RILL-R002, RILL-R036, RILL-R038, INVALID_INPUT, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [arithmetic.test.ts, literals.test.ts, type-assertions.test.ts]
---

# Numbers

A number is an immutable finite double-precision value that a decimal literal writes.

## Syntax

```ebnf
number        = [ "-" ] , digit , { digit } , [ "." , digit , { digit } ] ;
```

## Static rules

r[number.literal] A decimal literal yields a number
A literal of one or more digits, optionally followed by a point and one or more digits, MUST
yield a number. A leading `-` MUST negate it.

r[number.malformed] Exponent, hexadecimal, and separator forms are rejected
A number literal followed by an exponent (`1e3`), a radix prefix (`0x10`), or a digit separator
(`1_000`) MUST raise RILL-L003.

r[number.bare-point] A point needs a digit before it and after it
A literal that starts with a point (`.5`) or ends with a point and no digits (`5.`) MUST raise
RILL-P001.

## Evaluation

r[number.value] A number is a double-precision float
A number MUST hold one IEEE 754 binary64 value. `0.1 + 0.2` ⇒ `0.30000000000000004`.

r[number.precision] Integers beyond 2^53 lose precision
An integer larger than 2^53 MUST round to the nearest binary64 value, so
`9007199254740993 == 9007199254740992` ⇒ `true`.

r[number.finite] Arithmetic never yields a non-finite number
An arithmetic result that overflows to infinity MUST halt with `#INVALID_INPUT`. A division or
modulo by zero MUST halt with RILL-R002.

r[number.print] A number prints in its shortest round-trip form
A number MUST print as the shortest decimal that reads back to the same value. An integral value
prints without a point, so `1.0` prints `1`. Either zero prints `0`.

r[number.print-exponent] A number of extreme magnitude prints in exponent form
A number whose magnitude is `1e21` or more MUST print as its shortest digits, then `e+` and the
exponent, so `1e21` prints `1e+21`. A nonzero number whose magnitude is below `1e-6` MUST print
with `e-` and the exponent, so `0.00000015` prints `1.5e-7`. Every magnitude between prints in
plain decimal.

r[number.equality] Two numbers are equal when their values are equal
`==` between two numbers MUST yield true exactly when both hold the same value. `1 == 1.0` ⇒
`true`, and `-0 == 0` ⇒ `true`.

r[number.ordering] Numbers order by value
`<`, `>`, `<=`, and `>=` between two numbers MUST compare their values.

## Interactions

r[number.no-coercion] A number never coerces to or from another type
Ordering a number against a non-number MUST halt with RILL-R002.

r[number.no-equality-coercion] Equality does not coerce
`==` between a number and a string MUST NOT coerce either operand, so `"1" == 1` ⇒ `false`.

r[number.cross-equality] Equality against a non-number halts {pending #560}
`==` and `!=` between a number and an operand whose type does not overlap `number` MUST halt
with `#TYPE_MISMATCH`.

r[number.from-string] A string in decimal form converts to its number
`string -> number` MUST yield the number of a string that holds an optional `-`, digits with an
optional point, and an optional exponent. `"5"`, `"5."`, `".5"`, `"-.5"`, and `"1e3"` convert, so
`"1e3" -> number` ⇒ `1000`. A leading zero is allowed, so `"005" -> number` ⇒ `5`.

r[number.from-string-fail] A string that is not a decimal halts with a value error
`string -> number` MUST halt with RILL-R038 when the string is empty, holds whitespace, a leading
`+`, a radix prefix, a digit separator, or any other text. `"abc" -> number` halts.

r[number.from-overflow] A string that overflows halts as invalid input
`string -> number` MUST halt with `#INVALID_INPUT` when the string reads as infinity, so
`"1e999" -> number` halts.

r[number.from-bool] A bool converts to one or zero
`true -> number` MUST yield `1` and `false -> number` MUST yield `0`.

r[number.from-other] Any other source has no route
A source other than a number, string, or bool piped into `number` MUST halt with RILL-R036.
`#a -> number` halts.

r[number.membership] Only a number satisfies number
A number MUST satisfy `:number`. A value of any other type MUST halt `:number` with
`#TYPE_MISMATCH`, including the string `"1"`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A literal has an exponent, radix prefix, or separator | RILL-L003 | No |
| A literal starts or ends with a bare point | RILL-P001 | No |
| Arithmetic overflows to infinity | `#INVALID_INPUT` | Yes |
| Division or modulo by zero | RILL-R002 | Yes |
| A number is ordered against a non-number | RILL-R002 | Yes |
| A non-number is asserted as `:number` | `#TYPE_MISMATCH` | Yes |
| A string that is not a decimal is converted to number | RILL-R038 | Yes |
| A string that reads as infinity is converted to number | `#INVALID_INPUT` | Yes |
| A source with no route is converted to number | RILL-R036 | Yes |
| A number is compared for equality with a non-number {pending #560} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
0.1 + 0.2 == 0.3
# Result: false
```

```rill
"1e3" -> number
# Result: 1000
```

```rill
1000000000000000000000 -> "{$}"
# Result: "1e+21"
```

```rill
# Error: the string is not a decimal
"abc" -> number
```

```rill
# Error: ordering a number against a string
1 < "a"
```

## Notes

A literal past the double range reads as infinity in the current runtime, which breaks
`number.finite` (#603). The conversion `"Infinity" -> number` halts RILL-R038.

Until #560 lands, `==` between a number and a non-number yields false.
