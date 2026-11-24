---
id: datetime-calendar
title: Datetime calendar fields
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001]
depends: [method, invocation, datetime, value-size]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# Datetime calendar fields

The calendar fields of a datetime are the year, month, day, hour, minute, second, and
millisecond its instant falls on, which the component readers yield and the formatters print.

## Evaluation

r[datetime-calendar.gregorian] Fields follow the proleptic Gregorian calendar
The calendar fields of a datetime MUST be those of its instant on the proleptic Gregorian
calendar, across the whole range of `value-size.datetime`. Years MUST be numbered
astronomically: the year before 1 is 0, and the year before 0 is -1.

r[datetime-calendar.offset] An offset reads the fields h hours ahead of UTC
`.iso`, `.date`, and `.time` given an offset `h` MUST print the calendar fields, read in UTC, of
the instant `h` hours after the receiver's, when that instant lies in the range of
`value-size.datetime`. `h` MAY be negative or fractional: an offset of 5.5 reads the fields
5 hours 30 minutes ahead of UTC.

r[datetime-calendar.offset-default] An omitted offset is 0
`.iso`, `.date`, and `.time` called with no argument MUST format as they do with an offset of 0,
which reads the fields in UTC.

r[datetime-calendar.year-text] A year prints as four digits or as a signed six
`.iso` and `.date` MUST print a year from 0 to 9999 as four digits, zero-padded. Any other year
MUST print as `+` or `-` followed by six digits, zero-padded, so year 10000 prints `+010000` and
year -50 prints `-000050`.

## Interactions

An offset that is not a number halts as `invocation.type` states. The offset range of `.iso` is
stated in `datetime.iso.offset-range`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An offset is not a number (`invocation.type`) | RILL-R001 | No |

## Examples

```rill
datetime(...dict[year: 0, month: 1, day: 1]) -> .iso
# Result: "0000-01-01T00:00:00Z"
```

```rill
list[datetime("2026-03-13T23:30:00Z") -> .date(1), datetime("2026-03-13T23:30:00Z") -> .time(-5.5)]
# Result: list["2026-03-14", "18:00:00"]
```

```rill
datetime(...dict[year: 10000, month: 1, day: 1]) -> .date
# Result: "+010000-01-01"
```
