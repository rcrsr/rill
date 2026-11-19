---
id: structural-typing
title: Structural typing
status: normative
since: 0.24.0
issues: [623]
errors: [TYPE_MISMATCH]
depends: [type-value, any, list, dict, tuple, ordered, union]
tests: [equality-gate.test.ts, structural-type-identity.test.ts, structural-type-boundaries.test.ts, structural-type-errors.test.ts, structural-type-defaults.test.ts, type-field-keys.test.ts]
---

# Structural typing

A value has a type by its structure, never by a type name, and four relations (has, accepts, equals, overlaps) define every type check.

## Static rules

r[structural-typing.structural] A type is judged by structure, never by name
Two types with the same structure MUST be the same type. No construct MUST declare a type
name that a value matches by that name.

## Evaluation

r[structural-typing.has] A value has a type when it is a member of the type
A scalar MUST have the type of its kind. A list MUST have `list(T)` when every element has
`T`. A value MUST have a union when it has one member.

r[structural-typing.accepts] A type accepts another when every value of it has the first
`T` accepts `U` when every value that has `U` also has `T`. Reducing a union MUST drop a
member that another member accepts, so `union(list, list(number))` reduces to `list`.

r[structural-typing.equal] Two types are equal when each accepts the other
Two types MUST be equal exactly when each accepts the other.

r[structural-typing.equal-order] Dict types ignore field order
`dict(a: number, b: string)` MUST equal `dict(b: string, a: number)`.

r[structural-typing.empty] An empty collection has every type of its kind
`list[]` MUST have `list(T)` for every `T`. `inference.empty` states its own type.

### Membership

r[structural-typing.exact-position] Tuple and ordered membership is exact
A `tuple` value MUST have a positional `tuple` type only when it has no position the type
omits, and none missing unless the type defaults it. An `ordered` value MUST have a named
`ordered` type only when it holds no field the type omits, and none missing unless the type
defaults it. An `ordered` value MUST also match the field order of the type.

r[structural-typing.exact-dict] A dict has a field-naming type only without other fields
A `dict` value MUST NOT have a type that names fields when the value holds a field the type
does not name, so `dict[a: 1, b: 2] -> :dict(a: number)` MUST halt with `#TYPE_MISMATCH`. The
bare `dict` follows `structural-typing.bare-dict`. A value with an extra field is converted
first; conversion drops the extra field.

r[structural-typing.missing] A missing field without a default fails membership
A `dict` value that lacks a field the type names, and the type gives that field no default,
MUST NOT have the type.

r[structural-typing.defaulted] A defaulted field may be absent
A `dict` value MUST have a type when it omits a field that has a default. The `assertion`
concept states that the assertion fills nothing.

r[structural-typing.present-typed] A present defaulted field matches its field type
A `dict` value that holds a field the type defaults MUST have the type only when the field
matches the field type.

r[structural-typing.bare-dict] A bare dict type admits every dict
A bare `dict` MUST admit every dict.

r[structural-typing.bare-ordered] A bare ordered type admits every ordered
A bare `ordered` MUST admit every ordered value.

r[structural-typing.function] A function has a function type only when its own type equals it {pending #623}
A function value MUST have a function type only when its own type equals that type.

### Overlap

r[structural-typing.overlap-scalar] Two scalar types overlap when they are the same kind
`number` MUST overlap `number` and MUST NOT overlap `string`.

r[structural-typing.overlap-literal] Two literal types overlap only when they are equal
A literal type, such as `"a"`, `1`, or `#wired`, MUST overlap another literal type only when both
hold equal values. `"a"` and `"b"` MUST NOT overlap, and a literal MUST overlap its scalar kind.

r[structural-typing.overlap-list] Two list types overlap when their element types overlap
`list(number)` and `list(string)` MUST NOT overlap. The type of `list[]` leaves its element
unspecified, so `list[]` MUST overlap `list["a"]`.

r[structural-typing.overlap-kind] Types of different kinds do not overlap
`tuple[1]` and `list[1]` MUST NOT overlap, because their values have different kinds.

r[structural-typing.overlap-fields] Types with named fields overlap when shared fields do
Two types with named fields MUST overlap when every shared field overlaps and every field
named by only one has a default.

r[structural-typing.overlap-union] A union overlaps a type when one member does
A union MUST overlap a type when at least one member overlaps it. `any` MUST overlap every type.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A value does not have the asserted type | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
dict[b: 1] -> :dict(a: number = 0, b: number)
# Result: dict[b: 1]
```

```rill
dict(a: number, b: string) == dict(b: string, a: number)
# Result: true
```

```rill
ordered(a: number, b: string) == ordered(b: string, a: number)
# Result: false
```

```rill
dict[a: 1, x: 2] -> :?dict(a: number)
# Result: false
```

```rill
# Error: #TYPE_MISMATCH
dict[a: 1, b: 2] -> :dict(a: number)
```

## Notes

Value `==` between operands whose types do not overlap halts; the `equality` concept states
that rule on top of the overlap relation.

On 0.23.0 a dict with extra fields has a field-naming type, and the assertion returns the
value with the extra fields kept.

Two identical structures with different meanings, such as a Celsius and a Fahrenheit
temperature, are the same type.
