---
id: value
title: Values
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R085]
depends: [statement]
tests: [vacancy-coerce.test.ts, streams.test.ts, values.test.ts]
---

# Values

A value is an immutable datum of one type, and every expression that completes yields one.

## Evaluation

r[value.kinds] Every value has one kind
A value MUST be one of: a string, number, bool, atom, datetime, duration, or error code; a
list, tuple, dict, ordered, or map; a function; a type value; or a stream.

r[value.always] An expression yields a value or halts
An expression that completes MUST yield a value. No expression yields "no value".

r[value.no-null] rill has no null or undefined
A script MUST NOT be able to write, receive, or observe a null or undefined value.

r[value.host-null] A host null halts at the boundary
A host function that returns null or undefined MUST halt with RILL-R085.

r[value.immutable] A value never changes
A script operation MUST NOT change a value after it is created. An operation that yields a changed
collection MUST yield a new value and leave the original as it was.

r[value.no-alias] A rebinding does not reach other holders
Rebinding a variable MUST NOT change the value any other variable, collection, or function
holds.

r[value.stream] A stream is the one stateful value
A stream MUST be consumed as it is read. Every other value is immutable.

r[value.valid-invalid] A value is valid or invalid
Every value MUST be valid or invalid. An invalid value carries the halt that produced it
(`invalid-value`).

## Interactions

`equality` states when two values are equal,
and `vacancy` states which values `??` replaces. A value's type is reported by `.^type`
(`carried-type`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A host function returns null or undefined | RILL-R085 | No |

## Examples

```rill
list[1, 2] => $a
$a -> seq({ $ * 10 }) => $b
list[$a, $b]
# Result: list[list[1, 2], list[10, 20]]
```

```rill
0 ?? 5
# Result: 0
```

## Notes

Host code receives native objects and can change them; the guarantee covers script operations.
