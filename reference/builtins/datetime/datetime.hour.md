---
id: datetime.hour
title: datetime.hour
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.hour

`.hour` yields the UTC hour of a datetime.

## Syntax

```text
datetime.hour() -> number
```

## Evaluation

r[datetime.hour.utc] .hour yields the UTC hour from 0 to 23
`.hour` MUST yield the hour of the receiver's instant in UTC, from 0 to 23.

## Examples

```rill
datetime(...dict[unix: -1]) -> .hour
# Result: 23
```
