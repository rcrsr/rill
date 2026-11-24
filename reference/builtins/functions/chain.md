---
id: chain
title: chain
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [iteration, pipe, break]
tests: [chain.test.ts, collection-operators.test.ts]
---

# chain

`chain` passes a value through a function, or through a list of functions in turn.

## Syntax

```text
chain(value, transform) -> any
value -> chain(transform)
```

`transform` is a function or a list of functions.

## Evaluation

r[chain.call] chain calls one function with the value
`chain(v, f)` MUST yield the result of calling `f` with `v`.

r[chain.list] chain calls a list of functions left to right
`chain(v, list[f1, f2, ...])` MUST call `f1` with `v`, then each later function with the result
of the one before it, and MUST yield the last result.

r[chain.empty] An empty list yields the value
`chain(v, list[])` MUST yield `v` unchanged.

## Interactions

`value -> chain(f)` passes the value as the first argument (`pipe.call-operand`). A function's
arity is stated in `iteration.arity-single`. `break` in a function halts as
`break.unsupported` states for a `break` outside any loop.

## Examples

```rill
list[5 -> chain({ $ + 1 }), chain(5, list[fn(x) { $x + 1 }, fn(x) { $x * 2 }]), chain(5, list[])]
# Result: list[6, 12, 5]
```

## Notes

A `transform` that is neither a function nor a list, or a list element that is not a function,
halts RILL-R040, not `#TYPE_MISMATCH` as `iteration.callable` states for the operators: see
INCONSISTENCIES.md.
