---
id: duration.seconds
title: duration.seconds
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.seconds

`.seconds` yields the seconds a duration holds past its whole minutes.

## Syntax

```text
duration.seconds() -> number
```

## Evaluation

r[duration.seconds.part] .seconds yields the seconds part
`.seconds` MUST yield the whole seconds left after the whole minutes, from 0 to 59 (`duration-split.order`).

## Examples

```rill
duration("90s") -> .seconds
# Result: 30
```
