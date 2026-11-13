---
id: any
title: The any type
status: normative
since: 0.24.0
issues: [571]
grammar: []
errors: []
depends: [type-value]
tests: [type-values.test.ts, type-assertions.test.ts, structural-type-identity.test.ts]
---

# The any type

`any` is the type that every value has, and the type a compound type holds when its inner is unspecified.

## Static rules

r[any.name] any is a type name and a type value
`any` MUST be accepted in every type position and MUST evaluate to a type value.

## Evaluation

r[any.admits] Every value has the type any
Every value MUST have the type `any`, including a block, a type value, and an empty collection.

r[any.assert] Asserting any returns the value unchanged
`:any` on a value MUST return the value unchanged.

r[any.collection] A collection of any admits every collection of its kind
`list(any)` MUST admit every list.

r[any.union] A union containing any reduces to any
A union with `any` among its members MUST reduce to `any`.

r[any.signature] The any type prints as any
`any.signature` MUST be `"any"`.

## Interactions

`introspection.bare` states that a bare compound type holds `any` for every parameter, and
`introspection.leaf` states that `.inner` on `any` halts.

Empty parentheses on a compound type name the unspecified form; see `list.unspecified`,
`dict.empty-parens`, `tuple.unspecified`, `ordered.empty-parens`, and `stream.unspecified`.
`fn()` takes no parameters, and `union()` is rejected.

## Examples

```rill
list[1, 2] -> :?list(any)
# Result: true
```

```rill
union(number, any).signature
# Result: "any"
```

```rill
list.inner == any
# Result: true
```

```rill pending=571
dict() == dict
# Result: true
```

## Notes

The current runtime evaluates `dict()` to a type that does not equal bare `dict`, and `list()`
halts `#INVALID_INPUT`.

`any` is the one spelling for a position that accepts every value.
