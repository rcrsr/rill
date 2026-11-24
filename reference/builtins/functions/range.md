---
id: range
title: range
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, RILL-R001, RILL-R010, RILL-R044, RILL-R045]
depends: [invocation, defaults, pipe, iteration, number]
tests: [iterators.test.ts, builtin-functions-core.test.ts]
---

# range

`range` yields an iterator over evenly spaced numbers from a start up to a stop.

## Syntax

```text
range(start: number, stop: number, step: number = 1) -> iterator
```

## Evaluation

r[range.values] The value at position i is start plus i times step
`range(start, stop, step)` MUST yield an iterator whose value at position `i`, counting from 0,
is `start + i * step`, computed afresh for each `i` and not by adding `step` repeatedly.
`range(0, 1, 0.1)` yields `0.30000000000000004` at position 3 and `0.7000000000000001` at
position 7.

r[range.stop] The iterator ends before the stop
With a positive `step`, the iterator MUST end before the first value greater than or equal to
`stop`. With a negative `step`, it MUST end before the first value less than or equal to `stop`.
A start already at or past the stop in the step's direction MUST yield a done iterator.

r[range.step-default] The step defaults to 1
`range(start, stop)` MUST equal `range(start, stop, 1)`.

r[range.zero-step] A zero step halts
A `step` of 0 MUST halt with `#INVALID_INPUT` when `range` is called, before any value is read.

r[range.lazy] Values are made as they are read
`range` MUST NOT compute a value before it is read. `range(0, 1000000000000)` MUST return an
iterator, and reading its first value MUST yield `0`.

## Interactions

Operators read the iterator as `iteration.iterator` states, and a read past 10,000 values halts
(`iteration.expansion`). `v -> range(stop)` passes `v` as `start` (`pipe.call-operand`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The step is 0 (`range.zero-step`) | `#INVALID_INPUT` | Yes |
| An argument is not a number (`invocation.type`) | RILL-R001 | No |
| A read passes 10,000 values (`iteration.expansion`) | RILL-R010 | No |
| `start` or `stop` is omitted (`defaults.param-required`) | RILL-R044 | No |
| More than three arguments are passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
list[range(0, 5), range(0, 10, 3), range(5, 0, -2), range(0, 2.5)] -> seq({ $ -> seq({ $ }) })
# Result: list[list[0, 1, 2, 3, 4], list[0, 3, 6, 9], list[5, 3, 1], list[0, 1, 2]]
```

```rill
list[range(5, 0), range(0, 5, -1), range(3, 3)] -> seq({ $ -> seq({ $ }) })
# Result: list[list[], list[], list[]]
```

```rill
guard { range(0, 5, 0) } => $r
$r.!code
# Result: #INVALID_INPUT
```
