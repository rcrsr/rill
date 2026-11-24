---
id: duration.hours
title: duration.hours
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.hours

`.hours` yields the hours a duration holds past its whole days.

## Syntax

```text
duration.hours() -> number
```

## Evaluation

r[duration.hours.part] .hours yields the hours part
`.hours` MUST yield the whole hours left after the whole days, from 0 to 23 (`duration-split.order`).

## Examples

```rill
duration("49h") -> .hours
# Result: 1
```
