---
id: defaults
title: Defaults in types
status: normative
since: 0.24.0
issues: [623, 624]
grammar: [field-arg-list, field-arg]
errors: [RILL-P001, RILL-P014, RILL-R044, TYPE_MISMATCH, INVALID_INPUT]
depends: [type-value, structural-typing, union, tuple, dict, ordered, fn]
tests: [structural-type-defaults.test.ts, closure-annotation-defaults.test.ts, collection-type-defaults-bugs.test.ts, no-implied-dollar.test.ts, pipe-targets.test.ts, functions.test.ts, closure-semantics.test.ts]
---

# Defaults in types

A default is a literal written after a field or parameter type that states the value an omitted field or argument takes.

## Syntax

```ebnf
field-arg-list   = field-arg , { "," , field-arg } , [ "," ] ;
field-arg        = [ annotation ] , field-key , ":" , type-ref , [ "=" , literal ]
                 | [ annotation ] , type-ref , [ "=" , literal ] ;
```

r[defaults.param-form] A parameter default follows the parameter type in an fn type {pending #623}
An `fn` type MUST accept `= literal` after a parameter type, as in `fn(x: number = 3):string { $x -> string }`.

r[defaults.literal] A default is a literal, never an expression
A default MUST be a string, number, bool, atom, or a list, dict, tuple, or ordered literal.

r[defaults.negative] A negative number is a literal default
A default MUST accept a negative number, as in `b: number = -5`.

r[defaults.non-literal] A default that is not a literal is rejected
A variable reference, call, or parenthesized expression after `=` MUST raise RILL-P001.

r[defaults.operator] An operator after a literal default is rejected
An operator after a literal default in a type argument list MUST raise RILL-P014.

## Static rules

r[defaults.tuple-trailing] A tuple default is trailing
In a tuple type, every position after a defaulted position MUST also carry a default.
Otherwise constructing the type MUST halt with `#INVALID_INPUT`.

r[defaults.type-match] A default has the type of its field
A default whose value does not match its field type MUST halt with `#TYPE_MISMATCH` when the type is
constructed.

## Evaluation

r[defaults.fill] A conversion fills an omitted field
A conversion MUST fill a field or position the value omits with the default the target type
declares. A field the value holds MUST keep its value. An assertion fills nothing, as
`assertion.unchanged` states.

r[defaults.required] An omitted field without a default halts the conversion
A conversion MUST raise RILL-R044 when the value omits a field or position that has no default.
The message names the field or position.

r[defaults.synthesis] A collection field whose children all default is synthesized
A conversion MUST synthesize an omitted collection field that declares no default of its own when
every field of its type has a default.

r[defaults.nested] An explicit collection default is hydrated through its type
A conversion MUST fill the fields that an explicit collection default omits, using the defaults of
the field's type.

r[defaults.hydrated-type] A hydrated value infers its own type without defaults
The type a conversion's result infers MUST name every field the result holds and MUST NOT carry
defaults.

r[defaults.param] A parameter default fills an omitted argument
A call that omits an argument for a parameter with a default MUST bind the default.

r[defaults.param-required] An omitted argument without a default halts
A call that omits an argument for a parameter without a default MUST raise RILL-R044.

r[defaults.arg-hydrate] A call hydrates a collection argument
A call MUST fill the defaulted fields a collection argument omits, using the parameter type.

r[defaults.hydration-union] Hydration picks the narrowest accepting member
A value hydrated against a union MUST take the defaults of the narrowest member that accepts it,
whatever the order the members were written in.

r[defaults.hydration-tie] Members of equal width tie on canonical order
When no accepting member is narrower than the others, hydration MUST choose the first of them in
canonical order.

## Interactions

r[defaults.equality] Type equality compares defaults
Two types that differ only by a present or absent default MUST compare unequal.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A token that is not a literal follows `=` | RILL-P001 | No |
| An operator follows a literal default in a type argument list | RILL-P014 | No |
| A default does not match its field type | `#TYPE_MISMATCH` | Yes |
| A tuple default is followed by a position without one | `#INVALID_INPUT` | Yes |
| A conversion omits a field or position with no default | RILL-R044 | Yes |
| A call omits an argument for a parameter with no default | RILL-R044 | No |

## Examples

```rill
dict[a: 1] -> dict(a: number, b: number = 5)
# Result: dict[a: 1, b: 5]
```

```rill
dict[a: 1] -> :dict(a: number, b: number = 5)
# Result: dict[a: 1]
```

```rill
dict(a: number = 1) == dict(a: number)
# Result: false
```

```rill
dict[x: dict[a: 1]] -> dict(x: union(dict(a: number), dict(a: number, b: number = 9)))
# Result: dict[x: dict[a: 1, b: 9]]
```

```rill pending=624
fn(x: dict(a: number, b: number = 4)) { $x.b } => $f
dict[a: 1] -> $f()
# Result: 4
```

## Notes

Defaults live in the type, so changing one changes the type. Reading a default from a type value is
stated by `introspection`. The `|x: number = 3|` closure parameter form is removed in 0.24.0 and
replaced by the `fn` form.

On 0.23.0 a call with no arguments where `$` is bound received `$` as its first argument.

Superseded: `defaults.fn-match`. A function has a function type only when its defaults equal the
type's (`structural-typing.function`, `fn.equality`). On 0.23.0 a function whose parameters declare
defaults satisfies a type that omits them.