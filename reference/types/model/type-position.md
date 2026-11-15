---
id: type-position
title: Type positions
status: normative
since: 0.24.0
grammar: []
errors: []
depends: [type-form]
tests: [type-var-positions.test.ts]
---

# Type positions

A type position is a place in source text where a type form is written instead of a value.

## Static rules

r[type-position.assertion] An assertion or check colon is followed by a type
The text after `:` in `value -> :T` and after `:?` in `value -> :?T` MUST be a type position.

r[type-position.capture] A capture colon is followed by a type
The text after the colon in `value => $x:T` MUST be a type position.

r[type-position.parameter] A parameter type is a type position
The type written for a parameter MUST be a type position.

r[type-position.inner] An inner is made of type positions
Each argument inside a constructor's inner MUST be a type position, except a literal union
member, which `union` states.

r[type-position.conversion] A conversion target is a type position
The target of a pipe that converts, `value -> T`, MUST be a type position.

r[type-position.variable] A type variable may stand in any type position
A `$` variable MAY be written in any type position in place of a type form. The
`type-value` concept states how it resolves: `type-value.variable` and
`type-value.variable-halt`.

## Interactions

A union can be written in every type position (`union.position`). A type form
written outside a type position evaluates as an expression and yields a type value
(`type-value.expression`).

## Examples

```rill
number => $t
5 -> :$t
# Result: 5
```

```rill
list[1, 2] -> :?list(number)
# Result: true
```
