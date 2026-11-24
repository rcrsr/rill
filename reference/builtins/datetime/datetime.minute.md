---
id: datetime.minute
title: datetime.minute
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.minute

`.minute` yields the UTC minute of a datetime.

## Syntax

```text
datetime.minute() -> number
```

## Evaluation

r[datetime.minute.utc] .minute yields the UTC minute from 0 to 59
`.minute` MUST yield the minute of the receiver's instant in UTC, from 0 to 59.

## Examples

```rill
datetime("2026-03-13T08:09:10.123Z") -> .minute
# Result: 9
```
