---
id: error
title: Error statement
status: normative
since: 0.24.0
issues: []
grammar: [error-statement]
errors: [RILL-R002, RILL-R016]
depends: [guard]
tests: [error.test.ts]
---

# Error statement

`error "message"` halts the script on purpose with a message.

## Syntax

```ebnf
error-statement = "error" , string ;
```

```text
error "message"
"message" -> error
```

## Evaluation

r[error.halt] error halts with its message
`error "m"` and `"m" -> error` MUST halt with RILL-R016 carrying the message `m`.

r[error.interpolation] The message may interpolate
The message MUST be evaluated as a string, interpolation included, before the halt.

r[error.non-catchable] An error halt is never caught
The RILL-R016 halt MUST NOT be catchable (`halt.non-catchable`).

r[error.string] The piped message is a string
`v -> error` with a non-string `v` MUST halt with RILL-R002.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An `error` statement runs | RILL-R016 | No |
| A non-string is piped into `error` | RILL-R002 | Yes |

## Examples

```rill
# Error: Failed at step 3
3 => $step
error "Failed at step {$step}"
```

```rill
# Error: boom
guard { error "boom" }
```
