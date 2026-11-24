---
id: string.trim
title: string.trim
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [strings.test.ts, variable-method-calls.test.ts, builtin-string.test.ts]
---

# string.trim

`.trim` yields a string without its leading and trailing whitespace.

## Syntax

```text
string.trim() -> string
```

## Evaluation

r[string.trim.ends] .trim removes whitespace at both ends
`.trim` MUST yield the receiver with every leading and trailing whitespace character removed,
spaces, tabs, carriage returns, and newlines included. Whitespace between other characters MUST
remain.

## Examples

```rill
"\t a b \r\n" -> .trim
# Result: "a b"
```
