---
id: duration.months
title: duration.months
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration, duration-split]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.months

`.months` yields the month count of a duration.

## Syntax

```text
duration.months() -> number
```

## Evaluation

r[duration.months.count] .months yields the month count
`.months` MUST yield the receiver's month count (`duration.value`), with 12 months for each year
(`duration.years`). The millisecond count MUST NOT contribute (`duration-split.no-months`), so
`duration("40d").months` MUST yield 0.

## Examples

```rill
list[duration("1y2mo").months, duration("40d").months]
# Result: list[14, 0]
```
