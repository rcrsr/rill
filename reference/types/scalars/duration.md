---
id: duration
title: Durations
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R002, INVALID_INPUT, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [duration.test.ts, type-assertions.test.ts]
---

# Durations

A duration is an immutable length of time, stored as a whole number of calendar months and a number of milliseconds.

## Evaluation

r[duration.value] A duration holds months and milliseconds apart
A duration MUST hold a month count and a millisecond count as two components. A month has no
fixed length in milliseconds, so the components MUST NOT be merged.

r[duration.construct] duration of named components builds a duration
`duration(...dict[hours: 2, minutes: 30])` MUST yield a duration of 2 hours 30 minutes. The
components are `years`, `months`, `days`, `hours`, `minutes`, `seconds`, and `ms`. Each defaults
to 0, so `duration()` MUST yield the zero duration.

r[duration.years] Years convert to months
A `years` component MUST add 12 months per year. Every other component except `months` MUST add
its length in milliseconds.

r[duration.negative] A negative component halts
A negative component MUST halt with `#INVALID_INPUT`.

r[duration.fractional-months] A fractional months component halts
A `months` component that is not an integer MUST halt with `#INVALID_INPUT`.

r[duration.not-finite] A component that is not a finite number halts
A component that is not a finite number MUST halt with `#TYPE_MISMATCH`. A string component
halts.

r[duration.unknown-key] An unknown component name halts
A spread key that names no parameter MUST halt with RILL-R001.

r[duration.no-positional] A positional number is not a component
`duration(500)` and every other positional number argument MUST halt with RILL-R001. Components
are passed by name.

r[duration.from-string] A string argument is parsed in the printed form
`duration(s)` with a string `s` MUST parse it as one or more non-negative counts, each followed
by `y`, `mo`, `d`, `h`, `m`, `s`, or `ms`, in that order and each at most once. Every count MUST
be an integer except the `ms` count, which MAY be a decimal of digits, a point, and digits
(`0.5ms`, `1s500.5ms`); a leading or trailing point, an exponent, and a sign are malformed.
`duration("1m30s")` MUST equal `duration(...dict[minutes: 1, seconds: 30])`.

r[duration.string-malformed] A string that does not parse halts
A string argument that is not in the printed form MUST halt with `#INVALID_INPUT`.

r[duration.print] A duration prints its non-zero components
A duration MUST print as its non-zero components in the order years, months, days, hours,
minutes, seconds, milliseconds, each followed by `y`, `mo`, `d`, `h`, `m`, `s`, or `ms`. A
duration of 25 hours prints `1d1h`.

r[duration.print-zero] The zero duration prints 0ms
The zero duration MUST print as `0ms`.

r[duration.round-trip] A printed duration parses back
For every duration `$d`, `duration("{$d}")` MUST equal `$d`.

r[duration.range] A duration component is at most 2^53-1
The month count and the millisecond count of a duration MUST each be a finite, non-negative
number no larger than 9007199254740991. A construction, a string argument, a deserialization,
or a method result that would exceed that MUST halt with `#INVALID_INPUT`. `duration("104249992d")`
halts, and `duration("104249991d")` is the largest whole-day duration.

r[duration.equality] Two durations are equal when both components are equal
`==` between two durations MUST yield true exactly when their month counts and their
millisecond counts are equal. `48h == 2d` ⇒ `true`. One month is not equal to 30 days.

r[duration.ordering] Durations order when the components agree
`<`, `>`, `<=`, and `>=` between two durations MUST compare them when one has at least as many
months and at least as many milliseconds as the other.

r[duration.ordering-disagree] Durations that disagree do not order
When one duration has more months and the other more milliseconds, the comparison MUST halt with
RILL-R002.

## Interactions

Equality against a non-duration value follows `equality.no-overlap`.

r[duration.no-arithmetic] A duration is not a number
An arithmetic operator with a duration operand MUST halt with RILL-R002. Ordering a duration
against a non-duration MUST halt with RILL-R002.

r[duration.membership] Only a duration satisfies duration
A duration MUST satisfy `:duration`. A value of any other type MUST halt `:duration` with
`#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A component is negative or `months` is fractional | `#INVALID_INPUT` | Yes |
| A component is not a finite number | `#TYPE_MISMATCH` | Yes |
| A spread key names no parameter | RILL-R001 | Yes |
| A positional number argument | RILL-R001 | Yes |
| A string argument is not in the printed form | `#INVALID_INPUT` | Yes |
| A component total exceeds 9007199254740991 | `#INVALID_INPUT` | Yes |
| Durations disagree on months and milliseconds when ordered | RILL-R002 | Yes |
| A duration is ordered against a non-duration or used in arithmetic | RILL-R002 | Yes |
| A non-duration is asserted as `:duration` | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
duration(...dict[hours: 1, minutes: 90]) -> "{$}"
# Result: "2h30m"
```

```rill
duration(...dict[hours: 48]) == duration(...dict[days: 2])
# Result: true
```

```rill
duration("1h30m") == duration(...dict[hours: 1, minutes: 30])
# Result: true
```

```rill
# Error: units out of order halt with INVALID_INPUT
duration("30s1m")
```

```rill
duration(...dict[months: 1]) == duration(...dict[days: 30])
# Result: false
```

```rill
# Error: a month has no fixed length in milliseconds
duration(...dict[months: 1]) < duration(...dict[days: 30])
```

## Notes

On 0.23.0 a positional number fills the `years` component, so `duration(500)` means 500 years,
and a string argument halts `#TYPE_MISMATCH`.

The built-in methods, such as `.add`, `.multiply`, and `.total_ms`, belong to the built-in
methods chapter.
