---
id: identity
title: identity
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R044, RILL-R045]
depends: [invocation, defaults, pipe]
tests: [functions.test.ts, builtin-functions-core.test.ts]
---

# identity

`identity` yields its one argument.

## Syntax

```text
identity(value: any) -> any
```

## Evaluation

r[identity.value] identity yields its argument
`identity(v)` MUST yield `v`, for a value of any kind: a string, a number, a collection, a
function, an iterator, or a type value.

## Interactions

`v -> identity` passes `v` as the argument (`pipe.call-operand`). Written bare outside a pipe
target, `identity` is called with no argument (`invocation.bare-name`) and halts
(`defaults.param-required`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| No argument is passed (`defaults.param-required`) | RILL-R044 | No |
| More than one argument is passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
list[identity(1), identity("a"), identity(#x), identity(number)]
# Result: list[1, "a", #x, number]
```

```rill
fn(x) { $x * 2 } => $f
identity($f)(3)
# Result: 6
```

```rill
# Error: Missing argument for parameter 'value'
identity()
```
