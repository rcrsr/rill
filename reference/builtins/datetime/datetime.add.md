---
id: datetime.add
title: datetime.add
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, datetime, duration, value-size]
tests: [datetime.test.ts, limits.test.ts, builtin-datetime.test.ts]
---

# datetime.add

`.add` moves a datetime forward by a duration.

## Syntax

```text
datetime.add(dur: any) -> datetime
```

## Evaluation

r[datetime.add.months] .add moves by the month count first, clamping the day
`.add(d)` MUST first move the receiver forward by the month count of `d` (`duration.value`),
keeping the day of the month and the time of day in UTC. When that day does not exist in the
target month, the day MUST become the last day of that month.

r[datetime.add.ms] .add then adds the millisecond count
After the months, `.add(d)` MUST add a whole millisecond count of `d` to the instant. So
2026-01-31 plus `1mo1d` is 2026-03-01: the month clamps to February 28 before the day is added.

r[datetime.add.type] An argument that is not a duration halts
`.add` with an argument that is not a duration MUST halt with `#TYPE_MISMATCH`.

## Interactions

A result outside the datetime range halts as `value-size.datetime` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a duration | `#TYPE_MISMATCH` | Yes |
| The result lies outside the datetime range (`value-size.datetime`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2024-01-31T10:00:00Z") -> .add(duration("1mo")) -> .iso
# Result: "2024-02-29T10:00:00Z"
```

```rill
datetime("2026-01-31T10:00:00Z") -> .add(duration("1mo1d")) -> .iso
# Result: "2026-03-01T10:00:00Z"
```

```rill
guard { datetime("2026-03-13") -> .add(42) } => $r
$r.!code
# Result: #TYPE_MISMATCH
```
