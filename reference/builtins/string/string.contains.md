---
id: string.contains
title: string.contains
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.contains

`.contains` tests whether a string holds a piece of text.

## Syntax

```text
string.contains(search: string) -> bool
```

## Evaluation

r[string.contains.text] .contains searches for text, not a pattern
`.contains(s)` MUST yield `true` exactly when the text `s` occurs in the receiver, compared
case-sensitively and not as a pattern. An empty `s` MUST yield `true`.

## Examples

```rill
list["a.c" -> .contains("."), "abc" -> .contains("B"), "" -> .contains("")]
# Result: list[true, false, true]
```
