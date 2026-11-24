---
id: string.replace
title: string.replace
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, regex]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.replace

`.replace` replaces the first match of a pattern in a string.

## Syntax

```text
string.replace(pattern: string, replacement: string) -> string
```

## Evaluation

r[string.replace.first] .replace replaces the first match
`.replace(p, r)` MUST yield the receiver with the first match of the pattern `p`
(`regex.syntax`) replaced by `r`. With no match, it MUST yield the receiver unchanged.

r[string.replace.literal] The replacement is inserted as written
`r` MUST be inserted as written. `$1`, `$&`, and every other `$` sequence MUST stand for
themselves.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The pattern is invalid (`regex.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["a.b.c" -> .replace(".", "-"), "ab" -> .replace("(a)(b)", "$2$1")]
# Result: list["-.b.c", "$2$1"]
```
