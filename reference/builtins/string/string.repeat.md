---
id: string.repeat
title: string.repeat
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.repeat

`.repeat` yields a string written a number of times in a row.

## Syntax

```text
string.repeat(count: number) -> string
```

## Evaluation

r[string.repeat.count] .repeat joins count copies
`.repeat(n)` MUST yield `n` copies of the receiver joined with nothing between them. `n` of 0
MUST yield `""`.

r[string.repeat.invalid] A negative or fractional count halts
A negative or non-integer `n` MUST halt with `#INVALID_INPUT`.

## Interactions

A result past the string length limit halts as `value-size.string` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The count is negative or not an integer | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["ab" -> .repeat(3), "ab" -> .repeat(0)]
# Result: list["ababab", ""]
```

```rill
# Error: repeat: count cannot be negative
"ab" -> .repeat(-1)
```
