---
id: retry
title: Retry
status: normative
since: 0.24.0
issues: []
grammar: [retry-block]
errors: [RILL-P001, RILL-P004, RILL-P025]
depends: [guard, invalid-value]
tests: [guard-retry.test.ts]
---

# Retry

`retry(attempts: N) { body }` is `guard` that runs its body up to N times until one run
completes.

## Syntax

```ebnf
retry-block = "retry" , construct-options , block ;
```

```text
retry(attempts: 3) { body }
retry(attempts: 3, on: list[#TIMEOUT, #UNAVAILABLE]) { body }
```

## Static rules

r[retry.attempts] attempts is a positive integer literal
`attempts` MUST be a positive integer literal. Zero or a computed value MUST be rejected with
RILL-P004, and so MUST a spread (`construct-options.literal-bound`).

r[retry.attempts-name] The count is named attempts
The count MUST be written `attempts`, and counts every run, the first included.

r[retry.not-target] retry is not a pipe target
`v -> retry(attempts: N) { body }` MUST be rejected with RILL-P001.

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

r[retry.trace] Each caught run appends a frame
Each run that raises a caught halt MUST append one `guard-caught` frame whose `fn` is `"retry"`
(`invalid-value.trace-catch`), so exhausting N attempts appends N frames.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `retry` is written as a pipe target | RILL-P001 | No |
| `attempts` is not a positive integer literal, or the options hold a spread | RILL-P004 | No |
| The options are written in angle brackets | RILL-P025 | No |

## Examples

```rill
retry(attempts: 3) { 7 }
# Result: 7
```

```rill
retry(attempts: 3) { 1 / 0 } => $r
$r.!
# Result: true
```

## Notes

On 0.23.0 the count is written `retry<limit: N>`, and `limit` comes before `on`. The angle form now
halts RILL-P025.
