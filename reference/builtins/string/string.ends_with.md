---
id: string.ends_with
title: string.ends_with
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.ends_with

`.ends_with` tests whether a string ends with a suffix.

## Syntax

```text
string.ends_with(suffix: string) -> bool
```

## Evaluation

r[string.ends_with.suffix] .ends_with compares the trailing text
`.ends_with(s)` MUST yield `true` exactly when the receiver ends with the text `s`, compared
case-sensitively. An empty `s` MUST yield `true`.

## Examples

```rill
list["abc" -> .ends_with("bc"), "abC" -> .ends_with("c"), "abc" -> .ends_with("")]
# Result: list[true, false, true]
```
