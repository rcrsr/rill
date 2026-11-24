---
id: datetime.le
title: datetime.le
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, datetime]
tests: [builtin-datetime.test.ts]
---

# datetime.le

`.le` tests whether a datetime orders before or at the same instant as another value.

## Syntax

```text
datetime.le(other: any) -> bool
```

## Evaluation

r[datetime.le.operator] .le yields what <= yields
`d.le(x)` MUST yield what `d <= x` yields (`datetime.ordering`), and MUST halt where it halts
(`datetime.no-arithmetic`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a datetime (`datetime.no-arithmetic`) | RILL-R002 | Yes |

## Examples

```rill
datetime("2026-03-13") -> .le(datetime("2026-03-13"))
# Result: true
```

```rill
# Error: Cannot compare datetime with number
datetime("2026-03-13") -> .le(1)
```
