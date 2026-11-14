---
id: ordered
title: Ordered types
status: normative
since: 0.24.0
issues: [581, 600, 622]
grammar: []
errors: []
depends: [type-value, type-form, dict]
tests: [structural-type-identity.test.ts, structural-type-boundaries.test.ts, structural-type-defaults.test.ts, type-inner-outer.test.ts]
---

# Ordered types

An ordered type describes a keyed collection whose fields keep their written order, with one type per named field.

## Syntax

```text
ordered                          any ordered
ordered(a: number, b: string)    one type per named field
```

r[ordered.any] The bare ordered accepts every ordered value
The bare `ordered` MUST accept every ordered value.

r[ordered.fields] An ordered type always names its fields {pending #600}
Every argument of an ordered type MUST carry a field name.

r[ordered.no-uniform] An ordered type has no uniform form {pending #600}
The parse error for `ordered(V)` MUST name `map(string, V)`.

r[ordered.empty-parens] ordered and ordered() are one type {pending #622}
`ordered` and `ordered()` MUST compare equal.

## Static rules

r[ordered.no-outer] An ordered type takes no outer {pending #622}
An ordered type written with an outer, such as `ordered(a: number):string`, MUST be a parse error.

r[ordered.key-spelling] An ordered type accepts every key spelling a literal accepts {pending #581}
A named field MUST be written as an identifier, a quoted string, a number, or a bool. The key
is a string in each case, and a signature MUST print an identifier bare and any other key
quoted.

## Evaluation

r[ordered.order] Field order is part of an ordered type
`ordered(a: number, b: string)` MUST NOT equal `ordered(b: string, a: number)`. An ordered
value MUST have a named form only when its fields appear in the order the type lists them.

r[ordered.exact] A named form accepts no field it does not name
An ordered value with a field the named form omits MUST NOT have the type. A field with a
default MAY be absent.

r[ordered.not-dict] An ordered value does not have a dict type
`ordered[a: 1] -> :?dict(a: number)` MUST yield false, and a dict value MUST NOT have an
ordered type.

r[ordered.field-inner] An ordered type's inner is its fields
`.inner` MUST return an ordered value of field types.

r[ordered.field-print] An ordered type prints its fields
An ordered type MUST print as `ordered(a: T, ...)`.

## Interactions

An unknown type name as an argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`.

## Examples

```rill
ordered[a: 1, b: "x"].^type == ordered(a: number, b: string)
# Result: true
```

```rill
ordered(a: number, b: string) == ordered(b: string, a: number)
# Result: false
```

```rill
ordered[a: 1, b: 2] -> :?ordered
# Result: true
```

```rill pending=600
# Error: parse error naming map(string, number)
ordered(number)
```

```rill pending=581
ordered("a b": number) == ordered["a b": 1].^type
# Result: true
```

## Notes

The 0.23.0 runtime accepts the uniform form: `ordered(number)` is a type, `ordered[a: 1] -> :?ordered(number)`
is true, `.inner` of `ordered(T)` is `T`, and mixing named and unnamed arguments halts
`#INVALID_INPUT`. #600 removes it, and a script rewrites `ordered(V)` to `map(string, V)`,
which keeps insertion order.

Superseded rule ids: `ordered.argument-naming`, `ordered.field-naming`, `ordered.forms`, `ordered.mixed`, `ordered.uniform-count`,
`ordered.value-type`, `ordered.uniform-membership`, `ordered.uniform-inequality`,
`ordered.inner`, `ordered.print`, `ordered.unspecified`.

Converting a dict to the uniform form, `dict[a: 3] -> ordered(number)`, halts RILL-R037 on
0.23.0 builds; the named form `ordered(a: number)` converts.

`ordered(a: number):string` parses today as an assertion of the type value against `string` and halts
`#TYPE_MISMATCH` at run time.
