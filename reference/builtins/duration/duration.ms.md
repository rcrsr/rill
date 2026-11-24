---
id: duration.ms
title: duration.ms
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.ms

`.ms` yields the milliseconds a duration holds past its whole seconds.

## Syntax

```text
duration.ms() -> number
```

## Evaluation

r[duration.ms.part] .ms yields the millisecond remainder
`.ms` MUST yield the milliseconds left after the whole seconds, below 1000 and keeping any fraction (`duration-split.order`).

## Examples

```rill
list[duration("1500ms").ms, duration("1s0.5ms").ms]
# Result: list[500, 0.5]
```
