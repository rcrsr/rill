---
id: fn
title: Function types
status: normative
since: 0.24.0
issues: [571]
grammar: []
errors: []
depends: [type-value, structural-typing]
tests: []
---

# Function types

A function type names the parameters a function takes and the type it yields, and a function value is a function type written in front of a block.

## Syntax

```text
fn-type    = "fn" , [ "(" , [ fn-param , { "," , fn-param } ] , ")" ] , [ ":" , type-form ] ;
fn-param   = identifier , [ ":" , type-form ] , [ "=" , literal ] | type-form ;
fn-literal = fn-type , block ;
```

r[fn.name] fn is the type name of every function {pending #571}
`fn` MUST name the type of every function, script-defined or host-provided.

r[fn.no-closure] The name closure is not accepted in a type position {pending #571}
`closure` in a type position MUST raise a parse error that names `fn`.

r[fn.position] A function type is written in every type position {pending #571}
`fn(...)` MUST be accepted wherever a type is accepted: after an assertion colon, in a capture
annotation, as a parameter type, and as an argument of another type such as
`list(fn(x: string):string)`.

r[fn.bare] The bare fn accepts any function {pending #571}
`fn` with no parentheses MUST accept every function.

r[fn.empty] Empty parentheses mean no parameters {pending #571}
`fn()` MUST name a function that takes no parameters, and it MUST NOT equal `fn`. This is
the exception to the rule that empty parentheses leave a type unspecified.

r[fn.omitted] An omitted parameter type or outer is any {pending #571}
`fn(x)` MUST equal `fn(x: any):any`.

r[fn.named] A named parameter has a name, a type, and an optional default {pending #571}
`fn(x: number = 0)` MUST declare a parameter `x` of type `number` with default `0`. The
default is part of the type.

r[fn.unnamed] An unnamed parameter binds the pipe value {pending #571}
A type name alone in the parentheses, as in `fn(number)`, MUST declare an unnamed parameter.

r[fn.unnamed-limit] A function has at most two unnamed parameters {pending #571}
The first unnamed parameter MUST be read as `$` and the second as `$@`. A third MUST be
rejected.

r[fn.no-mix] Named and unnamed parameters do not mix {pending #571}
A function type that mixes named and unnamed parameters MUST be rejected.

r[fn.outer] The outer is the result type {pending #571}
`fn(x: number):string` MUST yield `string` from `.outer`, and `any` when no outer is written.

## Evaluation

r[fn.equality] Function types are equal when parameters and outer are equal {pending #571}
Two function types MUST be equal when their parameter names, parameter types, defaults, and
outer types are equal. `fn(y: string):string` MUST NOT equal `fn(x: string):string`, and an
omitted outer, which is `any`, MUST NOT equal `string`.

r[fn.inner-named] The inner of named parameters is an ordered of types {pending #571}
`fn(x: number):string` `.inner` MUST yield `ordered[x: number]`.

r[fn.inner-unnamed] The inner of unnamed parameters is a tuple of types {pending #571}
`fn(any)` `.inner` MUST yield `tuple[any]`, and `fn(number, number)` `.inner` MUST yield
`tuple[number, number]`.

r[fn.inner-type] The inner of a function type is an ordered, a tuple, or any {pending #571}
The type of `.inner` on a function type MUST be `union(ordered, tuple, type)`: an ordered for
named parameters, a tuple for unnamed ones, and `any` for a bare function type.

r[fn.print] A function type prints in the complete form {pending #571}
`fn(number)` MUST print as `fn(number):any`. An unnamed parameter MUST print as its type,
never as `$: T`.

r[fn.value] A function type in front of a block makes a function {pending #571}
`fn(x: number):string { "{$x}" }` MUST evaluate to a function whose type equals
`fn(x: number):string`. The body MUST be a block.

r[fn.block-type] A bare block has the unnamed parameters its body reads {pending #571}
A block passed as an argument, or alone in parentheses, MUST take its type from the
unnamed parameters its body reads.

r[fn.block-reads-none] A block that reads no unnamed parameter has no parameters {pending #571}
A block that reads neither `$` nor `$@` MUST have `fn():any`.

r[fn.block-reads-pipe] A block that reads the pipe value takes one parameter {pending #571}
A block that reads `$` and not `$@` MUST have `fn(any):any`.

r[fn.block-reads-acc] A block that reads the accumulator takes two parameters {pending #571}
A block that reads `$@`, with or without `$`, MUST have `fn(any, any):any`.

r[fn.block-held] A block held in a dict or list is not a function {pending #571}
A block that is a dict value or a list element MUST NOT take a function type from its body.

r[fn.no-self] A fn() body does not read a parameter {pending #571}
A function written `fn()` whose body reads `$` MUST be rejected where it is written.

## Examples

```rill pending=571
fn(x: number):string => $t
$t.outer == string
# Result: true
```

```rill pending=571
fn(y: string):string => $a
fn(x: string):string => $b
$a == $b
# Result: false
```

```rill pending=571
fn(x: string):string => $c
list($c).inner == $c
# Result: true
```

```rill pending=571
fn(x: number):string => $t
fn(x: number):string { "{$x}" } => $g
$g.^type == $t
# Result: true
```

## Notes

The 0.23.0 runtime names the type `closure` and writes it `|x: string|:string`. That spelling
is writable in one position only, and `closure(x: number)` halts `#INVALID_INPUT`. #571
removes the `|params|` literal, the `closure` name, and the parenthesized and bare bodies;
each raises a parse error naming `fn`.

The `.^input` and `.^output` probes are already removed (#596). Each halts RILL-R008 and
names `.^type.inner` or `.^type.outer`, as `introspection` states.

The rejection in `fn.no-self` and the errors for mixed or excess unnamed parameters have no
error id yet. Invocation, arity, and dispatch are defined with callables, not here.
