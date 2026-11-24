---
id: string.is_match
title: string.is_match
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, regex]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.is_match

`.is_match` tests whether a pattern matches anywhere in a string.

## Syntax

```text
string.is_match(pattern: string) -> bool
```

## Evaluation

r[string.is_match.anywhere] .is_match tests for a match at any position
`.is_match(p)` MUST yield `true` exactly when the pattern `p` (`regex.syntax`) matches at some
position in the receiver.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The pattern is invalid (`regex.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["abc" -> .is_match("b"), "abc" -> .is_match("^b")]
# Result: list[true, false]
```
