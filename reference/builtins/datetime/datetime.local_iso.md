---
id: datetime.local_iso
title: datetime.local_iso
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, datetime, datetime.iso, datetime.local_offset]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.local_iso

`.local_iso` formats a datetime as an ISO 8601 date and time at the host's UTC offset.

## Syntax

```text
datetime.local_iso() -> string
```

## Evaluation

r[datetime.local_iso.offset] .local_iso formats as .iso does at the host's offset
`$d.local_iso` MUST yield what `$d.iso($d.local_offset)` yields, and MUST halt where that halts
(`datetime.local_offset.invalid`, `datetime.iso.offset-range`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The host offset is not finite, or 24 hours or more (`datetime.iso.offset-range`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2026-03-13T08:00:00Z") -> .local_iso
# Result: "2026-03-13T08:00:00Z"
```
