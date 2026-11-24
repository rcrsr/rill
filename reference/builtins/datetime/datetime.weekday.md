---
id: datetime.weekday
title: datetime.weekday
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.weekday

`.weekday` yields the UTC day of the week of a datetime as a number.

## Syntax

```text
datetime.weekday() -> number
```

## Evaluation

r[datetime.weekday.iso] .weekday counts from 1 for Monday to 7 for Sunday
`.weekday` MUST yield the day of the week of the receiver's UTC date: 1 for Monday, 2 for
Tuesday, and so on to 7 for Sunday.

## Examples

```rill
list[datetime("1970-01-01") -> .weekday, datetime("2026-03-15T23:59:59Z") -> .weekday]
# Result: list[4, 7]
```
