---
id: now
title: now
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R045]
depends: [invocation, pipe, datetime]
tests: [datetime.test.ts, builtin-functions-core.test.ts]
---

# now

`now` yields the current instant as a datetime.

## Syntax

```text
now() -> datetime
```

## Evaluation

r[now.instant] now yields the host clock's current instant
`now()` MUST yield a datetime holding the current instant of the host's clock. When the host
fixes the clock to an instant, `now()` MUST yield that instant.

r[now.order] A later call never yields an earlier instant
Within one run, a call of `now()` MUST NOT yield an instant earlier than a call that completed
before it.

## Interactions

Written bare, `now` is called with no argument (`invocation.bare-name`). `v -> now` passes `v`
as an argument (`pipe.call-operand`) and halts (`invocation.excess`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An argument is passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
now() -> .^type.name
# Result: "datetime"
```

```rill
now() => $a
now() => $b
$a <= $b
# Result: true
```

```rill
# Error: Function expects 0 arguments, got 1
now(1)
```

## Notes

A spread with no fields, as in `now(...dict[])` or `now(...tuple[])`, halts RILL-R001 "Spread
not supported for zero-parameter function", while `fn() { 1 }` accepts both; a runtime defect
against `spread.arg-dict` and `spread.arg-tuple`.
