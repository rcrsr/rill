---
id: type-form
title: Type forms
status: normative
since: 0.24.0
issues: []
grammar: [type-name, type-ref, type-ref-member]
errors: [RILL-P001, RILL-P003, RILL-P006]
depends: [notation, halt]
tests: [type-var-positions.test.ts, type-ref-arg-unification.test.ts, type-form-outer.test.ts]
---

# Type forms

A type form is the one way a type is written: `name(inner):outer`, where the inner and the outer are optional.

## Syntax

```ebnf
type-name     = "string" | "number" | "bool" | "fn"
              | "list" | "dict" | "tuple" | "ordered" | "map"
              | "vector" | "iterator" | "stream"
              | "datetime" | "duration" | "atom"
              | "error_code"
              | "any" | "type" ;
type-ref          = type-ref-member ;
type-ref-member   = "stream" , [ "(" , [ field-arg-list ] , ")" ] , [ ":" , type-ref ]
                  | fn-type
                  | type-name , [ "(" , [ field-arg-list ] , ")" ]
                  | "$" , identifier
                  | union-type ;
```

r[type-form.uniform] Every type is written name(inner):outer
A type MUST be written in this form:

```text
type-form = type-name , [ "(" , [ inner ] , ")" ] , [ ":" , type-form ] ;
```

## Static rules

r[type-form.name] A bare type name is a type form
A type name alone MUST be accepted as a type form.

r[type-form.slots] Each type defines its own slots
Which of the inner and the outer a type name accepts, what each holds, and what an empty or
omitted slot means MUST be stated by that type's concept.

r[type-form.unknown-name] An unknown type name is a parse error
A name written where a type form is expected that is not a type name MUST raise RILL-P003.
The rule holds inside an inner as well.

r[type-form.argument-literal] An inner holds type forms, not values
A literal or any other non-type expression inside an inner MUST raise RILL-P001, unless the
type's concept admits a literal there.

## Interactions

Where a type form may be written is stated by `type-position`. What it evaluates to,
including a `$` variable written in its place, is stated by `type-value`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A type form names an unknown type | RILL-P003 | No |
| An inner holds a value, not a type form | RILL-P001 | No |
| Outer on a type that takes none | RILL-P006 | No |

## Examples

```rill
# Error: unknown type name
list(unknown_name)
```

## Notes

Until #571 lands, `docs/ref-grammar.ebnf` spells type forms as `type-ref` and
`type-ref-member`, which accept a narrower form and include a `$` variable in the production.
Each type's concept notes how its own spelling differs.

Inside an inner, `name:` starts a named field, so `dict(stream: number)` has a field named
`stream`, not a stream with an outer. A bare stream with an outer inside an inner is written
`stream():number`.
