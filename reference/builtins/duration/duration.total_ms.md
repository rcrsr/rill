---
id: duration.total_ms
title: duration.total_ms
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.total_ms

`.total_ms` yields the length of a duration with no months in milliseconds.

## Syntax

```text
duration.total_ms() -> number
```

## Evaluation

r[duration.total_ms.count] .total_ms yields the millisecond count
`.total_ms` MUST yield the receiver's millisecond count (`duration.value`), fraction kept.
`duration("1s0.5ms").total_ms` MUST yield 1000.5.

r[duration.total_ms.calendar] .total_ms on a duration with months halts
`.total_ms` on a receiver whose month count is not 0 MUST halt with `#INVALID_INPUT`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The receiver's month count is not 0 | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[duration("2h").total_ms, duration("1s0.5ms").total_ms]
# Result: list[7200000, 1000.5]
```

```rill
guard { duration("1mo1d").total_ms } => $r
$r.!code
# Result: #INVALID_INPUT
```
