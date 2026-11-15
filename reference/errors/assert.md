---
id: assert
title: Assert
status: normative
since: 0.24.0
issues: []
grammar: [assert-statement]
errors: [RILL-R002, RILL-R005, RILL-R015]
depends: [guard]
tests: [assert.test.ts]
---

# Assert

`assert cond` halts the script when `cond` is false, and otherwise passes `$` through.

## Syntax

```ebnf
assert-statement = "assert" , expression , [ string ] ;
```

```text
v -> assert cond
v -> assert cond "message"
```

## Evaluation

r[assert.pass] A true condition passes $ through
`v -> assert cond` MUST evaluate `cond` with `$` bound to `v`, and yield `v` when it is true.

r[assert.fail] A false condition halts
A false condition MUST halt with RILL-R015, carrying the message, or "Assertion failed" when
none is written.

r[assert.non-catchable] An assertion halt is never caught
The RILL-R015 halt MUST NOT be catchable (`halt.non-catchable`).

r[assert.bool] The condition is a bool
A condition that is not a bool MUST halt with RILL-R002.

r[assert.dollar] assert needs a bound $
`assert` where no `$` is bound MUST halt with RILL-R005.

## Interactions

`assert` is not a type assertion. `-> :T` checks a type and halts catchably with
`#TYPE_MISMATCH` (`assertion`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The condition is false | RILL-R015 | No |
| The condition is not a bool | RILL-R002 | Yes |
| No `$` is bound | RILL-R005 | Yes |

## Examples

```rill
5 -> assert ($ > 3) -> { $ * 2 }
# Result: 10
```

```rill
# Error: too small
5 -> assert ($ > 9) "too small"
```
