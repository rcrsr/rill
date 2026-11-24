---
id: duration.days
title: duration.days
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.days

`.days` yields the whole days of a duration.

## Syntax

```text
duration.days() -> number
```

## Evaluation

r[duration.days.part] .days yields the days part
`.days` MUST yield the whole days of the receiver (`duration-split.order`).

## Examples

```rill
duration("49h") -> .days
# Result: 2
```
