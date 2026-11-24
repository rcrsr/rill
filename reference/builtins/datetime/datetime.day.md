---
id: datetime.day
title: datetime.day
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.day

`.day` yields the UTC day of the month of a datetime.

## Syntax

```text
datetime.day() -> number
```

## Evaluation

r[datetime.day.utc] .day yields the UTC day of the month
`.day` MUST yield the day of the month of the receiver's instant in UTC, from 1.

## Examples

```rill
datetime("2026-03-13T08:09:10.123Z") -> .day
# Result: 13
```
