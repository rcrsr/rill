---
id: throttle
title: throttle
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [time-domain]
tests: [throttling.test.ts, builtin-functions-slicing.test.ts]
---

# throttle

`throttle` keeps at most one chunk of an iterator or a stream per duration, starting with the
first.

## Evaluation

r[throttle.first] throttle keeps the first chunk
The result of `throttle` over a source with chunks MUST begin with the source's first chunk.

r[throttle.zero] A zero duration keeps every chunk
`throttle(duration("0ms"))` MUST yield every chunk of the source.

## Interactions

The sources, the result, and the duration argument are stated in `time-domain`.

## Examples

```rill
list[range(0, 3) -> throttle(duration("0ms")), range(0, 3) -> throttle(duration("10ms"))[0]]
# Result: list[list[0, 1, 2], 0]
```
