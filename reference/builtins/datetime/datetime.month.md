---
id: datetime.month
title: datetime.month
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.month

`.month` yields the UTC month of a datetime.

## Syntax

```text
datetime.month() -> number
```

## Evaluation

r[datetime.month.utc] .month yields the UTC month from 1 to 12
`.month` MUST yield the month of the receiver's instant in UTC, from 1 for January to 12 for December.

## Examples

```rill
datetime("2026-03-13T08:09:10.123Z") -> .month
# Result: 3
```
