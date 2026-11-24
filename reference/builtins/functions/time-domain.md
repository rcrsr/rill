---
id: time-domain
title: Time-domain functions
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, RILL-R001]
depends: [iteration, duration, construct-options, invocation, pipe]
tests: [throttling.test.ts, builtin-functions-slicing.test.ts]
---

# Time-domain functions

A time-domain function, one of `debounce`, `throttle`, and `sample`, reads the chunks of an
iterator or a stream and keeps some of them, given a duration.

## Syntax

```text
debounce(source, dur: duration) -> list
throttle(source, dur: duration) -> list
sample(source, dur: duration) -> list
```

## Evaluation

r[time-domain.sources] Only an iterator or a stream is a source
`debounce`, `throttle`, and `sample` MUST accept an iterator and a stream as their source. A
source of any other kind, a list, a tuple, a string, and a dict included, MUST halt with
`#INVALID_INPUT`.

r[time-domain.subsequence] The result is a list of source chunks in order
`debounce`, `throttle`, and `sample` MUST yield a list whose elements are chunks of the source,
each at most once, in source order.

r[time-domain.empty] An empty source yields an empty list
A source with no chunks MUST yield `list[]`.

## Interactions

`source -> debounce(d)` passes the source as the first argument (`pipe.call-operand`). A `dur`
that is not a duration is a parameter type mismatch (`invocation.type`), and one with a months
part halts as `construct-options.timeout-fixed-duration` states. Reading the source is bounded
by `iteration.expansion` and consumes a stream (`iteration.stream`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The source is not an iterator or a stream | `#INVALID_INPUT` | Yes |
| `dur` is not a duration (`invocation.type`) | RILL-R001 | No |

## Examples

```rill
range(0, 0) -> sample(duration("10ms"))
# Result: list[]
```

```rill
guard { list[1, 2] -> debounce(duration("10ms")) } => $r
$r.!code
# Result: #INVALID_INPUT
```

## Notes

Which chunks pass does not depend on when they arrive: a stream that waits 60 ms between chunks
yields `list[3]` from `debounce(duration("10ms"))`. Whether that is intended is undecided: see
INCONSISTENCIES.md.
