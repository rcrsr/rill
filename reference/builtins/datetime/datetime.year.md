---
id: datetime.year
title: datetime.year
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.year

`.year` yields the UTC year of a datetime.

## Syntax

```text
datetime.year() -> number
```

## Evaluation

r[datetime.year.utc] .year yields the UTC year
`.year` MUST yield the year of the receiver's instant in UTC, numbered as `datetime-calendar.gregorian` states.

## Examples

```rill
datetime(...dict[year: -50, month: 6, day: 15]) -> .year
# Result: -50
```
