---
id: datetime.lt
title: datetime.lt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, datetime]
tests: [builtin-datetime.test.ts]
---

# datetime.lt

`.lt` tests whether a datetime orders before another value.

## Syntax

```text
datetime.lt(other: any) -> bool
```

## Evaluation

r[datetime.lt.operator] .lt yields what < yields
`d.lt(x)` MUST yield what `d < x` yields (`datetime.ordering`), and MUST halt where it halts
(`datetime.no-arithmetic`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a datetime (`datetime.no-arithmetic`) | RILL-R002 | Yes |

## Examples

```rill
datetime("2026-03-13") -> .lt(datetime("2026-03-14"))
# Result: true
```

```rill
# Error: Cannot compare datetime with number
datetime("2026-03-13") -> .lt(1)
```
