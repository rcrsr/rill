---
id: error
title: Error statement
status: normative
since: 0.24.0
issues: []
grammar: [error-statement, pipe-error]
errors: [RILL-P002, RILL-R002, RILL-R016]
depends: [guard]
tests: [error.test.ts]
---

# Error statement

`error "message"` halts the script on purpose with a message.

## Syntax

```ebnf
error-statement = "error" , string ;
pipe-error      = "error" , [ string ] ;
```

```text
error "message"
"message" -> error
```

## Static rules

r[error.no-message] error needs a message
An `error` statement with no message MUST be rejected with RILL-P002, even inside a block where
`$` is bound. Only the pipe target form, `v -> error`, may omit the message.

## Evaluation

r[error.halt] error halts with its message
`error "m"` and `"m" -> error` MUST halt with RILL-R016 carrying the message `m`.

r[error.interpolation] The message may interpolate
The message MUST be evaluated as a string, interpolation included, before the halt.

r[error.non-catchable] An error halt is never caught
The RILL-R016 halt MUST NOT be catchable (`halt.non-catchable`).

r[error.string] The piped message is a string
`v -> error` with a non-string `v` MUST halt with RILL-R002.

r[error.written-message] A written message replaces the piped value
`v -> error "m"` MUST halt with RILL-R016 carrying `m`, whatever the kind of `v`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An `error` statement has no message | RILL-P002 | No |
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
