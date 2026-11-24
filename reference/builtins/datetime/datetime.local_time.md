---
id: datetime.local_time
title: datetime.local_time
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, datetime, datetime.time, datetime.local_offset]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.local_time

`.local_time` formats a datetime as a time of day at the host's UTC offset.

## Syntax

```text
datetime.local_time() -> string
```

## Evaluation

r[datetime.local_time.offset] .local_time formats as .time does at the host's offset
`$d.local_time` MUST yield what `$d.time($d.local_offset)` yields, and MUST halt where that halts
(`datetime.local_offset.invalid`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The host offset is not finite (`datetime.local_offset.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2026-03-13T08:00:00Z") -> .local_time
# Result: "08:00:00"
```
