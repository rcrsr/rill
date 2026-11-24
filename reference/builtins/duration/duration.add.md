---
id: duration.add
title: duration.add
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.add

`.add` yields the sum of two durations.

## Syntax

```text
duration.add(dur: any) -> duration
```

## Evaluation

r[duration.add.sum] .add sums each component apart
`d.add(e)` MUST yield the duration whose month count is the sum of the two month counts and
whose millisecond count is the sum of the two millisecond counts (`duration.value`).

r[duration.add.type] A non-duration argument halts
An argument that is not a duration MUST halt with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a duration | `#TYPE_MISMATCH` | Yes |
| A component of the sum exceeds 9007199254740991 (`duration.range`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[duration("1h").add(duration("30m")), duration("10mo").add(duration("5mo2h"))]
# Result: list[1h30m, 1y3mo2h]
```

```rill
guard { duration("1d").add(1) } => $r
$r.!code
# Result: #TYPE_MISMATCH
```
