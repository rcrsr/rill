---
id: string.replace_all
title: string.replace_all
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, regex]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.replace_all

`.replace_all` replaces every match of a pattern in a string.

## Syntax

```text
string.replace_all(pattern: string, replacement: string) -> string
```

## Evaluation

r[string.replace_all.every] .replace_all replaces every match
`.replace_all(p, r)` MUST yield the receiver with every non-overlapping match of the pattern `p`
(`regex.syntax`), left to right, replaced by `r`. An empty match MUST be replaced at each
position it occurs: `"ab".replace_all("x*", "-")` MUST yield `"-a-b-"`.

r[string.replace_all.literal] The replacement is inserted as written
`r` MUST be inserted as written. `$1`, `$&`, and every other `$` sequence MUST stand for
themselves.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The pattern is invalid (`regex.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
"a1b22" -> .replace_all("[0-9]+", "#")
# Result: "a#b#"
```
