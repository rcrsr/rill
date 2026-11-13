---
id: list
title: List types
status: normative
since: 0.24.0
issues: [571]
grammar: [type-constructor]
errors: [INVALID_INPUT]
depends: [type-value, type-form]
tests: [structural-type-identity.test.ts, structural-type-boundaries.test.ts, type-inner-outer.test.ts, type-assertions.test.ts]
---

# List types

A list type describes a sequence in which every element has one element type.

## Syntax

```ebnf
type-constructor = ( "list" | "dict" | "tuple" | "ordered" ) , "(" , [ field-arg-list ] , ")"
                 | union-type
                 | "stream" , "(" , [ field-arg-list ] , ")" , [ ":" , type-ref ] ;
```

r[list.form] A list type is the name alone or the name with one type
A list type MUST be written `list` or `list(T)`.

r[list.argument] The argument is one unnamed type
`list(T)` MUST take exactly one unnamed argument. `T` MUST be a type name, a parameterized
type, a union, or a variable holding a type.

r[list.argument-count] A wrong argument count halts
`list(number, string)` and a named argument such as `list(a: number)` MUST halt with
`#INVALID_INPUT`.

## Static rules

r[list.no-outer] A list type takes no outer {pending #571}
A list type written with an outer, such as `list(number):string`, MUST be a parse error.

r[list.unspecified] list, list(), and list(any) are one type {pending #571}
`list()` MUST be accepted. `list`, `list()`, and `list(any)` MUST compare equal.

## Evaluation

r[list.membership] A list has list(T) when every element has T
A list value MUST have `list(T)` when each of its elements has `T`. The empty list MUST have
`list(T)` for every `T`.

r[list.equality] List types are equal when their element types are equal
`list(number)` MUST equal `list(number)` and MUST NOT equal `list(string)`. Nested list types
compare by their element types.

r[list.element-union] A union element type admits each member
`list(union(number, string))` MUST accept a list whose elements each have a member of the union.

r[list.inner] A list type's inner is its element type
`.inner` MUST return `T` for `list(T)`.

r[list.print] A list type prints its element type
`list(T)` MUST print as `list(T)` with `T` in printed form. `inference.empty` states the type of
an empty list.

## Interactions

An unknown type name as the argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| More or fewer than one argument, or a named argument | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[1, 2].^type == list(number)
# Result: true
```

```rill
list[] -> :?list(string)
# Result: true
```

```rill
list(list(string)).inner == list(string)
# Result: true
```

```rill pending=571
list() == list(any)
# Result: true
```

## Notes

Literal `list[1, "a"]` halts RILL-R002 on 0.23.0 builds, and a list of lists with different
element kinds infers the bare `list(list)`. The decided 0.24.0 inference gives both a union
element type, `list(union(number, string))`, and is not built yet. `list(stream(number):string)`
halts RILL-P014 until a type with an outer nests inside another type.

`list(number):string` parses today as an assertion of the type value against `string` and halts
`#TYPE_MISMATCH` at run time.
