---
id: sample
title: sample
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [time-domain]
tests: [throttling.test.ts]
---

# sample

`sample` keeps the latest chunk of an iterator or a stream at each interval of a duration.

## Evaluation

r[sample.last] sample keeps the last chunk
The result of `sample` over a source with chunks MUST end with the source's last chunk.

## Interactions

The sources, the result, and the duration argument are stated in `time-domain`.

## Examples

```rill
range(0, 3) -> sample(duration("10ms"))[-1]
# Result: 2
```
