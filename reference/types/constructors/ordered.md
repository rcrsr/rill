---
id: ordered
title: Ordered types
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P006, RILL-P012, TYPE_MISMATCH]
depends: [type-value, type-form, dict]
tests: [uniform-value-type.test.ts, structural-type-identity.test.ts, structural-type-boundaries.test.ts, structural-type-defaults.test.ts, type-inner-outer.test.ts, unspecified-type-args.test.ts, type-form-outer.test.ts, type-field-keys.test.ts]
---

# Ordered types

An ordered type describes a keyed collection whose fields keep their written order, with one type per named field.

## Syntax

```text
ordered                          any ordered
ordered(a: number, b: string)    one type per named field
```

r[ordered.fields] An ordered type always names its fields
Every argument of an ordered type MUST carry a field name.

r[ordered.no-uniform] An ordered type has no uniform form
`ordered(V)` MUST be rejected with RILL-P012, and the message MUST name `map(string, V)`.

r[ordered.empty-parens] ordered and ordered() are one type
`ordered` and `ordered()` MUST compare equal.

## Static rules

r[ordered.no-outer] An ordered type takes no outer
An ordered type written with an outer, such as `ordered(a: number):string`, MUST be a parse error.

r[ordered.key-spelling] An ordered type accepts every key spelling a literal accepts
A named field MUST be written as `dict.key-spelling` states, and a signature prints keys as
`dict.key-print` states.

## Evaluation

r[ordered.order] Field order is part of an ordered type
`ordered(a: number, b: string)` MUST NOT equal `ordered(b: string, a: number)`.

r[ordered.not-dict] An ordered value does not have a dict type
`ordered[a: 1] -> :?dict(a: number)` MUST yield false, and a dict value MUST NOT have an
ordered type.

r[ordered.field-inner] An ordered type's inner is its fields
`.inner` MUST return an ordered value of field types.

r[ordered.field-print] An ordered type prints its fields
An ordered type MUST print as `ordered(a: T, ...)`.

## Interactions

An unknown type name as an argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`. Which ordered values have a named
ordered type, field order included, follows `structural-typing.exact-position`, and the bare
`ordered` follows `structural-typing.bare-ordered`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Outer on a type that takes none | RILL-P006 | No |
| An argument with no field name, as in `ordered(V)` | RILL-P012 | No |
| Value has a field a named form does not name (`structural-typing.exact-position`) | `#TYPE_MISMATCH` | Yes |

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

```rill
# Error: RILL-P012
ordered(number)
```

```rill
ordered("a b": number) == ordered["a b": 1].^type
# Result: true
```

## Notes

The 0.23.0 runtime accepts the uniform form: `ordered(number)` is a type, `ordered[a: 1] -> :?ordered(number)`
is true, `.inner` of `ordered(T)` is `T`, and mixing named and unnamed arguments halts
`#INVALID_INPUT`. The form now halts RILL-P012, and a script rewrites `ordered(V)` to `map(string, V)`,
which keeps insertion order.

Superseded rule ids: `ordered.any`, `ordered.argument-naming`, `ordered.field-naming`, `ordered.forms`, `ordered.mixed`, `ordered.uniform-count`,
`ordered.value-type`, `ordered.uniform-membership`, `ordered.uniform-inequality`,
`ordered.inner`, `ordered.print`, `ordered.unspecified`, `ordered.exact`.

Converting a dict to the uniform form, `dict[a: 3] -> ordered(number)`, halts RILL-R037 on
0.23.0 builds; the named form `ordered(a: number)` converts.
