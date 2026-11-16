---
id: conversion
title: Conversion
status: normative
since: 0.24.0
issues: [566, 574]
grammar: []
errors: [RILL-R036, RILL-R037, RILL-R038, RILL-R044]
depends: [type-value, structural-typing, any, union, defaults, carried-type, inference, list, dict, tuple, ordered]
tests: [conversion.test.ts, structural-type-defaults.test.ts]
---

# Conversion

A conversion is a pipe into a type that returns a value having that type, and an assertion `-> :T` only checks.

## Evaluation

r[conversion.pipe] A type after the pipe converts the value
`value -> T` MUST convert the piped value to a value that has type `T`. No method and no other
operator converts. An assertion never converts, as `assertion.unchanged` states.

r[conversion.drop] A conversion drops what the target does not name
A conversion to a dict, ordered, or tuple type MUST drop each field or position the target does
not name. `dict[a: 1, b: 2] -> dict(a: number)` ⇒ `dict[a: 1]`.

r[conversion.fill] A conversion fills a defaulted field
A conversion MUST fill an omitted field or position that the target gives a default, as
`defaults.fill` states. The omitted field that has no default raises RILL-R044, as
`defaults.required` states.

r[conversion.list-tuple] A list and a tuple convert to each other
`list` MUST convert to `tuple`, and `tuple` to `list`. `list[1, 2] -> tuple` ⇒ `tuple[1, 2]`.

r[conversion.ordered-dict] An ordered value converts to a dict
`ordered` MUST convert to `dict`. `ordered[a: 1] -> dict` ⇒ `dict[a: 1]`.

r[conversion.dict-ordered] A dict converts to ordered through a signature
`dict` MUST convert to `ordered` when the target names its fields, in the target's field order.
`dict[a: 1] -> ordered(a: number)` ⇒ `ordered[a: 1]`.

r[conversion.no-signature] A dict converts to ordered only with a signature
A dict converted to `ordered` with no signature MUST raise RILL-R037.

r[conversion.missing] A conversion that does not exist halts
A source and target with no conversion between them MUST halt with RILL-R036. `5 -> list` halts.

r[conversion.no-string-form] A function or an iterator has no string form
`v -> string` for a function or an iterator MUST halt with RILL-R036, and so MUST interpolating
one (`interpolation.printed`).

r[conversion.value-fail] A string that is not a number halts with a value error
`"abc" -> number` MUST halt with RILL-R038. The scalar files state the other value failures.

r[conversion.any] A pipe into any halts
`value -> any` MUST halt with RILL-R036.

r[conversion.variable] A pipe into a variable that holds a type converts as that type does
`v -> $T` MUST yield what `v -> T` yields, and halt as it halts, for the type `T` that `$T` holds.

r[conversion.deep] Conversion converts each part of a parameterized target {pending #566}
A conversion MUST convert each element, field, and position of a parameterized target by the same
rule it applies at the top level. `list[1, 2] -> list(string)` ⇒ `list["1", "2"]`.

r[conversion.failure] An inner failure reports a conversion error {pending #566}
A part that cannot convert MUST halt with RILL-R036 or RILL-R038, never as a failed assertion.
The message MUST name the element or field.

r[conversion.union] A value that has a member passes unchanged {pending #574}
A pipe into a union MUST return a value that already has a member unchanged, and the value MUST
carry the union as its asserted type. `"5" -> union(number, string)` ⇒ `"5"`.

r[conversion.union-miss] A value with no member halts {pending #574}
A value with no member of the union MUST halt with RILL-R036, never `#TYPE_MISMATCH`. Members
MUST NOT be tried in turn.

## Interactions

r[conversion.scalar] Scalar routes belong to the scalar types
The routes into `number`, `string`, `bool`, and `atom` MUST be those stated by `number.from-string`,
`number.from-bool`, `string.from-number`, `string.from-bool`, `string.from-collection`,
`bool.from-number`, `bool.from-string`, `atom.from-string`, and `atom.to-string`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| No conversion exists between the source and the target | RILL-R036 | Yes |
| `dict` converts to `ordered` with no signature | RILL-R037 | Yes |
| A string that is not a number is converted to number | RILL-R038 | Yes |
| The value omits a field or position with no default | RILL-R044 | Yes |
| A part of a parameterized target fails to convert {pending #566} | RILL-R036, RILL-R038 | Yes |

## Examples

```rill
"5" -> number
# Result: 5
```

```rill
dict[a: 1, b: 2] -> dict(a: number)
# Result: dict[a: 1]
```

```rill
list[1, 2] -> tuple(number, number)
# Result: tuple[1, 2]
```

```rill
dict(a: number, b: number = 5) => $T
dict[a: 1, c: 2] -> $T
# Result: dict[a: 1, b: 5]
```

```rill
# Error: cannot convert iterator to string
range(0, 3) -> string
```

```rill pending=566
list[1, 2] -> list(string)
# Result: list["1", "2"]
```

```rill pending=574
5 -> union(number, string) => $v
$v.^type -> .signature
# Result: "union(number, string)"
```

## Notes

Until #566 is built, a pipe into a parameterized type converts the outer kind and asserts the inner
types, so `list[1, 2] -> list(string)` halts `#TYPE_MISMATCH`. Until #574 is built, a pipe into a
union halts RILL-R036.

On 0.23.0 a conversion through a variable skips fill and drop, and does not check field types.

`conversion.variable-call` is superseded by `pipe.function`.

The instance methods `.str` and `.num` are removed, so `-> string` and `-> number` are the only
conversions of a scalar.
