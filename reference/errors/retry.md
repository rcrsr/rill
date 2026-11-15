---
id: retry
title: Retry
status: normative
since: 0.24.0
issues: [578]
grammar: []
errors: [RILL-P004]
depends: [guard]
tests: [guard-retry.test.ts]
---

# Retry

`retry(attempts: N) { body }` is `guard` that runs its body up to N times until one run
completes.

## Syntax

```text
retry(attempts: 3) { body }
retry(attempts: 3, on: list[#TIMEOUT, #UNAVAILABLE]) { body }
```

## Static rules

r[retry.attempts] attempts is a positive integer literal
`attempts` MUST be a positive integer literal. Zero or a computed value MUST be rejected with
RILL-P004.

r[retry.attempts-name] The count is named attempts {pending #578}
The count MUST be written `attempts`, and counts every run, the first included.

## Evaluation

r[retry.success] The first run that completes ends the retry
`retry` MUST yield the result of the first run that completes, and MUST NOT run the body
again.

r[retry.exhaust] Exhausting the attempts yields an invalid value
When every one of the N runs raises a caught halt, `retry` MUST yield an invalid value holding
the last halt.

r[retry.guard] Each run catches as guard does
Each run MUST catch, select, and pass through halts and signals as `guard` does. A halt the
selector does not list MUST propagate at once, without another run.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `attempts` is not a positive integer literal | RILL-P004 | No |

## Examples

```rill pending=578
retry(attempts: 3) { 7 }
# Result: 7
```

```rill pending=578
retry(attempts: 3) { 1 / 0 } => $r
$r.!
# Result: true
```

## Notes

On 0.23.0 the count is written `retry<limit: N>`, and `limit` comes before `on`.
