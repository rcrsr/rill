---
id: carried-type
title: Carried types
status: normative
since: 0.24.0
issues: [560, 628]
grammar: []
errors: [RILL-P001]
depends: [type-value, structural-typing, any, union, inference, assertion]
tests: [declared-types.test.ts, type-assertions.test.ts, capture-types.test.ts]
---

# Carried types

A value carries the type a `:T` assertion labeled it with, its asserted type, or the type a `declaration` set, its declared type; this concept states how that carried type travels, is replaced, and is reported.

## Static rules

r[carried-type.reserved-key] The annotation key effective is reserved
`^(effective: ...)` MUST raise RILL-P001 on a capture and on a closure, because `effective`
names the `.^effective` probe.

## Evaluation

r[carried-type.carriage] A carried type follows the value
An asserted type MUST follow its value through the pipe value `$`, a plain capture, a grouped
expression, and `pass`.

r[carried-type.carriage-param] A carried type follows the value into a parameter
A parameter that receives a value by call or by pipe MUST receive the carried type with it.

r[carried-type.carriage-declared] A declared type follows the value like an asserted type {pending #628}
A declared type MUST follow its value through the same paths as an asserted type, and a later
assertion or declaration MUST replace it.

r[carried-type.declared-probe] The type probe reports a declared type {pending #628}
`.^type` MUST report a declared type the value carries, and `.^effective` MUST ignore it.

r[carried-type.replace] A new assertion replaces the type
A later assertion, except `:any` (`assertion.any`), MUST replace the carried type. An
assertion narrows the carried type: a value carrying `union(string, number)` that passes
`-> :number` carries `number`.

r[carried-type.computed] A computed result takes its own type
The result of an operator other than `??`, a method, call, conditional, loop, `guard`, `retry`,
or block MUST take its own type and MUST NOT inherit the carried type of its operands.

r[carried-type.fallback] A fallback keeps the selected operand's type
`a ?? b` MUST yield the operand it selects with that operand's carried type. With `$x` carrying
`union(string, number)` and holding 42, `($x ?? 1).^type` is `union(number, string)`.

r[carried-type.element] An element of a labeled collection carries the collection's part
Reading an element or field from a collection with an asserted type MUST give the element the
asserted element or field type. This holds for `[i]`, `.name`, `.$k`, and iteration.

r[carried-type.collection-element] An element of an inferred collection carries its element type {pending #560}
Reading an element from a collection with no carried type MUST give the element the collection's
inferred element type. An element of `list[1, "a"]` carries `union(number, string)`, so `.^type`
reports the union and `$ == "a"` compares without halting.

r[carried-type.type-probe] The type probe reports the carried type
`.^type` MUST report the most recent carried type the value has, and its own type when it
carries none.

r[carried-type.effective-probe] The effective probe reports the own type
`.^effective` MUST report the type of the value itself and ignore any carried type. With no
carried type, `.^type` and `.^effective` MUST agree.

r[carried-type.equality] A carried type does not change equality
Two values with equal contents MUST compare equal whatever types they carry, whenever the
comparison completes.

## Interactions

A capture locks to the carried type, as `type-lock.asserted` states. A pipe into a union sets
the carried type, as `conversion.union` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `^(effective: ...)` is written | RILL-P001 | No |

## Examples

```rill
42 => $x:union(string, number)
$x.^type -> .signature
# Result: "union(number, string)"
```

```rill
42 => $x:union(string, number)
$x.^effective -> .signature
# Result: "number"
```

```rill
42 -> :union(string, number) -> (1 + 1) -> .^type -> .signature
# Result: "number"
```

```rill
list[1, 2] => $l:list(union(number, string))
$l[0] -> .^type -> .signature
# Result: "union(number, string)"
```

## Notes

Superseded: `carried-type.inferred-element`, now `carried-type.collection-element`. On 0.23.0 an
element read from an inferred collection carries its own type.

A host reads the own type through the host boundary, never the carried type.

Before 0.24.0, `.^type` read the own type. Scripts that dispatch on `$v.^type.name` read
`$v.^effective.name` instead.
