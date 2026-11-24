---
id: slicing
title: Slicing functions
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, RILL-R001, RILL-R002, TYPE_MISMATCH]
depends: [iteration, map, invocation, pipe, slicing-limit, break]
tests: [collection-slicing.test.ts, collection-operators.test.ts, builtin-functions-slicing.test.ts]
---

# Slicing functions

A slicing function, one of `take`, `skip`, `cycle`, `batch`, `window`, `start_when`, and
`stop_when`, reads the elements of a source and keeps or regroups them without changing any
element.

## Syntax

```text
source -> take(n)        source -> skip(n)            source -> cycle
source -> batch(n)       source -> batch(n, options)  source -> window(n)
source -> window(n, step)  source -> start_when(predicate)  source -> stop_when(predicate)
```

## Evaluation

r[slicing.sources] A slicing function reads every source an operator reads
`take`, `skip`, `cycle`, `batch`, `window`, `start_when`, and `stop_when` MUST accept a list, a
tuple, a string, a dict, an ordered, a map, an iterator, and a stream as their source, and MUST
read its elements in the order `iteration` states for that kind: a dict and an ordered as entry
dicts (`iteration.dict`, `iteration.ordered`), a map as `map.iteration` states, and a string as
code points (`iteration.string`).

r[slicing.other-source] Any other source halts
A source of any other kind MUST halt with RILL-R002.

r[slicing.to-list] A slicing result is a list
`take`, `skip`, `batch`, `window`, `start_when`, and `stop_when` MUST yield a list for every
source kind, an iterator and a stream included.

r[slicing.integer] A count is an integer
The `n` of `take`, `skip`, `batch`, and `window`, and a number `step` of `window`, MUST be an
integer. A fractional number MUST halt with `#INVALID_INPUT`. `take(2.0)` takes two elements.

r[slicing.predicate-bool] A predicate yields a bool
A `start_when` or `stop_when` predicate call that yields a value other than a bool MUST halt with
`#TYPE_MISMATCH`.

## Interactions

`source -> take(n)` passes the source as the first argument (`pipe.call-operand`). Reading a
stream consumes it (`iteration.stream`). Result sizes and iterator reads are bounded by
`slicing-limit`. A predicate's call arity is stated in `iteration.arity-single`, and `break` in
a predicate in `break.other-operators`. A non-number `n` is a parameter type mismatch
(`invocation.type`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The source is not a list, tuple, string, dict, ordered, map, iterator, or stream | RILL-R002 | Yes |
| `n` or a number `step` is fractional | `#INVALID_INPUT` | Yes |
| `n` is not a number (`invocation.type`) | RILL-R001 | No |
| A predicate yields a value other than a bool | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[tuple[1, 2] -> take(1), "héllo" -> skip(3), ordered[b: 1, a: 2] -> take(1)]
# Result: list[list[1], list["l", "o"], list[dict[key: "b", value: 1]]]
```

```rill
dict[b: 1, a: 2] -> take(1)
# Result: list[dict[key: "a", value: 2]]
```

```rill
guard { 5 -> take(1) } => $r
$r.!code
# Result: #RILL_R002
```

```rill
# Error: take: n must be an integer
list[1, 2] -> take(1.5)
```
