---
id: fn
title: Function types
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P028, RILL-P029]
depends: [type-value, structural-typing]
tests: [fn-type.test.ts, fn-literal.test.ts, block-argument.test.ts]
---

# Function types

A function type names the parameters a function takes and the type it yields, and a function value is a function type written in front of a block.

## Syntax

```text
fn-type    = "fn" , [ "(" , [ fn-param , { "," , fn-param } ] , ")" ] , [ ":" , type-form ] ;
fn-param   = identifier , [ ":" , type-form ] , [ "=" , literal ] | type-form ;
fn-literal = fn-type , block ;
```

r[fn.name] fn is the type name of every function
`fn` MUST name the type of every function, script-defined or host-provided.

r[fn.no-closure] The name closure is not accepted in a type position
`closure` in a type position MUST raise a parse error that names `fn`.

r[fn.position] A function type is written in every type position
`fn(...)` MUST be accepted wherever a type is accepted: after an assertion colon, in a capture
annotation, as a parameter type, and as an argument of another type such as
`list(fn(x: string):string)`.

r[fn.bare] The bare fn accepts any function
`fn` with no parentheses MUST accept every function.

r[fn.empty] Empty parentheses mean no parameters
`fn()` MUST name a function that takes no parameters, and it MUST NOT equal `fn`. This is
the exception to the rule that empty parentheses leave a type unspecified.

r[fn.omitted] An omitted parameter type or outer is any
`fn(x)` MUST equal `fn(x: any):any`.

r[fn.named] A named parameter has a name, a type, and an optional default
`fn(x: number = 0)` MUST declare a parameter `x` of type `number` with default `0`. The
default is part of the type.

r[fn.unnamed] An unnamed parameter binds the pipe value
A type name alone in the parentheses, as in `fn(number)`, MUST declare an unnamed parameter.

r[fn.unnamed-no-default] An unnamed parameter carries no default
`fn(number = 1)` MUST be rejected with RILL-P028. Only a named parameter MAY carry a default.

r[fn.unnamed-limit] A function has at most two unnamed parameters
The first unnamed parameter MUST be read as `$` and the second as `$@`. A third MUST be
rejected with RILL-P028.

r[fn.no-mix] Named and unnamed parameters do not mix
A function type that mixes named and unnamed parameters MUST be rejected with RILL-P028.

r[fn.outer] The outer is the result type
`fn(x: number):string` MUST yield `string` from `.outer`, and `any` when no outer is written.

## Evaluation

r[fn.equality] Function types are equal when parameters and outer are equal
Two function types MUST be equal when their parameter names, parameter types, defaults, and
outer types are equal. `fn(y: string):string` MUST NOT equal `fn(x: string):string`, and an
omitted outer, which is `any`, MUST NOT equal `string`.

r[fn.inner-named] The inner of named parameters is an ordered of types
`fn(x: number):string` `.inner` MUST yield `ordered[x: number]`.

r[fn.inner-unnamed] The inner of unnamed parameters is a tuple of types
`fn(any)` `.inner` MUST yield `tuple[any]`, and `fn(number, number)` `.inner` MUST yield
`tuple[number, number]`.

r[fn.inner-type] The inner of a function type is an ordered, a tuple, or any
The type of `.inner` on a function type MUST be `union(ordered, tuple, type)`: an ordered for
named parameters, a tuple for unnamed ones, and `any` for a bare function type.

r[fn.print] A function type prints in the complete form
`fn(number)` MUST print as `fn(number):any`. An unnamed parameter MUST print as its type,
never as `$: T`.

r[fn.value] A function type in front of a block makes a function
`fn(x: number):string { "{$x}" }` MUST evaluate to a function whose type equals
`fn(x: number):string`. The body MUST be a block.

r[fn.bare-literal] fn in front of a block types it by its reads
`fn { body }` MUST make a function with one unnamed `any` parameter for each of `$` and `$@`
its body reads: `fn { 5 }` MUST have `fn():any`, `fn { $ * 2 }` MUST have `fn(any):any`, and a
body that reads `$@` MUST have `fn(any, any):any`. `fn:T { body }` MUST take its outer from `T`.

r[fn.block-type] A bare block has the unnamed parameters its body reads
A block passed as a whole argument MUST convert to a function, typed by the unnamed
parameters its body reads. Any other block is a code block (`code-block`).

r[fn.block-outer] An assertion on an argument block is its outer
`{ body }:T` passed as a whole argument MUST convert to a function whose outer is `T`, and
each call MUST assert its result against `T`. `seq({ $ + 1 }:number)` passes `fn(any):number`.

r[fn.block-reads-none] A block that reads no unnamed parameter has no parameters
A block that reads neither `$` nor `$@` MUST have `fn():any`.

r[fn.block-reads-pipe] A block that reads the pipe value takes one parameter
A block that reads `$` and not `$@` MUST have `fn(any):any`.

r[fn.block-reads-acc] A block that reads the accumulator takes two parameters
A block that reads `$@`, with or without `$`, MUST have `fn(any, any):any`.

r[fn.no-self] A fn() body does not read a parameter
A function written `fn()` whose body reads `$` MUST be rejected where it is written, with
RILL-P029.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A third unnamed parameter, mixed parameters, or an unnamed default | RILL-P028 | No |
| A `fn()` body reads a parameter | RILL-P029 | No |

## Examples

```rill
fn(x: number):string => $t
$t.outer == string
# Result: true
```

```rill
fn(y: string):string => $a
fn(x: string):string => $b
$a == $b
# Result: false
```

```rill
fn(x: string):string => $c
list($c).inner == $c
# Result: true
```

```rill
fn(x: number):string => $t
fn(x: number):string { "{$x}" } => $g
$g.^type == $t
# Result: true
```

## Notes

The `|params|` literal, the `|params|:R` type literal, and the name `closure` in a type position
are removed. Each raises RILL-P012 naming `fn`. A `fn` literal with a parenthesized or bare body
raises RILL-P012 naming braces.

The `.^input` and `.^output` probes are removed (#596). Each halts RILL-R008 and
names `.^type.inner` or `.^type.outer`, as `introspection` states.

Invocation, arity, and dispatch are defined with callables, not here.
