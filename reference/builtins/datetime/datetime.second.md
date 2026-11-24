---
id: datetime.second
title: datetime.second
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime, datetime-calendar]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.second

`.second` yields the UTC second of a datetime.

## Syntax

```text
datetime.second() -> number
```

## Evaluation

r[datetime.second.utc] .second yields the UTC second from 0 to 59
`.second` MUST yield the second of the receiver's instant in UTC, from 0 to 59.

## Examples

```rill
datetime("2026-03-13T08:09:10.123Z") -> .second
# Result: 10
```
