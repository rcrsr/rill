---
id: datetime.time
title: datetime.time
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001]
depends: [method, invocation, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.time

`.time` formats the time of day of a datetime at a UTC offset.

## Syntax

```text
datetime.time(offset: number = 0) -> string
```

## Evaluation

r[datetime.time.format] .time prints HH:MM:SS
`.time(h)` MUST yield the hour, minute, and second read as `datetime-calendar.offset` states, as
`HH:MM:SS`, each two digits, zero-padded, with the hour from 00 to 23.

r[datetime.time.no-millis] .time drops the milliseconds
`.time` MUST print no milliseconds, and MUST NOT round the second: `23:59:59.999Z` prints
`23:59:59`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The offset is not a number (`invocation.type`) | RILL-R001 | No |

## Examples

```rill
list[datetime("2026-03-13T23:59:59.999Z") -> .time, datetime("2026-03-13T23:30:00Z") -> .time(0.5)]
# Result: list["23:59:59", "00:00:00"]
```
