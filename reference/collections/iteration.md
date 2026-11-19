---
id: iteration
title: Iteration
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002, RILL-R010, TYPE_MISMATCH]
depends: [scope, pipe, break]
tests: [collection-operators.test.ts, iterators.test.ts, streams.test.ts]
---

# Iteration

A collection operator calls a function once for each element of a source, binding the element
to `$`.

## Syntax

```text
source -> op(fn, ...)
op(source, fn, ...)
```

The operators are `seq`, `fan`, `filter`, `fold`, `acc`, and `sort`.

## Evaluation

r[iteration.source-kinds] Lists, tuples, strings, dicts, ordereds, iterators, and streams are sources
A list, a tuple, a string, a dict, an ordered, an iterator, and a stream MUST be accepted as a
source.

r[iteration.other-source] Any other value is not a source
A source of any other kind MUST halt with RILL-R002 in every operator, `sort` included.

r[iteration.tuple] A tuple yields its elements in order
A tuple MUST yield its elements from first to last.

r[iteration.ordered] An ordered yields entry dicts in its own order
An ordered MUST yield one `dict[key: k, value: v]` per entry, in its own order.

r[iteration.list] A list yields its elements in order
A list MUST yield its elements from first to last.

r[iteration.string] A string yields its code points in order
A string MUST yield one string per Unicode code point, from first to last. `"é"` written with a
combining accent yields two elements.

r[iteration.dict] A dict yields one entry dict per key, in key order
A dict MUST yield `dict[key: k, value: v]` for each key, in ascending key order. String keys
MUST compare by UTF-16 code unit, so `"B"` comes before `"a"`.

r[iteration.iterator] An iterator yields each value until it is done
An iterator MUST yield its values in order and stop when it reports done.

r[iteration.stream] A stream yields its chunks and is consumed
A stream MUST yield its chunks in arrival order, and iterating it MUST consume it
(`value.stream`).

r[iteration.expansion] An iterator or stream past 10,000 elements halts
Reading an iterator or a stream MUST halt with RILL-R010 when it would yield a 10,001st element.

r[iteration.sequential-limit] seq, fold, and acc call at most 10,000 times
`seq`, `fold`, and `acc` MUST halt with RILL-R010 when the source holds more than 10,000
elements, whatever its kind.

r[iteration.ceiling] fan, filter, and sort share the 10,000-element ceiling
`fan`, `filter`, and `sort` MUST halt with RILL-R010 when the source holds more than 10,000
elements, as `seq`, `fold`, and `acc` do.

r[iteration.callable] The function argument is callable
A function argument that is not callable MUST halt with `#TYPE_MISMATCH`.

r[iteration.dollar] Each call binds the element to $
Each call MUST bind the element to `$`. A function with a named first parameter MUST receive
the element as that argument.

r[iteration.empty] An empty source calls nothing
An empty source MUST yield the operator's empty result without calling the function.

r[iteration.halt] A halt in a call halts the operator
A halt raised by a call MUST propagate out of the operator, and the operator MUST yield no
value.

## Interactions

`source -> op(args)` passes the source as the first argument (`pipe.call-operand`). Each call
runs in a fresh scope (`scope.iteration`). `break` ends `seq` and `acc` (`break.seq`), and
halts in the other operators (`break.unsupported`). `return` ends one call (`break.return-each`).
A map's entries are stated in `map.iteration`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The source is not a list, tuple, string, dict, ordered, iterator, or stream | RILL-R002 | Yes |
| An iterator or stream yields more than 10,000 elements | RILL-R010 | No |
| An operator's source holds more than 10,000 elements | RILL-R010 | No |
| The function argument is not callable | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
"hé" -> seq({ $ })
# Result: list["h", "é"]
```

```rill
dict[b: 1, a: 2] -> seq({ "{$.key}={$.value}" })
# Result: list["a=2", "b=1"]
```

```rill
seq(list[1, 2], fn(x: number) { $x * 10 })
# Result: list[10, 20]
```

```rill
# Error: Collection operators require
5 -> seq({ $ })
```

```rill
tuple[1, 2] -> seq({ $ * 10 })
# Result: list[10, 20]
```

```rill
ordered[b: 1, a: 2] -> seq({ "{$.key}={$.value}" })
# Result: list["b=1", "a=2"]
```

```rill
# Error: Iterator expansion exceeded 10000 iterations
range(0, 10001) -> seq({ $ })
```

```rill
# Error: iteration exceeded 10000 iterations
range(0, 10000) -> seq({ $ }) => $big
guard { list[...$big, 0] -> fan({ $ }) }
```

## Notes

The limit on `fan` calls in flight is a host limit, stated with limits, not here.

Superseded: `iteration.sources`, now `iteration.source-kinds`, and `iteration.non-source`, now
`iteration.other-source`. On 0.23.0 a tuple and an ordered halt RILL-R002 as sources.

On 0.23.0 a dict with number keys yields them as numbers, sorted numerically (#576).
