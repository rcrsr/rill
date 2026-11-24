---
id: datetime.diff
title: datetime.diff
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, datetime, duration]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.diff

`.diff` yields the length of time between two datetimes as a duration.

## Syntax

```text
datetime.diff(other: any) -> duration
```

## Evaluation

r[datetime.diff.absolute] .diff yields the distance between two instants
`.diff(other)` MUST yield a duration of 0 months whose millisecond count is the absolute
difference between the receiver's instant and `other`'s, so the order of the two does not
matter.

r[datetime.diff.type] An argument that is not a datetime halts
`.diff` with an argument that is not a datetime MUST halt with `#TYPE_MISMATCH`.

## Interactions

A distance past the duration range halts as `duration.range` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a datetime | `#TYPE_MISMATCH` | Yes |
| The distance exceeds the duration range (`duration.range`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2026-03-12T09:00:00Z") -> .diff(datetime("2026-03-13T10:00:00Z")) -> "{$}"
# Result: "1d1h"
```

```rill
datetime("2026-03-13") -> .diff(datetime("2025-03-13")) -> .months
# Result: 0
```
