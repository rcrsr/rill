---
id: regex
title: Regular expression patterns
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# Regular expression patterns

A pattern is a string argument that `.replace`, `.replace_all`, `.match`, and `.is_match` read as
a regular expression.

## Evaluation

r[regex.syntax] A pattern is an ECMAScript regular expression in Unicode mode
A pattern MUST be read as an ECMAScript regular expression with the Unicode flag set, so `.`
matches one code point and `(?<=a)` is a lookbehind.

r[regex.case] A pattern matches case-sensitively and takes no flags
A pattern MUST match case-sensitively. No flag can be set, and an inline flag group such as
`(?i)` MUST be treated as invalid (`regex.invalid`).

r[regex.invalid] An invalid pattern halts
A pattern that is not a valid expression MUST halt with `#INVALID_INPUT`.

## Interactions

`.split`, `.contains`, `.index_of`, `.starts_with`, and `.ends_with` read their argument as text,
not as a pattern (`string.split.separator`, `string.contains.text`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A pattern is not a valid expression | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["😀" -> .is_match("^.$"), "ABC" -> .is_match("b"), "a1" -> .is_match("\\d")]
# Result: list[true, false, true]
```

```rill
guard { "abc" -> .match("(") } => $r
$r.!code
# Result: #INVALID_INPUT
```
