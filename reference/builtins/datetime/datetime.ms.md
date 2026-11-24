---
id: datetime.ms
title: datetime.ms
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.ms

`.ms` yields the millisecond within the second of a datetime.

## Syntax

```text
datetime.ms() -> number
```

## Evaluation

r[datetime.ms.utc] .ms yields the millisecond from 0 to 999
`.ms` MUST yield the millisecond of the receiver's instant within its second, from 0 to 999.

## Examples

```rill
datetime(...dict[unix: -1]) -> .ms
# Result: 999
```
