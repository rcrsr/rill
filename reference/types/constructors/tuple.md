---
id: tuple
title: Tuple types
status: normative
since: 0.24.0
issues: [571, 573]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [type-value, type-form]
tests: [structural-type-identity.test.ts, structural-type-boundaries.test.ts, structural-type-defaults.test.ts, type-inner-outer.test.ts, type-assertions.test.ts]
---

# Tuple types

A tuple type names one type for each position of a fixed-length sequence.

## Syntax

```text
tuple                           any tuple
tuple(number, string)           exactly two positions
tuple(number, string = "x")     a trailing position MAY carry a default
```

r[tuple.position-type] A position type is any type
A position type MUST be any type, and a tuple type MAY nest.

r[tuple.positions] A tuple type has one position per argument
`tuple(number, string)` MUST name exactly two positions. A tuple value MUST have it only when
it has a number at position 0 and a string at position 1, and no other position.

r[tuple.one-position] A single argument names one position {pending #573}
`tuple(number)` MUST name exactly one number. `tuple[1, 2] -> :?tuple(number)` MUST yield
false, and `tuple[] -> :?tuple(number)` MUST yield false.

r[tuple.no-uniform] A tuple type has no uniform form {pending #573}
A sequence of any length with one element type MUST be written `list(T)`. No spelling of
`tuple` MUST mean "any length, every element `T`".

r[tuple.unnamed] A named argument halts
`tuple(a: number)` MUST halt with `#INVALID_INPUT`.

r[tuple.bare] The bare tuple accepts any tuple
`tuple` MUST accept every tuple value, whatever its length and element types.

r[tuple.unspecified] tuple and tuple() are one type {pending #571}
`tuple` and `tuple()` MUST compare equal.

r[tuple.any-position] tuple(any) names one position holding any {pending #573}
`tuple(any)` MUST NOT equal `tuple`. `tuple[1] -> :?tuple(any)` MUST yield true, and
`tuple[1, 2] -> :?tuple(any)` MUST yield false.

## Static rules

r[tuple.no-outer] A tuple type takes no outer {pending #571}
A tuple type written with an outer, such as `tuple(number):string`, MUST be a parse error.

r[tuple.default-trailing] Only trailing positions carry a default
A position without a default that follows a position with a default MUST halt with
`#INVALID_INPUT`. A default MUST have its position's type, or the type halts with
`#TYPE_MISMATCH`.

## Evaluation

r[tuple.omitted-default] A defaulted position may be absent
A tuple value MUST have `tuple(number, string = "x")` when it holds only the number. A present
position MUST have its position type.

r[tuple.not-list] A tuple value does not have a list type
`tuple[1, 2] -> :?list(number)` MUST yield false.

r[tuple.equality] Tuple types are equal when their positions are equal in order
`tuple(number, string)` MUST NOT equal `tuple(string, number)`. A position default is part of
the type, so `tuple(number, string = "x")` MUST NOT equal `tuple(number, string)`.

r[tuple.inner] A tuple type's inner is a tuple of its position types
`.inner` MUST return a tuple holding one type per position.

r[tuple.print] A tuple type prints its positions
`tuple(T, U)` MUST print as `tuple(T, U)` with each position in printed form, and a type with
one position MUST print as `tuple(T)`.

## Interactions

An unknown type name as an argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Named argument | `#INVALID_INPUT` | Yes |
| Position without a default after one with a default | `#INVALID_INPUT` | Yes |
| Default does not have its position's type | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
tuple[1, "a"].^type == tuple(number, string)
# Result: true
```

```rill
tuple[1, 2, 3] -> :?tuple(number, number)
# Result: false
```

```rill
tuple[1] -> :?tuple(number, string = "x")
# Result: true
```

```rill
tuple(number, string).inner[0] == number
# Result: true
```

```rill pending=573
tuple[1, 2] -> :?tuple(number)
# Result: false
```

## Notes

On 0.23.0 a one-argument `tuple(T)` is a uniform form: `tuple[1, 2, 3] -> :?tuple(number)` is
true, and `tuple[1].^type == tuple(number)` is false. #573 removes that reading.

Open decision: #595, whether `.defaults` on a tuple type returns the position defaults. It
halts RILL-R003 today, and `dict` and `ordered` types answer it.

The type of an empty tuple prints `tuple()` today. #571 makes `tuple()` the unspecified type, so
a zero-position tuple type has no stated spelling yet.

`tuple(number):string` parses today as an assertion of the type value against `string` and halts
`#TYPE_MISMATCH` at run time.
