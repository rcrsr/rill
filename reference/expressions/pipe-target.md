---
id: pipe-target
title: Pipe target forms
status: normative
since: 0.24.0
issues: []
grammar: [pipe-target, pipe-invoke, implicit-primary]
errors: [RILL-P001, RILL-R002]
depends: [pipe, access]
tests: [pipe-targets.test.ts, expressions.test.ts]
---

# Pipe target forms

A pipe target is the form after `->`; the forms here invoke the piped value, index a target's
result, or start a block with a method.

## Syntax

```ebnf
pipe-target   = host-call
              | fn-call
              | pipe-invoke
              | variable
              | host-name
              | method-call
              | fn-literal
              | assert-statement
              | pipe-error
              | use-expr
              | pass-block
              | timeout-block
              | "pass" , block
              | existence-check
              | declaration
              | string
              | list
              | dict
              | conditional
              | loop
              | block
              | grouped-expr
              | "!" , postfix-expr
              | destructure
              | slice
              | type-assertion
              | type-check
              | type-conversion ;
pipe-invoke   = "$" , "(" , [ arguments ] , ")" ;
implicit-primary = literal | variable | fn-call | host-call | method-call | block | grouped-expr ;
```

## Static rules

r[pipe-target.no-minus] Unary minus is not a target
`v -> -$` and `v -> -1` MUST be rejected with RILL-P001. Negation is a target: `true -> !$`
yields false.

## Evaluation

r[pipe-target.invoke] $() calls the piped value
`v -> $(args)` MUST call the function `v` with `args`. A `v` that is not a function MUST halt with
RILL-R002.

r[pipe-target.postfix] A target's result takes a postfix access
An access form written after a target MUST apply to the target's result: `list[3, 1, 2] -> sort[0]`
yields 1, and `list[1, 2] -> .reverse[0]` yields 2.

r[pipe-target.method-head] A block may start with a method
A block whose body starts with `.m` MUST call `m` on the block's `$`: `"ab" -> { .len }` yields 2.

## Interactions

Each target kind is stated in `pipe`. An access form is stated in `access`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Unary minus after `->` | RILL-P001 | No |
| `$()` on a value that is not a function | RILL-R002 | Yes |

## Examples

```rill
fn(x) { "hi {$x}" } -> $("w")
# Result: "hi w"
```

```rill
list[3, 1, 2] -> sort[0]
# Result: 1
```

```rill
"ab" -> { .len }
# Result: 2
```
