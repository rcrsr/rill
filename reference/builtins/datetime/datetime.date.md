---
id: datetime.date
title: datetime.date
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001]
depends: [method, invocation, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.date

`.date` formats the calendar date of a datetime at a UTC offset.

## Syntax

```text
datetime.date(offset: number = 0) -> string
```

## Evaluation

r[datetime.date.format] .date prints YYYY-MM-DD
`.date(h)` MUST yield the year, month, and day read as `datetime-calendar.offset` states, as
`YYYY-MM-DD`, with the year printed as `datetime-calendar.year-text` states and the month and day
as two digits, zero-padded.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The offset is not a number (`invocation.type`) | RILL-R001 | No |

## Examples

```rill
list[datetime("2026-03-13T23:30:00Z") -> .date, datetime("2026-03-13T23:30:00Z") -> .date(1)]
# Result: list["2026-03-13", "2026-03-14"]
```
