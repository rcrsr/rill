---
id: assertion
title: Type assertions and checks
status: normative
since: 0.24.0
issues: []
grammar: [postfix-type-op, type-assertion, type-check, type-target]
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [type-value, type-form, structural-typing, any]
tests: [type-assertions.test.ts, structural-type-errors.test.ts, declared-types.test.ts, map-membership.test.ts]
---

# Type assertions and checks

An assertion, `value -> :T`, checks that a value already has type `T` and never changes the value. A passing assertion labels the value with `T`, its asserted type; a check, `:?T`, returns the test result as a bool.

## Syntax

```ebnf
postfix-type-op = type-assertion | type-check ;
type-assertion = ":" , type-target ;
type-check    = ":" , "?" , type-target ;
type-target   = type-ref ;
```

r[assertion.position] An assertion follows an expression
A `:T` or `:?T` MUST be accepted after a primary or any postfix operator.

r[assertion.pipe-target] An assertion is a pipe target
`-> :T` and `-> :?T` MUST be accepted, and a pipe target MUST test the piped value.

r[assertion.binding] A postfix assertion binds tighter than a method call
In `"abc":string.len`, the assertion MUST apply to `"abc"` and `.len` MUST apply to the result.
In `"abc":number.len`, the assertion MUST halt before `.len` runs.

## Evaluation

r[assertion.pass] A passing assertion returns the value unchanged
`:T` MUST return its operand when the operand has type `T`.

r[assertion.unchanged] An assertion leaves the value unchanged
`:T` MUST yield its operand unchanged: no field is added, dropped, or filled.

r[assertion.mismatch] A failing assertion halts
`:T` MUST halt with `#TYPE_MISMATCH` when the operand does not have `T`. The message names
the expected type and the type of the value.

r[assertion.check] A check returns a bool and never halts on a mismatch
`:?T` MUST return `true` when the operand has `T` and `false` otherwise.

r[assertion.membership] The test is membership under structural typing
`:T` and `:?T` MUST test the has relation of `structural-typing`. An empty list has `list(T)`
for every `T`, so `list[] -> :?list(string)` is `true`.

r[assertion.deep] A parameterized type checks every element and field
`list(T)` MUST check each element, `map(K, V)` MUST check each key against `K` and each value
against `V`, and a field-naming `dict`, `ordered`, or `tuple` type MUST
check each named field or position, to any depth.

r[assertion.once] The operand evaluates once
A postfix `:T` or `:?T` MUST evaluate its operand exactly once.

r[assertion.label] A passing assertion sets the asserted type
A `:T` assertion, a capture annotation, and a parameter type MUST each label the value they
check with `T` as its asserted type, except where `T` is `any`.

r[assertion.short-form] A capture annotation is an assertion followed by a capture
When the check passes, `value => $x:T` MUST yield the same value and asserted type as
`value -> :T => $x`.

r[assertion.any] The any type sets no label
`:any` MUST NOT set an asserted type. `1 => $x:any` carries `number`, and `:any` on a value that
carries a type MUST leave it unchanged.

r[assertion.bare-kind] A bare kind annotation labels the kind
`:list` and `:dict` MUST set the bare kind as the asserted type.

r[assertion.bare-fn] The bare fn annotation labels the kind
`:fn` MUST set the bare kind `fn`, as `:list` sets `list`.

## Interactions

r[assertion.variable] A variable that holds a type is a target
`:$t` and `:?$t` MUST test against the type `$t` holds. `type-value.variable-halt` states the
halt for a variable that holds a non-type, and `type-form.unknown-name` states the parse error
for an unknown name after the colon.

r[assertion.leaf-args] A leaf type takes no arguments
A leaf type written with arguments, such as `string(number)`, MUST halt with `#INVALID_INPUT`,
in `:T` and in `:?T`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The operand does not have the type in `:T` | `#TYPE_MISMATCH` | Yes |
| A leaf type carries arguments | `#INVALID_INPUT` | Yes |

## Examples

```rill
# Error: type assertion fails
"5" -> :number
```

```rill
"abc":string.len
# Result: 3
```

```rill
list[1, 2] -> :list => $x
$x.^type.signature
# Result: "list"
```

```rill
# Error: #TYPE_MISMATCH
dict[a: 1, b: 2] -> :dict(a: number)
```

```rill
dict[a: 1] -> :dict(a: number, b: number = 0)
# Result: dict[a: 1]
```

## Notes

How the asserted type travels is stated by `carried-type`.

The annotation `:closure` is removed and raises RILL-P012 naming `fn`; write `:fn`.

A `|` between types after the colon is removed in 0.24.0 and raises RILL-P011; write
`:union(...)`.
