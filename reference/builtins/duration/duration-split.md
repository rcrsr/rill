---
id: duration-split
title: Duration parts
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# Duration parts

The parts of a duration are the days, hours, minutes, seconds, and milliseconds its millisecond
count splits into, which `.days`, `.hours`, `.minutes`, `.seconds`, and `.ms` read.

## Evaluation

r[duration-split.order] The millisecond count splits largest unit first
The millisecond count (`duration.value`) MUST split into whole days, then whole hours from 0 to
23, whole minutes from 0 to 59, whole seconds from 0 to 59, and a millisecond remainder below
1000. The remainder MUST keep any fraction of the count. `duration("49h")` splits into 2 days
and 1 hour.

r[duration-split.no-months] The month count is in no part
The month count MUST NOT contribute to any part. `duration("1y").days` MUST yield 0.

## Interactions

`.months` reads the month count (`duration.months.count`), and `.total_ms` the whole millisecond
count (`duration.total_ms.count`).

## Examples

```rill
duration("1y2mo3d4h5m6s7ms") => $d
list[$d.months, $d.days, $d.hours, $d.minutes, $d.seconds, $d.ms]
# Result: list[14, 3, 4, 5, 6, 7]
```

```rill
duration("1s0.5ms") => $d
list[$d.seconds, $d.ms, duration("90m").hours, duration("90m").minutes]
# Result: list[1, 0.5, 1, 30]
```
