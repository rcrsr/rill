---
id: string.index_of
title: string.index_of
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.index_of

`.index_of` yields the position of the first occurrence of text in a string.

## Syntax

```text
string.index_of(search: string) -> number
```

## Evaluation

r[string.index_of.position] .index_of yields the first code point position
`.index_of(s)` MUST yield the code point position where the first occurrence of the text `s`
starts, counting from 0. `"😀a".index_of("a")` MUST yield 1. An empty `s` MUST yield 0.

r[string.index_of.absent] Absent text yields -1
When `s` does not occur, `.index_of` MUST yield -1.

## Examples

```rill
list["abcabc" -> .index_of("c"), "abc" -> .index_of("z")]
# Result: list[2, -1]
```
