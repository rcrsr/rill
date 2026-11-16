---
id: dict
title: Dict types
status: normative
since: 0.24.0
issues: [563, 572, 576, 581, 600]
grammar: []
errors: [RILL-P006, RILL-P027, TYPE_MISMATCH]
depends: [type-value, type-form]
tests: [structural-type-identity.test.ts, structural-type-boundaries.test.ts, type-inner-outer.test.ts, type-assertions.test.ts, unspecified-type-args.test.ts, type-form-outer.test.ts]
---

# Dict types

A dict type describes a dict by its named fields, one type per field.

## Syntax

```text
dict                          any dict
dict(a: number, b: string)    one type per named field
```

r[dict.field-default] A named field MAY carry a default
A named field MAY carry a default, as in `dict(a: number = 1)`.

r[dict.field-type] A field type is any type
A field type MUST be any type, and a dict type MAY nest, as in `dict(a: list(number))`.

r[dict.any] The bare dict accepts every dict
The bare `dict` MUST accept every dict.

r[dict.fields] A dict type always names its fields {pending #600}
Every argument of a dict type MUST carry a field name.

r[dict.no-uniform] A dict type has no uniform form {pending #600}
The parse error for `dict(V)` MUST name `map(string, V)`.

r[dict.empty-parens] dict and dict() are one type
`dict` and `dict()` MUST compare equal.

## Static rules

r[dict.no-outer] A dict type takes no outer
A dict type written with an outer, such as `dict(a: number):string`, MUST be a parse error.

r[dict.key-string] A dict key is always a string {pending #576}
A key written as a number or a bool MUST be the string of its spelling, so `dict[1: "n"]`
equals `dict["1": "n"]`.

r[dict.key-duplicate] A key written twice in one literal is rejected {pending #576}
A literal that spells one key twice, including a number and the string with the same text,
MUST be rejected at parse time with RILL-P027.

r[dict.type-key-duplicate] A type that names one key twice is rejected {pending #581}
A dict or ordered type that names one key twice, in any spelling, MUST be rejected at parse time
with RILL-P027.
`dict("a b": number, "a b": string)` MUST NOT parse.

r[dict.key-spelling] A dict type accepts every key spelling a literal accepts {pending #581}
A named field MUST be written as an identifier, a quoted string, a number, or a bool. The key
is a string in each case.

r[dict.key-print] A printed dict type parses back to an equal type {pending #581}
A signature MUST print an identifier key bare and every other key quoted, as in
`dict("a b": number)`.

## Evaluation

r[dict.named-membership] A named form rejects a field it does not name {pending #572}
`dict[a: 1, b: 2] -> :dict(a: number)` MUST halt with `#TYPE_MISMATCH`. The bare `dict` MUST
still accept the value, because it names no field.

r[dict.field-equality] Dict types are equal when their fields and types are equal
Two dict types MUST be equal when they name the same fields with equal types, in any order.

r[dict.field-inner] A dict type's inner is its fields
`.inner` MUST return a dict of field types.

r[dict.field-print] A dict type prints its fields
A dict type MUST print as `dict(a: T, ...)`.

r[dict.entries-type] A dict's entries are string-keyed tuples {pending #563}
`.entries` on a dict or an ordered whose values have type `V` MUST return
`list(tuple(string, V))`, one `tuple[key, value]` per entry.

## Interactions

An unknown type name as an argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Outer on a type that takes none | RILL-P006 | No |
| Value has a field a named form does not name {pending #572} | `#TYPE_MISMATCH` | Yes |
| A literal spells one key twice {pending #576} | RILL-P027 | No |
| A type names one key twice {pending #581} | RILL-P027 | No |

## Examples

```rill
dict[a: 1, b: 2] -> :?dict
# Result: true
```

```rill pending=600
# Error: parse error naming map(string, number)
dict(number)
```

```rill
dict(a: number, b: string) == dict(b: string, a: number)
# Result: true
```

```rill
dict(a: number, b: string).inner.b == string
# Result: true
```

```rill pending=572
dict[a: 1, b: 2] -> :?dict(a: number)
# Result: false
```

```rill pending=581
dict("a b": number) == dict["a b": 1].^type
# Result: true
```

## Notes

The 0.23.0 runtime accepts the uniform form: `dict(number)` is a type, `dict[a: 1, b: 2] -> :?dict(number)`
is true, `.inner` of `dict(T)` is `T`, and mixing named and unnamed arguments halts
`#INVALID_INPUT`. #600 removes it, and a script rewrites `dict(V)` to `map(string, V)`.

Superseded rule ids: `dict.forms`, `dict.mixed`, `dict.uniform-count`, `dict.value-type`,
`dict.equality`, `dict.inner`, `dict.print`, `dict.unspecified`.

The 0.23.0 runtime keeps a number or bool key as a typed key, so `dict[1: "n"] == dict["1": "n"]`
is false and `.keys` returns `list[1]`. An empty dict infers the unspecified type, as an empty
list does, so `dict[].^type == dict()` is true and its type prints `dict`.
