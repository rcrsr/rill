---
id: duration.multiply
title: duration.multiply
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.multiply

`.multiply` scales a duration by a number.

## Syntax

```text
duration.multiply(n: any) -> duration
```

## Evaluation

r[duration.multiply.scale] .multiply scales each component apart
`d.multiply(n)` MUST yield the duration whose month count is `d`'s times `n` and whose
millisecond count is `d`'s times `n` (`duration.value`). `n` MAY be fractional:
`duration("1h").multiply(1.5)` yields `duration("1h30m")`.

r[duration.multiply.negative] A negative factor halts
A factor below 0 MUST halt with `#INVALID_INPUT`.

r[duration.multiply.fractional-months] A fractional month count halts
When the scaled month count is not an integer, `.multiply` MUST halt with `#INVALID_INPUT`.
`duration("2mo").multiply(1.5)` yields `duration("3mo")`.

r[duration.multiply.type] A non-number factor halts
A factor that is not a number MUST halt with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The factor is below 0 | `#INVALID_INPUT` | Yes |
| The scaled month count is not an integer | `#INVALID_INPUT` | Yes |
| A scaled component exceeds 9007199254740991 (`duration.range`) | `#INVALID_INPUT` | Yes |
| The factor is not a number | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[duration("2h").multiply(3), duration("1h1ms").multiply(0.5), duration("5h").multiply(0)]
# Result: list[6h, 30m0.5ms, 0ms]
```

```rill
guard { duration("1mo").multiply(0.5) } => $r
$r.!code
# Result: #INVALID_INPUT
```
