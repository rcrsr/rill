---
id: string.starts_with
title: string.starts_with
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.starts_with

`.starts_with` tests whether a string begins with a prefix.

## Syntax

```text
string.starts_with(prefix: string) -> bool
```

## Evaluation

r[string.starts_with.prefix] .starts_with compares the leading text
`.starts_with(p)` MUST yield `true` exactly when the receiver begins with the text `p`, compared
case-sensitively. An empty `p` MUST yield `true`.

## Examples

```rill
list["abc" -> .starts_with("ab"), "Abc" -> .starts_with("a"), "abc" -> .starts_with("")]
# Result: list[true, false, true]
```
