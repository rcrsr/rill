---
id: string.match
title: string.match
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, regex]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.match

`.match` describes the first match of a pattern in a string.

## Syntax

```text
string.match(pattern: string) -> dict
```

## Evaluation

r[string.match.first] .match describes the first match
`.match(p)` MUST yield `dict[matched: m, index: i, groups: g]` for the first match of the pattern
`p` (`regex.syntax`): `m` is the matched text, `i` the code point position where it starts, and
`g` the list of capture group texts in group order.

r[string.match.unset-group] A group that took no part is empty
A capture group that took no part in the match MUST appear in `groups` as `""`.

r[string.match.none] No match yields an empty dict
With no match, `.match` MUST yield `dict[]`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The pattern is invalid (`regex.invalid`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
"😀x12" -> .match("([a-z])([0-9])")
# Result: dict[groups: list["x", "1"], index: 1, matched: "x1"]
```

```rill
list["ab" -> .match("(x)?a").groups, "abc" -> .match("z")]
# Result: list[list[""], dict[]]
```
