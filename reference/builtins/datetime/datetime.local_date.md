---
id: datetime.local_date
title: datetime.local_date
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, datetime, datetime.date, datetime.local_offset]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.local_date

`.local_date` formats a datetime as a calendar date at the host's UTC offset.

## Syntax

```text
datetime.local_date() -> string
```

## Evaluation

r[datetime.local_date.offset] .local_date formats as .date does at the host's offset
`$d.local_date` MUST yield what `$d.date($d.local_offset)` yields, and MUST halt where that halts
(`datetime.local_offset.invalid`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The host offset is not finite (`datetime.local_offset.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2026-03-13T08:00:00Z") -> .local_date
# Result: "2026-03-13"
```
