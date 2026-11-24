---
id: debounce
title: debounce
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [time-domain]
tests: [throttling.test.ts, builtin-functions-slicing.test.ts]
---

# debounce

`debounce` keeps the chunks of an iterator or a stream that no other chunk follows within a
duration.

## Evaluation

r[debounce.last] debounce keeps the last chunk
The result of `debounce` over a source with chunks MUST end with the source's last chunk.

r[debounce.zero] A zero duration keeps every chunk
`debounce(duration("0ms"))` MUST yield every chunk of the source.

## Interactions

The sources, the result, and the duration argument are stated in `time-domain`.

## Examples

```rill
list[range(0, 3) -> debounce(duration("0ms")), range(0, 3) -> debounce(duration("10ms"))[-1]]
# Result: list[list[0, 1, 2], 2]
```
