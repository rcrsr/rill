---
id: string.lower
title: string.lower
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.lower

`.lower` yields a string in lowercase.

## Syntax

```text
string.lower() -> string
```

## Evaluation

r[string.lower.case] .lower maps every character to lowercase
`.lower` MUST yield the receiver with each character replaced by its Unicode default lowercase
mapping. `"ÄÖx".lower` MUST yield `"äöx"`.

## Examples

```rill
"AbC" -> .lower
# Result: "abc"
```
