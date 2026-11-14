---
id: type-value
title: Type values
status: normative
since: 0.24.0
issues: [571]
grammar: []
errors: [RILL-R005, TYPE_MISMATCH]
depends: [notation, halt, type-form, type-position]
tests: [type-values.test.ts, type-var-positions.test.ts, type-ref-arg-unification.test.ts]
---

# Type values

A type value is a value that describes a set of values; every type form evaluates to one. The `type-form` concept states how a type is written.

## Evaluation

r[type-value.expression] A type name or constructor evaluates to a type value
Evaluating `number` or `list(string)` as an expression MUST yield a type value.

r[type-value.first-class] A type value is captured, stored, and passed like any value
A type value MUST be capturable into a variable, storable in a list or dict, and passable as
an argument.

r[type-value.metatype] The type of a type value is type
`.^type` of any type value, including `type` itself, MUST equal `type`.

r[type-value.equality] Two type values compare equal when each accepts the other
`==` between two type values MUST yield true exactly when every value that has one type also
has the other (`structural-typing.equal`).

r[type-value.contexts] A type form yields one type value in every position
A type form MUST yield the same type value whether it sits in a type position or evaluates
as an expression. `dict(b: number = 5)` describes one type in both places.

r[type-value.variable] A variable holding a type stands in a type position
A `$` variable that holds a type value MUST be accepted in every type position
(`type-position.variable`) and MUST stand for the type it holds.

r[type-value.variable-halt] A non-type variable in a type position halts
A `$` variable in a type position that holds a value that is not a type MUST halt with
`#TYPE_MISMATCH`, for both `:` and `:?`. The rule holds in constructor arguments, so `list($n)`
halts when `$n` holds `5`.

r[type-value.variable-undefined] An undefined variable in a type position halts
A `$` variable in a type position that was never captured MUST halt with RILL-R005.

r[type-value.argument-resolve] A variable argument resolves when the constructor evaluates
A `$` variable inside a constructor argument list MUST stand for the type it holds, at any
nesting depth. `list($t)` with `$t` holding `number` MUST equal `list(number)`.

r[type-value.resolve-early] An annotation resolves when it is created
A parameter annotated with a type variable MUST hold the type the variable had when the
function was created. A later capture into the variable MUST NOT change what the function
accepts.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A `$` variable in a type position holds a non-type | `#TYPE_MISMATCH` | Yes |
| A `$` variable in a type position is undefined | RILL-R005 | Yes |

## Examples

```rill
list(number) => $t
dict[item: $t, count: number] => $d
$d.item == list(number)
# Result: true
```

```rill
number => $t
$t.^type == type
# Result: true
```

```rill
number => $t
list($t) == list(number)
# Result: true
```

```rill
string => $t
"a" -> :$t
# Result: "a"
```

```rill
# Error: #TYPE_MISMATCH
5 => $n
list($n)
```

```rill pending=571
number => $t
fn(x: $t):any { $x } => $f
string => $t
$f(5)
# Result: 5
```

## Notes

The static checker treats an annotation written as a variable as `any`, so a script that uses
type variables gets no static check on those annotations.

A pipe into a variable converts when the variable holds a type and calls when it holds a
function; the line does not show which.
