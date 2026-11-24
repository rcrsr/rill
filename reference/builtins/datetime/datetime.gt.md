---
id: datetime.gt
title: datetime.gt
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, datetime]
tests: [builtin-datetime.test.ts]
---

# datetime.gt

`.gt` tests whether a datetime orders after another value.

## Syntax

```text
datetime.gt(other: any) -> bool
```

## Evaluation

r[datetime.gt.operator] .gt yields what > yields
`d.gt(x)` MUST yield what `d > x` yields (`datetime.ordering`), and MUST halt where it halts
(`datetime.no-arithmetic`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a datetime (`datetime.no-arithmetic`) | RILL-R002 | Yes |

## Examples

```rill
datetime("2026-03-13") -> .gt(datetime("2026-03-14"))
# Result: false
```

```rill
# Error: Cannot compare datetime with number
datetime("2026-03-13") -> .gt(1)
```
