---
id: string.upper
title: string.upper
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.upper

`.upper` yields a string in uppercase.

## Syntax

```text
string.upper() -> string
```

## Evaluation

r[string.upper.case] .upper maps every character to uppercase
`.upper` MUST yield the receiver with each character replaced by its Unicode default uppercase
mapping. A character whose uppercase is several characters MUST map to all of them:
`"straße".upper` MUST yield `"STRASSE"`.

## Examples

```rill
"straße" -> .upper
# Result: "STRASSE"
```
