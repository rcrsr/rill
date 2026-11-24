---
id: datetime.ge
title: datetime.ge
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, datetime]
tests: [builtin-datetime.test.ts]
---

# datetime.ge

`.ge` tests whether a datetime orders after or at the same instant as another value.

## Syntax

```text
datetime.ge(other: any) -> bool
```

## Evaluation

r[datetime.ge.operator] .ge yields what >= yields
`d.ge(x)` MUST yield what `d >= x` yields (`datetime.ordering`), and MUST halt where it halts
(`datetime.no-arithmetic`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a datetime (`datetime.no-arithmetic`) | RILL-R002 | Yes |

## Examples

```rill
datetime("2026-03-14") -> .ge(datetime("2026-03-13"))
# Result: true
```

```rill
# Error: Cannot compare datetime with number
datetime("2026-03-13") -> .ge(1)
```
