---
id: datetime.zero
title: datetime.zero
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime]
tests: [datetime.test.ts]
---

# datetime.zero

`.zero` yields the datetime at the Unix epoch.

## Syntax

```text
datetime.zero() -> datetime
```

## Evaluation

r[datetime.zero.epoch] .zero yields the epoch whatever the receiver
`.zero` MUST yield the datetime at 1970-01-01T00:00:00Z, whatever the receiver's instant.

## Examples

```rill
datetime("2026-03-13T08:00:00Z") -> .zero -> .unix
# Result: 0
```
