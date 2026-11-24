---
id: duration.minutes
title: duration.minutes
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.minutes

`.minutes` yields the minutes a duration holds past its whole hours.

## Syntax

```text
duration.minutes() -> number
```

## Evaluation

r[duration.minutes.part] .minutes yields the minutes part
`.minutes` MUST yield the whole minutes left after the whole hours, from 0 to 59 (`duration-split.order`).

## Examples

```rill
duration("1h45m") -> .minutes
# Result: 45
```
