---
id: datetime
title: Datetimes
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R002, INVALID_INPUT, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [datetime.test.ts, type-assertions.test.ts]
---

# Datetimes

A datetime is an immutable instant, stored as milliseconds since the Unix epoch in UTC.

## Evaluation

r[datetime.value] A datetime is one UTC instant
A datetime MUST denote one instant. It carries no offset and no timezone name.

r[datetime.from-string] datetime of an ISO 8601 string parses the string
`datetime("2026-03-13T00:00:00Z")` MUST yield that instant.

r[datetime.from-offset] A string with an offset converts to UTC
`datetime("2026-03-13T02:00:00+02:00")` MUST yield `2026-03-13T00:00:00.000Z`.

r[datetime.from-naive] A string with a time and no offset reads as UTC
`datetime("2026-03-13T02:00:00")` MUST yield `2026-03-13T02:00:00.000Z`.

r[datetime.from-date] A date-only string denotes midnight UTC
`datetime("2026-03-13")` MUST yield `2026-03-13T00:00:00.000Z`.

r[datetime.from-components] datetime of named components builds an instant
`datetime(...dict[year: 2026, month: 3, day: 13])` MUST yield midnight UTC of that date.
`year`, `month`, and `day` are required.

r[datetime.optional-fields] The time components default to zero
`hour`, `minute`, `second`, and `ms` MAY follow `year`, `month`, and `day`, and each MUST
default to 0.

r[datetime.from-unix] datetime of a unix count reads milliseconds
`datetime(...dict[unix: 0])` MUST yield the instant at the epoch. The count is in milliseconds.

r[datetime.invalid] A string that is not ISO 8601 halts
`datetime("nope")` MUST halt with `#INVALID_INPUT`.

r[datetime.missing-field] A missing required component halts
A named-component call that omits `year`, `month`, or `day` MUST halt with `#INVALID_INPUT`.

r[datetime.out-of-range] A component out of range halts
A component outside its range, a date that does not exist, and an hour of 24 MUST halt with
`#INVALID_INPUT`. `month: 13` and `month: 2, day: 30` halt.

r[datetime.no-argument] A call with no arguments halts
`datetime()` MUST halt with `#INVALID_INPUT`.

r[datetime.wrong-type] A first argument that is not a string halts
`datetime(5)` MUST halt with `#TYPE_MISMATCH`.

r[datetime.unknown-key] An unknown component name halts
A spread key that names no parameter MUST halt with RILL-R001.

r[datetime.component-type] A component that is not a number halts
A named component or a unix count that is not a number MUST halt with `#TYPE_MISMATCH`.
`datetime(...dict[year: "2026", month: 3, day: 1])` halts.

r[datetime.one-form] A call takes one form of input
A string argument followed by a second argument, a string with named components, and a unix
count with `year`, `month`, or `day` MUST halt with `#INVALID_INPUT`.

r[datetime.print] A datetime prints as UTC ISO 8601
A datetime MUST print as `YYYY-MM-DDTHH:MM:SS.mmmZ`, with milliseconds always present.

r[datetime.equality] Two datetimes are equal when they denote the same instant
`==` between two datetimes MUST yield true exactly when both hold the same millisecond count,
whatever form built them.

r[datetime.ordering] Datetimes order by instant
`<`, `>`, `<=`, and `>=` between two datetimes MUST compare their instants.

## Interactions

Equality against a non-datetime value follows `equality.no-overlap`.

r[datetime.no-arithmetic] A datetime is not a number
An arithmetic operator with a datetime operand MUST halt with RILL-R002. Ordering a datetime
against a non-datetime MUST halt with RILL-R002.

r[datetime.membership] Only a datetime satisfies datetime
A datetime MUST satisfy `:datetime`. A value of any other type MUST halt `:datetime` with
`#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A string, component, or argument count is invalid | `#INVALID_INPUT` | Yes |
| A call mixes the string, component, and unix forms | `#INVALID_INPUT` | Yes |
| The first argument is not a string, or a component is not a number | `#TYPE_MISMATCH` | Yes |
| A spread key names no parameter | RILL-R001 | Yes |
| A datetime is ordered against a non-datetime or used in arithmetic | RILL-R002 | Yes |
| A non-datetime is asserted as `:datetime` | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
datetime("2026-03-13T02:00:00+02:00") -> "{$}"
# Result: "2026-03-13T00:00:00.000Z"
```

```rill
datetime(...dict[year: 2026, month: 3, day: 13]) == datetime("2026-03-13")
# Result: true
```

```rill
datetime("2026-03-13") < datetime("2026-03-14")
# Result: true
```

```rill
# Error: a datetime is not a number
datetime("2026-03-13") + 1
```

## Notes

The component, formatting, and arithmetic methods, such as `.iso`, `.add`, and `.diff`, belong
to the built-in methods chapter, as does `now()`. That chapter is not yet written.

The core stores UTC only. IANA timezone names are outside the language.
