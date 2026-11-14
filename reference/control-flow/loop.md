---
id: loop
title: Loops
status: normative
since: 0.24.0
issues: [578]
grammar: []
errors: [RILL-P004, RILL-R002, RILL-R005, RILL-R010]
depends: [conditional]
tests: [loops.test.ts]
---

# Loops

`while` and `do` repeat a body, threading one value through `$` from each run to the next.

## Syntax

```text
seed -> while (cond) do { body }
seed -> while (cond) do(limit: N) { body }
seed -> do { body } while (cond)
seed -> do(limit: N) { body } while (cond)
```

A newline between `while (cond)` and `{` stands for `do`.

## Static rules

r[loop.do-required] A while body follows do
`while (cond) { body }` on one line MUST be rejected with RILL-P004.

r[loop.limit-literal] The limit is a positive integer literal {pending #578}
`limit` MUST be written as a positive integer literal. A computed value or a spread MUST be
rejected.

## Evaluation

r[loop.seed] The seed is the first $
The value piped into the loop MUST be `$` for the first condition test and the first body run.
With nothing piped, `$` MUST be the enclosing `$`; with none bound, the loop MUST halt with
RILL-R005.

r[loop.accumulate] Each body result becomes the next $
The result of each body run MUST be `$` for the next condition test and the next run.

r[loop.while] while tests before each run
`while (cond) do { body }` MUST test `cond` before every run, so a false first test runs the
body zero times and yields the seed.

r[loop.do-while] do tests after each run
`do { body } while (cond)` MUST run the body once before the first test.

r[loop.result] A loop yields the last $
A loop MUST yield `$` when its condition is false: the last body result, or the seed if the body
never ran.

r[loop.bool] The loop condition is a bool
A condition that is not a bool MUST halt with RILL-R002.

r[loop.limit] A loop runs at most its limit
A loop MUST halt with RILL-R010 when it would run its body more than `limit` times. The default
limit is 10,000.

r[loop.scope] Each run has a fresh scope
Variables bound in one body run MUST NOT be visible in the next (`scope.iteration`). State
carries only through `$`.

## Interactions

`break` ends a loop early with a value (`break`). The limit option is spelled `do(limit: N)`
(`construct-options`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `while (cond) { ... }` on one line | RILL-P004 | No |
| The condition is not a bool | RILL-R002 | Yes |
| No seed and no enclosing `$` | RILL-R005 | Yes |
| The body would run past the limit | RILL-R010 | No |

## Examples

```rill
0 -> while ($ < 5) do { $ + 1 }
# Result: 5
```

```rill
5 -> while ($ < 3) do { $ + 1 }
# Result: 5
```

```rill
5 -> do { $ + 1 } while ($ < 3)
# Result: 6
```

```rill
"" -> while (.len < 3) do { "{$}x" }
# Result: "xxx"
```

```rill pending=578
# Error: exceeded 3 iterations
0 -> while ($ < 10) do(limit: 3) { $ + 1 }
```

## Notes

On 0.23.0 the limit is written `do<limit: N>`, and exceeding it halts RILL-R010 "While loop
exceeded N iterations".
