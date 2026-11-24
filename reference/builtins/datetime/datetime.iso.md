---
id: datetime.iso
title: datetime.iso
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, INVALID_INPUT]
depends: [method, invocation, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.iso

`.iso` formats a datetime as an ISO 8601 date and time at a UTC offset.

## Syntax

```text
datetime.iso(offset: number = 0) -> string
```

## Evaluation

r[datetime.iso.format] .iso prints the date and time joined by T
`.iso(h)` MUST yield `YYYY-MM-DDTHH:MM:SS`, then the milliseconds part, then the offset suffix,
with the fields read as `datetime-calendar.offset` states and the year printed as
`datetime-calendar.year-text` states. Month, day, hour, minute, and second MUST each print as two
digits, zero-padded, with the hour from 00 to 23.

r[datetime.iso.millis] Milliseconds print only when not zero
When the millisecond field is not 0, `.iso` MUST print `.` and the field as three digits,
zero-padded, before the suffix. When it is 0, `.iso` MUST print no milliseconds part.

r[datetime.iso.suffix] The suffix is Z at offset 0 and a signed HH:MM otherwise
An offset of 0 MUST print the suffix `Z`. Any other offset that is a whole number of minutes MUST
print `+` when positive or `-` when negative, then the offset's hours and minutes as `HH:MM`. An
offset of -5.5 prints `-05:30`.

r[datetime.iso.offset-range] An offset of 24 hours or more halts
An offset whose magnitude is 24 hours or more MUST halt with `#INVALID_INPUT`.

## Interactions

The printed form of a datetime, which always carries milliseconds, is stated in `datetime.print`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The offset's magnitude is 24 hours or more | `#INVALID_INPUT` | Yes |
| The offset is not a number (`invocation.type`) | RILL-R001 | No |

## Examples

```rill
list[datetime("2026-03-13T08:09:10.123Z") -> .iso, datetime("2026-03-13T08:09:10Z") -> .iso(-5.5)]
# Result: list["2026-03-13T08:09:10.123Z", "2026-03-13T02:39:10-05:30"]
```

```rill
guard { datetime("2026-03-13") -> .iso(24) } => $r
$r.!code
# Result: #INVALID_INPUT
```
