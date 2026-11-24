---
id: duration.subtract
title: duration.subtract
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.subtract

`.subtract` yields the difference of two durations.

## Syntax

```text
duration.subtract(other: any) -> duration
```

## Evaluation

r[duration.subtract.difference] .subtract subtracts each component apart
`d.subtract(e)` MUST yield the duration whose month count is `d`'s less `e`'s and whose
millisecond count is `d`'s less `e`'s (`duration.value`).

r[duration.subtract.negative] A negative component in the difference halts
When either difference is below 0, `.subtract` MUST halt with `#INVALID_INPUT`. Months and
milliseconds MUST NOT borrow from each other, so `duration("1mo").subtract(duration("1d"))`
halts.

r[duration.subtract.type] A non-duration argument halts
An argument that is not a duration MUST halt with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The month or millisecond difference is below 0 | `#INVALID_INPUT` | Yes |
| The argument is not a duration | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[duration("2h").subtract(duration("30m")), duration("1mo1d").subtract(duration("1mo"))]
# Result: list[1h30m, 1d]
```

```rill
guard { duration("1mo").subtract(duration("1d")) } => $r
$r.!code
# Result: #INVALID_INPUT
```
