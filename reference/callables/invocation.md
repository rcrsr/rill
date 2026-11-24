---
id: invocation
title: Invocation
status: normative
since: 0.24.0
issues: []
grammar: [fn-call, host-call, host-name, arguments, argument]
errors: [RILL-P001, RILL-R001, RILL-R006, RILL-R045]
depends: [keyword, fn, defaults, scope]
tests: [args.test.ts, functions.test.ts, closure-semantics.test.ts, pipe-targets.test.ts, property-access.test.ts]
---

# Invocation

A call evaluates its arguments, binds them to the function's parameters, and runs the body.

## Syntax

```ebnf
fn-call = "$" , identifier , "(" , [ arguments ] , ")" ;
host-call = host-name , "(" , [ arguments ] , ")" ;
host-name = identifier ;
arguments = argument , { "," , argument } ;
argument = spread-arg | expression ;
```

```text
$f(a, b)
v -> $f(b)
v -> $f
name(a)
name
```

## Static rules

r[invocation.no-named] A call argument takes no name
An argument written `name: value` MUST be rejected with RILL-P001, in a call of a script
function, a built-in or host function, and a method.

## Evaluation

r[invocation.arguments-first] Arguments evaluate left to right before binding
A call MUST evaluate every written argument, left to right, before it binds any parameter or
checks the argument count.

r[invocation.positional] Arguments bind by position
The first argument MUST bind the first parameter, the second the second, and so on.

r[invocation.excess] An excess argument halts
A call with more arguments than the function has parameters MUST halt with RILL-R045.

r[invocation.type] An argument that fails its parameter type halts
An argument whose value the parameter's type does not accept MUST halt with RILL-R001. The
first failing parameter in order MUST be the one reported.

r[invocation.before-body] Binding completes before the body runs
The body MUST NOT run until every parameter is bound and checked.

r[invocation.no-self-binding] A call does not bind $ to the dict it was read from
Calling a function read from a dict MUST NOT bind `$` to that dict. `$` in its body MUST resolve
as it does when the same function is called through a variable.

r[invocation.bare-name] A bare function name calls it with no arguments
A built-in or host function name written without parentheses, outside a pipe target, MUST call
that function with no arguments. `now => $t` MUST bind a datetime, and `$f(now)` MUST pass one.

## Interactions

A host property function receives the collection it is selected or called from as `self` (`selection.property`).
A parameter without an argument takes its default (`defaults.param`), or the call halts
(`defaults.param-required`). A piped value is the first argument (`pipe.call-operand`,
`pipe.script-operand`). A spread supplies arguments by name or position (`spread.arg-dict`,
`spread.arg-tuple`). The body runs in a child scope that resolves names when it runs
(`scope.child`, `scope.late-binding`). Arity and parameter-type halts are never caught
(`halt.non-catchable`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An argument fails its parameter's type | RILL-R001 | No |
| More arguments than parameters | RILL-R045 | No |
| An argument written `name: value` | RILL-P001 | No |
| A bare name names no function (`keyword.other`) | RILL-R006 | Yes |

## Examples

```rill
fn(a: number, b: number) { $a - $b } => $f
$f(5, 2)
# Result: 3
```

```rill
# Error: Function expects 1 argument, got 2
fn(a) { $a } => $f
$f(1, 2)
```

```rill
# Error: Parameter type mismatch: a expects number, got string
fn(a: number) { $a } => $f
$f("x")
```

## Notes

On 0.23.0 a function called from a dict reads that dict as `$` (#627).

On 0.23.0 a function is written `|a, b| ($a - $b)`. #571 removes that form.
